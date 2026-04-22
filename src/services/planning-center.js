'use strict';

const crypto = require('crypto');
const { db } = require('../db/pool');
const { getSetting, setSetting, deleteSetting } = require('../db/settings-store');
const { config } = require('../config');
const { encryptJson, decryptJson } = require('../utils/crypto-json');
const {
  normalizeShortText,
  normalizeDateOnly,
  normalizeNullableText,
  toPositiveInt,
} = require('../utils/validation');

const AUTH_URL = 'https://api.planningcenteronline.com/oauth/authorize';
const TOKEN_URL = 'https://api.planningcenteronline.com/oauth/token';
const REVOKE_URL = 'https://api.planningcenteronline.com/oauth/revoke';
const API_BASE = 'https://api.planningcenteronline.com';
const SETTING_KEY = 'planning_center_oauth_state';
const REFRESH_SKEW_MS = 60 * 1000;

const TOLERANCE = {
  strict: { min: 0.9, delta: 0.1 },
  balanced: { min: 0.78, delta: 0.06 },
  aggressive: { min: 0.66, delta: 0.04 },
};

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function normalizeText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' e ')
    .replace(/['".,!?()[\]{}:_/-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(value = '') {
  const stop = new Set(['a', 'as', 'ao', 'com', 'da', 'das', 'de', 'do', 'dos', 'e', 'em', 'na', 'nas', 'no', 'nos', 'o', 'os', 'the']);
  return normalizeText(value)
    .split(' ')
    .map(s => s.trim())
    .filter(Boolean)
    .filter(s => !stop.has(s));
}

function setSimilarity(a = [], b = []) {
  if (!a.length || !b.length) return 0;
  const aSet = new Set(a);
  const bSet = new Set(b);
  let hit = 0;
  aSet.forEach(word => {
    if (bSet.has(word)) hit += 1;
  });
  return hit / Math.max(aSet.size, bSet.size, 1);
}

function bigrams(value = '') {
  const text = normalizeText(value);
  if (!text) return [];
  if (text.length < 2) return [text];
  const out = [];
  for (let i = 0; i < text.length - 1; i += 1) {
    out.push(text.slice(i, i + 2));
  }
  return out;
}

function dice(a = '', b = '') {
  const left = bigrams(a);
  const right = bigrams(b);
  if (!left.length || !right.length) return 0;
  const count = new Map();
  left.forEach(token => count.set(token, (count.get(token) || 0) + 1));
  let overlap = 0;
  right.forEach(token => {
    const cur = count.get(token) || 0;
    if (cur > 0) {
      overlap += 1;
      count.set(token, cur - 1);
    }
  });
  return (2 * overlap) / (left.length + right.length);
}

function extractNumbers(value = '') {
  return (String(value || '').match(/\d+/g) || []).map(v => Number(v));
}

function scoreMatch(itemTitle, hymn) {
  const itemTokens = tokens(itemTitle);
  const itemNums = extractNumbers(itemTitle);
  const candidates = [
    hymn.title || '',
    hymn.english_title || '',
    `${hymn.number || ''}`,
  ].filter(Boolean);

  let tokenScore = 0;
  let diceScore = 0;
  candidates.forEach(label => {
    tokenScore = Math.max(tokenScore, setSimilarity(itemTokens, tokens(label)));
    diceScore = Math.max(diceScore, dice(itemTitle, label));
  });

  const hymnNums = [
    ...(Number.isFinite(Number(hymn.number)) && Number(hymn.number) > 0 ? [Number(hymn.number)] : []),
    ...extractNumbers(`${hymn.title || ''} ${hymn.english_title || ''}`),
  ];
  const numericBonus = itemNums.length && hymnNums.length
    ? (itemNums.some(num => hymnNums.includes(num)) ? 0.08 : -0.05)
    : 0;

  const score = Math.max(0, Math.min(1, (tokenScore * 0.65) + (diceScore * 0.35) + numericBonus));
  return Number(score.toFixed(3));
}

function rankMatches(item, hymns = [], tolerance = 'balanced') {
  const mode = TOLERANCE[tolerance] ? tolerance : 'balanced';
  const ranked = hymns.map(hymn => ({
    hymnId: hymn.id,
    hymnTitle: hymn.title,
    confidence: scoreMatch(item.title || item.songTitle || item.mediaTitle || '', hymn),
  }))
    .filter(row => row.confidence > 0)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 3);

  const top = ranked[0] || null;
  const second = ranked[1] || null;
  const limits = TOLERANCE[mode];

  if (!top || top.confidence < limits.min) {
    return {
      status: 'unmatched',
      hymnId: null,
      confidence: top ? top.confidence : 0,
      reason: top ? 'best_score_below_threshold' : 'no_candidate',
      candidates: ranked,
    };
  }
  if (second && (top.confidence - second.confidence) < limits.delta) {
    return {
      status: 'ambiguous',
      hymnId: null,
      confidence: top.confidence,
      reason: 'multiple_close_candidates',
      candidates: ranked,
    };
  }
  return {
    status: 'matched',
    hymnId: top.hymnId,
    confidence: top.confidence,
    reason: 'title_similarity',
    candidates: ranked,
  };
}

async function getState() {
  const saved = await getSetting(SETTING_KEY);
  if (!saved || typeof saved !== 'object') {
    return { token: null, profile: null, connectedAt: null, importedAt: null };
  }
  return {
    token: decryptJson(saved.token, config.crypto.appEncryptionKey),
    profile: saved.profile || null,
    connectedAt: saved.connectedAt || null,
    importedAt: saved.importedAt || null,
  };
}

async function saveState(next = {}) {
  const payload = {
    token: encryptJson(next.token || null, config.crypto.appEncryptionKey),
    profile: next.profile || null,
    connectedAt: next.connectedAt || null,
    importedAt: next.importedAt || null,
  };
  await setSetting(SETTING_KEY, payload);
}

function assertConfigured() {
  if (!config.planningCenter.clientId || !config.planningCenter.clientSecret || !config.planningCenter.redirectUri) {
    throw new Error('PCO_NOT_CONFIGURED');
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = payload?.errors?.[0]?.detail || payload?.error_description || payload?.error || `HTTP_${response.status}`;
    throw new Error(`PCO_REQUEST_FAILED:${detail}`);
  }
  return payload;
}

async function tokenRequest(body) {
  const params = new URLSearchParams();
  Object.entries(body || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    params.append(key, String(value));
  });
  return fetchJson(TOKEN_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });
}

async function fetchProfile(accessToken) {
  const response = await fetchJson(`${API_BASE}/current/v2/me`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': 'Hinos Planning Center Integration',
    },
  });
  const data = response?.data || {};
  const attrs = data.attributes || {};
  const rel = data.relationships || {};
  return {
    id: String(data.id || ''),
    organizationId: String(rel?.organization?.data?.id || ''),
    firstName: normalizeShortText(attrs.first_name || '', 100),
    lastName: normalizeShortText(attrs.last_name || '', 100),
    name: normalizeShortText(`${attrs.first_name || ''} ${attrs.last_name || ''}`, 200),
  };
}

function buildAuthorizeUrl(sessionState) {
  assertConfigured();
  const params = new URLSearchParams({
    client_id: config.planningCenter.clientId,
    redirect_uri: config.planningCenter.redirectUri,
    response_type: 'code',
    scope: config.planningCenter.scope,
    state: sessionState,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

async function exchangeCode(code) {
  assertConfigured();
  const payload = await tokenRequest({
    grant_type: 'authorization_code',
    code,
    client_id: config.planningCenter.clientId,
    client_secret: config.planningCenter.clientSecret,
    redirect_uri: config.planningCenter.redirectUri,
  });
  const token = {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    tokenType: payload.token_type || 'bearer',
    createdAt: Number(payload.created_at || nowSec()),
    expiresIn: Number(payload.expires_in || 7200),
    expiresAtMs: (Number(payload.created_at || nowSec()) + Number(payload.expires_in || 7200)) * 1000,
    scope: payload.scope || '',
  };
  const profile = await fetchProfile(token.accessToken);
  await saveState({
    token,
    profile,
    connectedAt: new Date().toISOString(),
    importedAt: null,
  });
  return { token, profile };
}

async function refreshTokenIfNeeded() {
  const state = await getState();
  const token = state.token;
  if (!token || !token.accessToken || !token.refreshToken) {
    throw new Error('PCO_NOT_CONNECTED');
  }
  const expiresSoon = Number(token.expiresAtMs || 0) <= (Date.now() + REFRESH_SKEW_MS);
  if (!expiresSoon) return token.accessToken;

  const payload = await tokenRequest({
    grant_type: 'refresh_token',
    refresh_token: token.refreshToken,
    client_id: config.planningCenter.clientId,
    client_secret: config.planningCenter.clientSecret,
  });
  const nextToken = {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token || token.refreshToken,
    tokenType: payload.token_type || 'bearer',
    createdAt: Number(payload.created_at || nowSec()),
    expiresIn: Number(payload.expires_in || 7200),
    expiresAtMs: (Number(payload.created_at || nowSec()) + Number(payload.expires_in || 7200)) * 1000,
    scope: payload.scope || token.scope || '',
  };
  await saveState({
    ...state,
    token: nextToken,
  });
  return nextToken.accessToken;
}

async function disconnect() {
  const state = await getState();
  const token = state.token;
  if (token && token.refreshToken) {
    const body = new URLSearchParams({
      token: token.refreshToken,
      token_type_hint: 'refresh_token',
      client_id: config.planningCenter.clientId,
      client_secret: config.planningCenter.clientSecret,
    });
    await fetch(REVOKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    }).catch(() => {});
  }
  await deleteSetting(SETTING_KEY);
}

async function apiListAll(url) {
  const accessToken = await refreshTokenIfNeeded();
  let next = url;
  const allData = [];
  const allIncluded = [];
  let guard = 0;
  while (next && guard < 50) {
    guard += 1;
    const response = await fetchJson(next, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
        'User-Agent': 'Hinos Planning Center Integration',
      },
    });
    if (Array.isArray(response.data)) allData.push(...response.data);
    if (Array.isArray(response.included)) allIncluded.push(...response.included);
    next = response?.links?.next || '';
  }
  return { data: allData, included: allIncluded };
}

async function listServiceTypes() {
  const page = await apiListAll(`${API_BASE}/services/v2/service_types?per_page=100&order=sequence`);
  return page.data.map(row => ({
    id: String(row.id || ''),
    name: normalizeShortText(row?.attributes?.name || '', 200),
    archivedAt: row?.attributes?.archived_at || null,
    sequence: Number(row?.attributes?.sequence || 0),
  })).filter(row => row.id && row.name);
}

async function listPlans(serviceTypeId) {
  const safeId = String(serviceTypeId || '').trim();
  if (!safeId) throw new Error('MISSING_SERVICE_TYPE_ID');
  const page = await apiListAll(`${API_BASE}/services/v2/service_types/${safeId}/plans?per_page=100&order=-sort_date`);
  return page.data.map(row => ({
    id: String(row.id || ''),
    title: normalizeShortText(row?.attributes?.title || '', 255),
    seriesTitle: normalizeShortText(row?.attributes?.series_title || '', 255),
    dates: normalizeShortText(row?.attributes?.dates || '', 80),
    shortDates: normalizeShortText(row?.attributes?.short_dates || '', 80),
    sortDate: normalizeShortText(row?.attributes?.sort_date || '', 20),
    itemCount: Number(row?.attributes?.items_count || 0),
  })).filter(row => row.id);
}

function indexIncluded(included = []) {
  const out = new Map();
  included.forEach(row => {
    if (!row?.type || !row?.id) return;
    out.set(`${row.type}:${row.id}`, row);
  });
  return out;
}

async function listPlanItems(serviceTypeId, planId) {
  const safeTypeId = String(serviceTypeId || '').trim();
  const safePlanId = String(planId || '').trim();
  if (!safeTypeId || !safePlanId) throw new Error('MISSING_PLAN_IDS');

  const url = `${API_BASE}/services/v2/service_types/${safeTypeId}/plans/${safePlanId}/items?per_page=100&order=sequence&include=song,media,item_notes`;
  const page = await apiListAll(url);
  const map = indexIncluded(page.included || []);

  return page.data.map(item => {
    const attrs = item.attributes || {};
    const rel = item.relationships || {};
    const song = rel?.song?.data ? map.get(`Song:${rel.song.data.id}`) : null;
    const media = rel?.media?.data ? map.get(`Media:${rel.media.data.id}`) : null;
    const noteRows = Array.isArray(rel?.item_notes?.data) ? rel.item_notes.data : [];
    const notes = noteRows
      .map(row => map.get(`ItemNote:${row.id}`))
      .map(row => normalizeShortText(row?.attributes?.content || '', 600))
      .filter(Boolean)
      .join(' | ');
    return {
      pcoItemId: String(item.id || ''),
      title: normalizeShortText(
        attrs.title
        || song?.attributes?.title
        || media?.attributes?.title
        || '',
        255
      ),
      itemType: normalizeShortText(attrs.item_type || 'item', 60).toLowerCase(),
      sequence: Number(attrs.sequence || 0),
      notes,
      servicePosition: normalizeShortText(attrs.service_position || 'during', 40),
      songTitle: normalizeShortText(song?.attributes?.title || '', 255),
      mediaTitle: normalizeShortText(media?.attributes?.title || '', 255),
    };
  }).filter(row => row.pcoItemId);
}

async function listHymnsForMatching() {
  const [rows] = await db.query(`
    SELECT h.id, h.number, h.title, h.english_title, hy.code AS hymnal
    FROM hymns h
    JOIN hymnals hy ON hy.id = h.hymnal_id
    ORDER BY hy.code, h.number
  `);
  return rows;
}

function mapItemsToHymns(items = [], hymns = [], tolerance = 'balanced') {
  const safeTolerance = TOLERANCE[tolerance] ? tolerance : 'balanced';
  const mapped = items.map(item => ({
    ...item,
    match: rankMatches(item, hymns, safeTolerance),
  }));
  const summary = {
    total: mapped.length,
    matched: mapped.filter(r => r.match.status === 'matched').length,
    ambiguous: mapped.filter(r => r.match.status === 'ambiguous').length,
    unmatched: mapped.filter(r => r.match.status === 'unmatched').length,
  };
  return { tolerance: safeTolerance, items: mapped, summary };
}

async function previewPlanImport({ serviceTypeId, planId, tolerance }) {
  const [serviceTypes, plans, planItems, hymns] = await Promise.all([
    listServiceTypes(),
    listPlans(serviceTypeId),
    listPlanItems(serviceTypeId, planId),
    listHymnsForMatching(),
  ]);
  const mapped = mapItemsToHymns(planItems, hymns, tolerance);
  const serviceType = serviceTypes.find(s => String(s.id) === String(serviceTypeId));
  const plan = plans.find(p => String(p.id) === String(planId));
  const state = await getState();
  return {
    organizationId: state?.profile?.organizationId || '',
    serviceTypeId: String(serviceTypeId),
    serviceTypeName: serviceType?.name || '',
    planId: String(planId),
    planTitle: plan?.title || '',
    planDate: plan?.sortDate || plan?.dates || '',
    fetchedAt: new Date().toISOString(),
    tolerance: mapped.tolerance,
    items: mapped.items,
    summary: mapped.summary,
  };
}

async function importPreviewToService(payload = {}) {
  const preview = payload.preview && typeof payload.preview === 'object' ? payload.preview : null;
  if (!preview || !Array.isArray(preview.items)) throw new Error('MISSING_PREVIEW');
  const localPlaylistName = normalizeNullableText(payload.localPlaylistName || '', 255);
  const localDate = normalizeDateOnly(payload.localDate || '');
  const importMode = String(payload.importMode || '').trim().toLowerCase() === 'replace'
    ? 'replace'
    : 'append';
  const maxSlots = Math.max(1, Math.min(5, toPositiveInt(payload.maxSlots, 5)));
  if (!localPlaylistName || !localDate) throw new Error('INVALID_LOCAL_SERVICE_INFO');

  const matchedIds = preview.items
    .filter(item => item?.match?.status === 'matched' && item?.match?.hymnId)
    .map(item => Number(item.match.hymnId))
    .filter(Number.isFinite)
    .slice(0, maxSlots);
  if (!matchedIds.length) throw new Error('NO_MATCHED_ITEMS');

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    let serviceId = null;
    if (importMode === 'replace') {
      await conn.query('DELETE FROM services WHERE service_date = ? AND playlist_name = ?', [localDate, localPlaylistName]);
    } else {
      const [[existing]] = await conn.query(
        'SELECT id FROM services WHERE service_date = ? AND playlist_name = ? LIMIT 1',
        [localDate, localPlaylistName]
      );
      if (existing) serviceId = existing.id;
    }

    if (!serviceId) {
      const [insertService] = await conn.query(
        'INSERT INTO services (service_date, service_type, playlist_name, notes) VALUES (?, ?, ?, ?)',
        [localDate, 'especial', localPlaylistName, normalizeShortText(`Importado de Planning Center: ${preview.planTitle || preview.planId}`, 500)]
      );
      serviceId = insertService.insertId;
    } else {
      await conn.query('DELETE FROM service_hymns WHERE service_id = ?', [serviceId]);
    }

    for (let i = 0; i < matchedIds.length; i += 1) {
      await conn.query(
        'INSERT INTO service_hymns (service_id, hymn_id, position) VALUES (?, ?, ?)',
        [serviceId, matchedIds[i], i + 1]
      );
    }

    await conn.commit();
    const state = await getState();
    await saveState({
      ...state,
      importedAt: new Date().toISOString(),
    });
    return {
      serviceId,
      importedCount: matchedIds.length,
      skippedCount: Math.max(0, preview.items.length - matchedIds.length),
      importMode,
      maxSlots,
    };
  } catch (err) {
    try { await conn.rollback(); } catch {}
    throw err;
  } finally {
    conn.release();
  }
}

async function getStatus() {
  const state = await getState();
  const token = state.token;
  const expiresAtMs = Number(token?.expiresAtMs || 0);
  return {
    configured: Boolean(config.planningCenter.clientId && config.planningCenter.clientSecret && config.planningCenter.redirectUri),
    connected: Boolean(token?.accessToken && token?.refreshToken),
    expiresAt: expiresAtMs || null,
    expired: expiresAtMs ? expiresAtMs <= Date.now() : false,
    scope: config.planningCenter.scope,
    redirectUri: config.planningCenter.redirectUri,
    profile: state.profile || null,
    encryptedAtRest: Boolean(config.crypto.appEncryptionKey),
    importedAt: state.importedAt || null,
  };
}

module.exports = {
  buildAuthorizeUrl,
  exchangeCode,
  disconnect,
  getStatus,
  listServiceTypes,
  listPlans,
  previewPlanImport,
  importPreviewToService,
};
