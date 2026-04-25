'use strict';

// ── Config ─────────────────────────────────────────────────────────────────────
const STORAGE_KEY = 'promidia_web_cfg';
const ACTIVE_SERVICE_KEY = 'promidia_active_service';
const PLAN_STATE_KEY = 'promidia_plan_state';
const SERVICE_SLOT_LABELS = {
  dom_manha: 'Domingo Manhã',
  dom_noite: 'Domingo Noite',
  qua: 'Quarta-Feira',
  especial: 'Especial',
};
const SERVICE_SLOT_ORDER = {
  dom_manha: 0,
  dom_noite: 1,
  qua: 2,
  especial: 3,
};
let cfg = { url: 'https://datashow.meuibbv.com', token: '822916792e2c3c0eab64b41323d3a684b0764a57d0d8174ffd46be23dfaee589' };

function stripBearerPrefix(value = '') {
  return String(value || '').trim().replace(/^Bearer\s+/i, '').trim();
}

function normalizeBaseUrl(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const normalizedRaw = raw.replace(/meuibv\.com/gi, 'meuibbv.com');
  const candidate = /^https?:\/\//i.test(normalizedRaw) ? normalizedRaw : `https://${normalizedRaw.replace(/^\/+/, '')}`;
  try {
    const parsed = new URL(candidate);
    if (!/^https?:$/i.test(parsed.protocol)) return '';
    return `${parsed.protocol}//${parsed.host}`;
  } catch { return ''; }
}

function sanitizeWebConfig(input = {}) {
  return {
    url: normalizeBaseUrl(input?.url || ''),
    token: stripBearerPrefix(input?.token || ''),
  };
}

function mapConnectErrorMessage(err = null) {
  const status = Number(err?.status || 0);
  const detail = String(err?.detail || '').toUpperCase();
  const text = String(err?.message || err || '').toUpperCase();
  if (status === 401 || status === 403 || detail.includes('AUTH_REQUIRED') || detail.includes('MEDIA_AUTH_REQUIRED')) {
    if (!cfg.token) return 'Este servidor exige token. Preencha o token de acesso (sem "Bearer").';
    return 'Token inválido ou sem permissão. Cole o token sem "Bearer".';
  }
  if (status === 404 || text.includes('404')) {
    return 'Servidor encontrado, mas endpoint não existe. Confira se a URL base está correta.';
  }
  if (text.includes('FAILED TO FETCH') || text.includes('NETWORK') || text.includes('TYPEERROR')) {
    return 'Não foi possível conectar ao servidor. Verifique URL, internet e SSL.';
  }
  return String(err?.message || err || 'Falha ao conectar.');
}

function loadConfig() {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    if (!s) return;
    const parsed = JSON.parse(s);
    cfg = {
      ...cfg,
      ...sanitizeWebConfig(parsed || {}),
    };
  } catch {}
}
function saveConfig() {
  cfg = {
    ...cfg,
    ...sanitizeWebConfig(cfg),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
}

function getTodayIsoDate() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function sanitizePlanDate(value = '') {
  const date = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  return getTodayIsoDate();
}

function sanitizePlanSlot(value = '') {
  const slot = String(value || '').trim();
  return Object.prototype.hasOwnProperty.call(SERVICE_SLOT_LABELS, slot) ? slot : 'dom_manha';
}

// ── State ─────────────────────────────────────────────────────────────────────
let allHymns = [];
let visibleHymns = [];
let service = [];
let libraries = [];
let savedPlaylists = [];
let selectedLibs = new Set();
let searchQuery = '';
let currentPlayingId = null;
let activePlaylistId = '';
let activePlan = { date: getTodayIsoDate(), slot: 'dom_manha' };
const audioPlayer = document.getElementById('audio-player');

// ── API ───────────────────────────────────────────────────────────────────────
async function api(path, opts = {}) {
  const headers = {
    'Accept': 'application/json',
    ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
    ...(opts.headers || {}),
  };
  if (cfg.token) headers.Authorization = `Bearer ${cfg.token}`;
  const res = await fetch(cfg.url + path, {
    ...opts,
    headers,
  });
  if (!res.ok) {
    let detail = '';
    try {
      const text = await res.text();
      detail = String(text || '').trim().slice(0, 500);
    } catch {}
    const err = new Error(`${res.status} ${res.statusText}${detail ? ` (${detail})` : ''}`);
    err.status = res.status;
    err.detail = detail;
    throw err;
  }
  return res.json();
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  const search = new URLSearchParams(window.location.search || '');
  if (search.get('reset') === '1') {
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(PLAN_STATE_KEY);
    } catch {}
    const clean = `${window.location.origin}${window.location.pathname}`;
    window.location.replace(clean);
    return;
  }
  loadConfig();
  loadPlanState();
  syncPlanControls();
  document.getElementById('setup-url').value = cfg.url;
  document.getElementById('setup-token').value = cfg.token;

  if (!cfg.url) { showSetup(); return; }
  await connect();
}

async function connect() {
  try {
    showLoading(true);
    const [libData, manifestData] = await Promise.all([
      api('/api/repository/libraries'),
      api('/api/repository/manifest?compact=1'),
    ]);
    libraries = libData.libraries || [];
    allHymns = manifestData.hymns || [];
    savedPlaylists = manifestData.playlists || [];
    renderLibraries();
    filterAndRender();
    renderPlaylistDropdown();
    showApp();
  } catch (err) {
    showSetup(`Erro ao conectar: ${mapConnectErrorMessage(err)}`);
  } finally {
    showLoading(false);
  }
}

// ── Libraries ─────────────────────────────────────────────────────────────────
function renderLibraries() {
  const el = document.getElementById('library-list');
  el.innerHTML = '';

  const allActive = selectedLibs.size === 0;
  const addItem = (label, count, libName) => {
    const isActive = libName === null ? allActive : selectedLibs.has(libName);
    const li = document.createElement('li');
    li.className = 'library-item' + (isActive ? ' active' : '');
    li.innerHTML = `<span class="lib-name">${label}</span><span class="lib-count">${count}</span>`;
    li.onclick = () => selectLibrary(libName);
    el.appendChild(li);
  };

  const filteredCount = selectedLibs.size
    ? allHymns.filter(h => selectedLibs.has(h.library)).length
    : allHymns.length;
  addItem('Todos os Hinos', filteredCount, null);
  libraries.forEach(lib => addItem(lib.name, lib.hymnCount, lib.name));
}

function selectLibrary(name) {
  if (name === null) {
    selectedLibs.clear();
  } else if (selectedLibs.has(name)) {
    selectedLibs.delete(name);
  } else {
    selectedLibs.add(name);
  }
  searchQuery = '';
  document.getElementById('search').value = '';
  const header = selectedLibs.size === 0 ? 'Todos os Hinos'
    : selectedLibs.size === 1 ? [...selectedLibs][0]
    : `${selectedLibs.size} bibliotecas`;
  document.getElementById('hymns-header').textContent = header;
  filterAndRender();
  renderLibraries();
}

// ── Hymns ─────────────────────────────────────────────────────────────────────
function filterAndRender() {
  const q = searchQuery.toLowerCase().trim();
  let filtered = selectedLibs.size
    ? allHymns.filter(h => selectedLibs.has(h.library))
    : allHymns;
  if (q) {
    filtered = filtered.filter(h =>
      (h.title || '').toLowerCase().includes(q) ||
      String(h.number || '').includes(q) ||
      String(h.code || '').toLowerCase().includes(q)
    );
  }
  visibleHymns = filtered;

  const countEl = document.getElementById('search-count');
  countEl.textContent = q || selectedLibs.size ? `${filtered.length} hinos` : '';

  renderHymns();
}

function renderHymns() {
  const el = document.getElementById('hymn-list');
  const empty = document.getElementById('hymns-empty');
  const inServiceIds = new Set(service.map(s => s.id));
  const showLibraryBadge = selectedLibs.size !== 1;

  if (!visibleHymns.length) {
    el.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  const frag = document.createDocumentFragment();
  visibleHymns.forEach(hymn => {
    const inSvc = inServiceIds.has(hymn.id);
    const hasAudio = !!hymn.audioFile;
    const isPlaying = currentPlayingId === hymn.id;

    const li = document.createElement('li');
    li.className = 'hymn-item' + (inSvc ? ' in-service' : '');

    li.innerHTML = `
      <div class="hymn-info">
        ${hymn.number ? `<span class="hymn-num">Nº ${hymn.number}</span>` : ''}
        <span class="hymn-title">${escHtml(hymn.title)}</span>
        ${hymn.library && showLibraryBadge ? `<span class="hymn-lib">${escHtml(hymn.library)}</span>` : ''}
      </div>
      <div class="hymn-actions">
        ${hasAudio ? `<button class="btn-sm btn-play${isPlaying ? ' playing' : ''}" data-id="${hymn.id}" title="Ouvir prévia">${isPlaying ? '⏹' : '▶'}</button>` : ''}
        <button class="btn-sm btn-add${inSvc ? ' in-service' : ''}" data-id="${hymn.id}" title="${inSvc ? 'Já no serviço' : 'Adicionar'}" ${inSvc ? 'disabled' : ''}>+ Add</button>
      </div>
    `;

    if (!inSvc) {
      li.querySelector('.btn-add').addEventListener('click', e => { e.stopPropagation(); addToService(hymn); });
      li.addEventListener('click', e => {
        if (e.target.closest('.btn-play') || e.target.closest('.btn-add')) return;
        addToService(hymn);
      });
    }
    if (hasAudio) {
      li.querySelector('.btn-play').addEventListener('click', e => { e.stopPropagation(); toggleAudio(hymn); });
    }

    frag.appendChild(li);
  });

  el.innerHTML = '';
  el.appendChild(frag);
}

// ── Service ───────────────────────────────────────────────────────────────────
function addToService(hymn) {
  if (service.some(s => s.id === hymn.id)) return;
  service.push({ ...hymn });
  renderService();
  renderHymns();
}

function removeFromService(hymnId) {
  service = service.filter(s => s.id !== hymnId);
  renderService();
  renderHymns();
}

function renderService() {
  const el = document.getElementById('service-list');
  const empty = document.getElementById('service-empty');
  document.getElementById('service-count').textContent = service.length;

  if (!service.length) { el.innerHTML = ''; empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');

  const frag = document.createDocumentFragment();
  service.forEach((hymn, idx) => {
    const isPlaying = currentPlayingId === hymn.id;
    const li = document.createElement('li');
    li.className = 'service-item';
    li.draggable = true;
    li.dataset.idx = idx;

    li.innerHTML = `
      <span class="drag-handle" title="Arrastar">⠿</span>
      <span class="service-order">${idx + 1}</span>
      <div class="service-hymn-info">
        <span class="hymn-title">${escHtml(hymn.title)}</span>
        ${hymn.number ? `<span class="hymn-num">Nº ${hymn.number}</span>` : ''}
      </div>
      <div class="service-actions">
        ${hymn.audioFile ? `<button class="btn-sm btn-play${isPlaying ? ' playing' : ''}" data-id="${hymn.id}" title="Ouvir">${isPlaying ? '⏹' : '▶'}</button>` : ''}
        <button class="btn-sm btn-remove" data-id="${hymn.id}" title="Remover">×</button>
      </div>
    `;

    li.querySelector('.btn-remove').addEventListener('click', () => removeFromService(hymn.id));
    li.querySelector('.btn-play')?.addEventListener('click', () => toggleAudio(hymn));

    // Drag & drop reorder
    li.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', idx); li.classList.add('dragging'); });
    li.addEventListener('dragend', () => li.classList.remove('dragging'));
    li.addEventListener('dragover', e => { e.preventDefault(); li.classList.add('drag-over'); });
    li.addEventListener('dragleave', () => li.classList.remove('drag-over'));
    li.addEventListener('drop', e => {
      e.preventDefault(); li.classList.remove('drag-over');
      const from = parseInt(e.dataTransfer.getData('text/plain'));
      if (from !== idx) { const [item] = service.splice(from, 1); service.splice(idx, 0, item); renderService(); }
    });

    frag.appendChild(li);
  });

  el.innerHTML = '';
  el.appendChild(frag);
}

// ── Audio ─────────────────────────────────────────────────────────────────────
function toggleAudio(hymn) {
  if (currentPlayingId === hymn.id) {
    audioPlayer.pause(); audioPlayer.currentTime = 0;
    currentPlayingId = null;
  } else {
    const tokenPart = cfg.token ? `?token=${encodeURIComponent(cfg.token)}` : '';
    audioPlayer.src = `${cfg.url}/media/${encodeURIComponent(hymn.audioFile)}${tokenPart}`;
    audioPlayer.play().catch(() => {});
    currentPlayingId = hymn.id;
    audioPlayer.onended = () => { currentPlayingId = null; refreshPlayButtons(); };
  }
  refreshPlayButtons();
}

function refreshPlayButtons() {
  document.querySelectorAll('.btn-play').forEach(btn => {
    const playing = btn.dataset.id === currentPlayingId;
    btn.textContent = playing ? '⏹' : '▶';
    btn.classList.toggle('playing', playing);
  });
}

// ── Planning meta ────────────────────────────────────────────────────────────
function makePlaylistId(date, slot) {
  const compactDate = String(date || '').replace(/-/g, '');
  return `svc-${compactDate}-${slot}-${Date.now()}`;
}

function makePlaylistName(date, slot) {
  const label = SERVICE_SLOT_LABELS[slot] || SERVICE_SLOT_LABELS.dom_manha;
  return `${date} • ${label}`;
}

function parsePlaylistMeta(playlist = {}) {
  const id = String(playlist?.id || '').trim();
  const name = String(playlist?.name || '').trim();
  const match = id.match(/^svc-(\d{4})(\d{2})(\d{2})-([a-z_]+)-\d+$/i);
  if (match) {
    const slot = sanitizePlanSlot(match[4]);
    const date = `${match[1]}-${match[2]}-${match[3]}`;
    return { date, slot, label: SERVICE_SLOT_LABELS[slot] || slot, hasMeta: true };
  }
  return { date: '', slot: '', label: name, hasMeta: false };
}

function playlistSortKey(playlist = {}) {
  const meta = parsePlaylistMeta(playlist);
  const date = meta.date || '9999-12-31';
  const slotOrder = Number(SERVICE_SLOT_ORDER[meta.slot] ?? 99);
  const name = String(playlist?.name || '');
  return `${date}|${String(slotOrder).padStart(2, '0')}|${name}`;
}

function sortedPlaylists() {
  return [...savedPlaylists].sort((a, b) => playlistSortKey(a).localeCompare(playlistSortKey(b), 'pt'));
}

function syncPlanControls() {
  const dateEl = document.getElementById('plan-date');
  const slotEl = document.getElementById('plan-slot');
  if (!dateEl || !slotEl) return;
  dateEl.value = sanitizePlanDate(activePlan.date);
  slotEl.value = sanitizePlanSlot(activePlan.slot);
}

function readPlanControls() {
  const dateEl = document.getElementById('plan-date');
  const slotEl = document.getElementById('plan-slot');
  activePlan = {
    date: sanitizePlanDate(dateEl?.value || activePlan.date),
    slot: sanitizePlanSlot(slotEl?.value || activePlan.slot),
  };
  try { localStorage.setItem(PLAN_STATE_KEY, JSON.stringify(activePlan)); } catch {}
  syncPlanControls();
}

function loadPlanState() {
  try {
    const raw = localStorage.getItem(PLAN_STATE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    activePlan = {
      date: sanitizePlanDate(parsed?.date || activePlan.date),
      slot: sanitizePlanSlot(parsed?.slot || activePlan.slot),
    };
  } catch {}
}

function getNextPlannedPlaylistId() {
  const today = getTodayIsoDate();
  const ordered = sortedPlaylists();
  const future = ordered.find(pl => {
    const meta = parsePlaylistMeta(pl);
    if (!meta.hasMeta) return false;
    return meta.date >= today;
  });
  if (future) return future.id;
  return ordered[0]?.id || '';
}

// ── Playlists ─────────────────────────────────────────────────────────────────
function renderPlaylistDropdown() {
  const sel = document.getElementById('playlist-select');
  sel.innerHTML = '<option value="">Carregar serviço...</option>';
  sortedPlaylists().forEach(pl => {
    const meta = parsePlaylistMeta(pl);
    const opt = document.createElement('option');
    opt.value = pl.id;
    opt.textContent = meta.hasMeta
      ? `${meta.date} • ${meta.label}`
      : pl.name;
    sel.appendChild(opt);
  });
  if (activePlaylistId) sel.value = activePlaylistId;
}

function loadPlaylist(id) {
  const pl = savedPlaylists.find(p => p.id === id);
  if (!pl) return;
  const items = Array.isArray(pl.items) ? pl.items : [];
  service = [];
  items.sort((a, b) => (a.order || 0) - (b.order || 0)).forEach(item => {
    const hymn = allHymns.find(h => h.id === item.hymnId);
    if (hymn) service.push({ ...hymn });
  });
  activePlaylistId = pl.id;
  const meta = parsePlaylistMeta(pl);
  if (meta.hasMeta) {
    activePlan = {
      date: sanitizePlanDate(meta.date),
      slot: sanitizePlanSlot(meta.slot),
    };
    syncPlanControls();
  }
  renderService(); renderHymns();
  document.getElementById('playlist-select').value = pl.id;
}

async function saveService() {
  if (!service.length) { alert('Adicione hinos ao serviço antes de salvar.'); return; }
  readPlanControls();
  const date = sanitizePlanDate(activePlan.date);
  const slot = sanitizePlanSlot(activePlan.slot);
  const name = makePlaylistName(date, slot);

  const existing = savedPlaylists.find(pl => {
    const meta = parsePlaylistMeta(pl);
    return meta.hasMeta && meta.date === date && meta.slot === slot;
  });
  const targetId = existing?.id || makePlaylistId(date, slot);

  const playlist = {
    id: targetId,
    name,
    updatedAt: new Date().toISOString(),
    items: service.map((h, i) => ({ hymnId: h.id, order: i + 1, title: h.title })),
  };

  try {
    showLoading(true);
    await api('/api/repository/sync', {
      method: 'POST',
      body: JSON.stringify({ hymns: [], playlists: [playlist] }),
    });
    // Refresh playlists
    const data = await api('/api/repository/manifest?compact=1');
    savedPlaylists = data.playlists || [];
    activePlaylistId = playlist.id;
    renderPlaylistDropdown();
    alert(existing
      ? `Planejamento atualizado: ${playlist.name}`
      : `Planejamento salvo: ${playlist.name}`);
  } catch (err) {
    alert(`Erro ao salvar: ${err.message}`);
  } finally {
    showLoading(false);
  }
}

function loadNextService() {
  const nextId = getNextPlannedPlaylistId();
  if (!nextId) {
    alert('Nenhum serviço planejado encontrado.');
    return;
  }
  loadPlaylist(nextId);
}

function normalizeSlides(input = []) {
  if (!Array.isArray(input)) return [];
  return input
    .map(line => String(line ?? '').replace(/\r\n?/g, '\n').trim())
    .filter(Boolean);
}

async function openOperator() {
  if (!service.length) {
    const nextId = getNextPlannedPlaylistId();
    if (nextId) loadPlaylist(nextId);
  }

  if (!service.length) {
    alert('Adicione hinos ao serviço ou carregue um planejamento antes de abrir o operador.');
    return;
  }

  try {
    showLoading(true);
    const manifest = await api('/api/repository/manifest');
    const fullHymns = Array.isArray(manifest?.hymns) ? manifest.hymns : [];
    const hymnById = new Map(
      fullHymns
        .map(hymn => [String(hymn?.id || '').trim(), hymn])
        .filter(row => row[0])
    );

    const items = service.map((entry, index) => {
      const id = String(entry?.id || '').trim();
      const full = hymnById.get(id) || entry || {};
      return {
        id,
        order: index,
        title: String(full?.title || entry?.title || '').trim(),
        number: Number(full?.number || entry?.number || 0) || 0,
        code: String(full?.code || entry?.code || '').trim(),
        library: String(full?.library || entry?.library || '').trim(),
        audioFile: String(full?.audioFile || entry?.audioFile || '').trim(),
        slides: normalizeSlides(full?.slides),
      };
    }).filter(item => item.id && item.title);

    if (!items.length) {
      throw new Error('Nenhum hino válido foi encontrado para o operador.');
    }

    localStorage.setItem(ACTIVE_SERVICE_KEY, JSON.stringify({
      savedAt: new Date().toISOString(),
      cfg: {
        url: cfg.url,
        token: cfg.token,
      },
      activeIndex: 0,
      items,
    }));

    window.location.href = 'operator.html';
  } catch (err) {
    alert(`Erro ao abrir operador: ${String(err?.message || err || 'falha desconhecida')}`);
  } finally {
    showLoading(false);
  }
}

// ── UI helpers ────────────────────────────────────────────────────────────────
function showSetup(error = '') {
  document.getElementById('setup-overlay').style.display = 'flex';
  document.getElementById('app').classList.add('hidden');
  document.getElementById('setup-error').textContent = error;
}
function showApp() {
  document.getElementById('setup-overlay').style.display = 'none';
  document.getElementById('app').classList.remove('hidden');
}
function showLoading(show) {
  document.getElementById('loading').style.display = show ? 'flex' : 'none';
}
function escHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Boot ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const setupUrlEl = document.getElementById('setup-url');
  const setupTokenEl = document.getElementById('setup-token');
  const setupSaveBtn = document.getElementById('setup-save');
  setupUrlEl.addEventListener('blur', () => {
    const normalized = normalizeBaseUrl(setupUrlEl.value || '');
    if (normalized) setupUrlEl.value = normalized;
  });
  setupTokenEl.addEventListener('blur', () => {
    setupTokenEl.value = stripBearerPrefix(setupTokenEl.value || '');
  });
  [setupUrlEl, setupTokenEl].forEach(field => {
    field.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      setupSaveBtn.click();
    });
  });

  setupSaveBtn.addEventListener('click', async () => {
    const rawUrl = setupUrlEl.value;
    const rawToken = setupTokenEl.value;
    const next = sanitizeWebConfig({ url: rawUrl, token: rawToken });
    if (!next.url) {
      document.getElementById('setup-error').textContent = 'Informe uma URL válida do repositório.';
      return;
    }
    cfg = {
      ...cfg,
      ...next,
    };
    setupUrlEl.value = cfg.url;
    setupTokenEl.value = cfg.token;
    saveConfig();
    await connect();
  });

  document.getElementById('search').addEventListener('input', e => {
    searchQuery = e.target.value;
    filterAndRender();
  });

  document.getElementById('save-service').addEventListener('click', saveService);
  document.getElementById('plan-save').addEventListener('click', saveService);
  document.getElementById('load-next-service').addEventListener('click', loadNextService);

  document.getElementById('playlist-select').addEventListener('change', e => {
    if (e.target.value) loadPlaylist(e.target.value);
  });

  document.getElementById('plan-date').addEventListener('change', readPlanControls);
  document.getElementById('plan-slot').addEventListener('change', readPlanControls);

  document.getElementById('btn-settings').addEventListener('click', () => {
    document.getElementById('setup-url').value = cfg.url;
    document.getElementById('setup-token').value = cfg.token;
    showSetup();
  });

  document.getElementById('open-operator').addEventListener('click', openOperator);

  init();
});
