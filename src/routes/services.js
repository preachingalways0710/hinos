'use strict';

const express = require('express');
const { db } = require('../db/pool');
const { asyncHandler } = require('../utils/async');
const { requireLogin } = require('../middleware/auth');
const {
  normalizeDateOnly,
  normalizeNullableText,
  normalizeShortText,
  toPositiveInt,
} = require('../utils/validation');

const router = express.Router();

function normalizeHymnIdSlots(input = []) {
  return []
    .concat(input || [])
    .map(value => toPositiveInt(value, 0))
    .filter(value => value > 0)
    .slice(0, 5);
}

function toIsoDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseIsoDate(value = '') {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function nextSundayIso(today = new Date()) {
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const day = base.getDay();
  const delta = day === 0 ? 7 : (7 - day);
  base.setDate(base.getDate() + delta);
  return toIsoDate(base);
}

function parseDateFromPlaylistName(name = '') {
  const text = String(name || '').trim();
  if (!text) return '';
  function toValidIso(y, m, d) {
    if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return '';
    if (m < 1 || m > 12 || d < 1 || d > 31) return '';
    const date = new Date(y, m - 1, d);
    if (date.getFullYear() !== y || (date.getMonth() + 1) !== m || date.getDate() !== d) return '';
    return toIsoDate(date);
  }
  const isoMatch = text.match(/(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (isoMatch) {
    const y = Number(isoMatch[1]);
    const m = Number(isoMatch[2]);
    const d = Number(isoMatch[3]);
    return toValidIso(y, m, d);
  }
  const brMatch = text.match(/(\d{1,2})[-/.](\d{1,2})(?:[-/.](20\d{2}))?/);
  if (!brMatch) return '';
  const d = Number(brMatch[1]);
  const m = Number(brMatch[2]);
  const y = Number(brMatch[3] || new Date().getFullYear());
  return toValidIso(y, m, d);
}

function chooseBestPromidiaTemplate(templates = [], targetDate = '') {
  if (!Array.isArray(templates) || !templates.length) return null;
  const target = parseIsoDate(targetDate || '') || parseIsoDate(nextSundayIso());
  if (!target) return null;
  const withDate = templates
    .map(row => {
      const parsed = parseDateFromPlaylistName(row?.name || '');
      return {
        row,
        parsed,
        dateObj: parseIsoDate(parsed || ''),
      };
    })
    .filter(entry => !!entry.dateObj);
  if (!withDate.length) return null;

  const windowEnd = new Date(target.getTime());
  windowEnd.setDate(windowEnd.getDate() + 42);
  const upcoming = withDate
    .filter(entry => entry.dateObj >= target && entry.dateObj <= windowEnd)
    .sort((a, b) => a.dateObj - b.dateObj);
  if (upcoming.length) return upcoming[0].row;

  const fallback = withDate
    .sort((a, b) => {
      const distA = Math.abs(a.dateObj - target);
      const distB = Math.abs(b.dateObj - target);
      return distA - distB;
    })[0];
  return fallback ? fallback.row : null;
}

async function listServiceTemplates(limit = 120) {
  const safeLimit = Math.max(1, Math.min(300, Number(limit) || 120));
  const [rows] = await db.query(`
    SELECT s.id, s.service_date, s.playlist_name, s.notes,
           COUNT(sh.id) AS hymn_count
    FROM services s
    LEFT JOIN service_hymns sh ON sh.service_id = s.id
    GROUP BY s.id, s.service_date, s.playlist_name, s.notes
    ORDER BY s.service_date DESC
    LIMIT ?
  `, [safeLimit]);
  return rows;
}

async function loadPlannerCatalogs() {
  const [themes, hymnals] = await Promise.all([
    db.query('SELECT id, name FROM themes ORDER BY name'),
    db.query('SELECT code, name FROM hymnals ORDER BY code'),
  ]);
  return {
    themes: themes[0] || [],
    hymnals: hymnals[0] || [],
  };
}

async function listPromidiaPlaylistTemplates(limit = 120) {
  const safeLimit = Math.max(1, Math.min(300, Number(limit) || 120));
  const [rows] = await db.query(`
    SELECT external_playlist_id, name, item_count, updated_at
    FROM promidia_playlists
    WHERE provider = 'promidia'
    ORDER BY updated_at DESC, id DESC
    LIMIT ?
  `, [safeLimit]);
  return rows;
}

async function loadCreateTemplates() {
  const [templateServices, templatePromidiaPlaylists] = await Promise.all([
    listServiceTemplates(),
    listPromidiaPlaylistTemplates(),
  ]);
  return { templateServices, templatePromidiaPlaylists };
}

function parseTemplateSelection(rawValue = '') {
  const raw = String(rawValue || '').trim();
  if (!raw) return { source: '', id: '', key: '' };
  if (/^\d+$/.test(raw)) {
    const id = toPositiveInt(raw, 0);
    return id ? { source: 'local', id, key: `local:${id}` } : { source: '', id: '', key: '' };
  }
  if (!raw.includes(':')) return { source: '', id: '', key: '' };
  const [sourceRaw, ...rest] = raw.split(':');
  const source = String(sourceRaw || '').trim().toLowerCase();
  const tail = rest.join(':');
  if (source === 'local') {
    const id = toPositiveInt(tail, 0);
    return id ? { source: 'local', id, key: `local:${id}` } : { source: '', id: '', key: '' };
  }
  if (source === 'promidia') {
    const id = normalizeShortText(tail, 120);
    return id ? { source: 'promidia', id, key: `promidia:${id}` } : { source: '', id: '', key: '' };
  }
  return { source: '', id: '', key: '' };
}

async function loadServiceSlots(serviceId) {
  const [shRows] = await db.query(`
    SELECT sh.position, h.id, h.number, h.title, hy.code AS hymnal
    FROM service_hymns sh
    JOIN hymns h    ON h.id = sh.hymn_id
    JOIN hymnals hy ON hy.id = h.hymnal_id
    WHERE sh.service_id = ?
    ORDER BY sh.position
  `, [serviceId]);
  const slots = Array(5).fill(null);
  for (const row of shRows) {
    if (row.position >= 1 && row.position <= 5) slots[row.position - 1] = row;
  }
  return slots;
}

async function loadPromidiaPlaylistSlots(externalPlaylistId) {
  const externalId = normalizeShortText(externalPlaylistId, 120);
  const empty = {
    slots: Array(5).fill(null),
    defaultPlaylistName: '',
    defaultNotes: '',
  };
  if (!externalId) return empty;
  const [[row]] = await db.query(
    `SELECT name, payload_json
     FROM promidia_playlists
     WHERE provider = 'promidia' AND external_playlist_id = ?
     LIMIT 1`,
    [externalId]
  );
  if (!row) return empty;

  let parsed = null;
  try {
    parsed = row.payload_json ? JSON.parse(row.payload_json) : null;
  } catch {
    parsed = null;
  }
  const items = Array.isArray(parsed?.items) ? parsed.items : [];
  const hymnExternalIds = items
    .filter(item => String(item?.kind || '').toLowerCase() === 'hymn')
    .map(item => normalizeShortText(item.hymnId || item.id || '', 80))
    .filter(Boolean);
  if (!hymnExternalIds.length) {
    return {
      ...empty,
      defaultPlaylistName: row.name ? String(row.name) : '',
      defaultNotes: row.name ? `Base Promidia: ${row.name}` : '',
    };
  }

  const [links] = await db.query(
    `SELECT external_id, hymn_id
     FROM external_hymn_links
     WHERE provider = 'promidia' AND external_id IN (?)`,
    [hymnExternalIds]
  );
  const hymnIdByExternal = new Map();
  links.forEach(link => {
    const external = normalizeShortText(link.external_id || '', 80);
    const hymnId = toPositiveInt(link.hymn_id, 0);
    if (!external || !hymnId || hymnIdByExternal.has(external)) return;
    hymnIdByExternal.set(external, hymnId);
  });
  const orderedLocalIds = hymnExternalIds
    .map(external => hymnIdByExternal.get(external) || 0)
    .filter(id => id > 0)
    .slice(0, 5);
  return {
    slots: await buildSlotsFromHymnIds(orderedLocalIds),
    defaultPlaylistName: row.name ? String(row.name) : '',
    defaultNotes: row.name ? `Base Promidia: ${row.name}` : '',
  };
}

async function buildSlotsFromHymnIds(hymnIds = []) {
  const slots = Array(5).fill(null);
  const ids = []
    .concat(hymnIds || [])
    .map(value => toPositiveInt(value, 0))
    .filter(Boolean);
  if (!ids.length) return slots;
  const [rows] = await db.query(`
    SELECT h.id, h.number, h.title, hy.code AS hymnal
    FROM hymns h
    JOIN hymnals hy ON hy.id = h.hymnal_id
    WHERE h.id IN (?)
  `, [ids]);
  const byId = new Map(rows.map(row => [Number(row.id), row]));
  ids.slice(0, 5).forEach((id, idx) => {
    slots[idx] = byId.get(Number(id)) || null;
  });
  return slots;
}

router.get('/cultos', requireLogin, asyncHandler(async (req, res) => {
  const [services] = await db.query(`
    SELECT s.id, s.service_date, s.playlist_name, s.notes,
           GROUP_CONCAT(
             CONCAT(hy.code, ' ', h.number, ' — ', h.title)
             ORDER BY sh.position SEPARATOR '\n'
           ) AS hymn_list
    FROM services s
    LEFT JOIN service_hymns sh ON sh.service_id = s.id
    LEFT JOIN hymns h          ON h.id = sh.hymn_id
    LEFT JOIN hymnals hy       ON hy.id = h.hymnal_id
    GROUP BY s.id
    ORDER BY s.service_date DESC
  `);
  res.render('services', { services });
}));

router.get('/cultos/novo', requireLogin, asyncHandler(async (req, res) => {
  let templateSelection = parseTemplateSelection(req.query.base || '');
  const requestedDate = normalizeDateOnly(req.query.date || '');
  const templates = await loadCreateTemplates();
  const catalogs = await loadPlannerCatalogs();
  let slots = Array(5).fill(null);
  const defaultDate = requestedDate || nextSundayIso();
  let formSeed = {
    service_date: defaultDate,
    playlist_name: '',
    notes: '',
  };

  if (!templateSelection.source) {
    const best = chooseBestPromidiaTemplate(templates.templatePromidiaPlaylists, defaultDate);
    if (best && best.external_playlist_id) {
      templateSelection = parseTemplateSelection(`promidia:${best.external_playlist_id}`);
    }
  }

  if (templateSelection.source === 'local' && templateSelection.id) {
    const [[sourceService]] = await db.query(
      'SELECT id, service_date, playlist_name, notes FROM services WHERE id = ?',
      [templateSelection.id]
    );
    if (sourceService) {
      formSeed = {
        service_date: defaultDate,
        playlist_name: sourceService.playlist_name || '',
        notes: sourceService.notes || '',
      };
      slots = await loadServiceSlots(sourceService.id);
    }
  } else if (templateSelection.source === 'promidia' && templateSelection.id) {
    const promidiaSeed = await loadPromidiaPlaylistSlots(templateSelection.id);
    formSeed = {
      service_date: defaultDate,
      playlist_name: promidiaSeed.defaultPlaylistName || '',
      notes: promidiaSeed.defaultNotes || '',
    };
    slots = promidiaSeed.slots;
  }

  res.render('service-form', {
    service: null,
    slots,
    error: null,
    formSeed,
    templateServices: templates.templateServices,
    templatePromidiaPlaylists: templates.templatePromidiaPlaylists,
    sourceTemplateKey: templateSelection.key || '',
    themes: catalogs.themes,
    hymnals: catalogs.hymnals,
  });
}));

router.post('/cultos', requireLogin, asyncHandler(async (req, res) => {
  const serviceDate = normalizeDateOnly(req.body.service_date);
  const playlistName = normalizeNullableText(req.body.playlist_name, 255);
  const notes = normalizeNullableText(req.body.notes, 500);
  const hymnIds = normalizeHymnIdSlots(req.body.hymn_ids);
  const sourceTemplate = parseTemplateSelection(req.body.base_template || req.body.base_service_id || '');
  const templates = await loadCreateTemplates();
  const catalogs = await loadPlannerCatalogs();
  const slotsForRender = await buildSlotsFromHymnIds(hymnIds);
  const formSeed = {
    service_date: serviceDate || String(req.body.service_date || '').trim(),
    playlist_name: playlistName || String(req.body.playlist_name || '').trim(),
    notes: notes || String(req.body.notes || '').trim(),
  };

  if (!serviceDate || !playlistName) {
    return res.status(422).render('service-form', {
      service: null,
      slots: slotsForRender,
      error: 'Data e nome da playlist são obrigatórios.',
      formSeed,
      templateServices: templates.templateServices,
      templatePromidiaPlaylists: templates.templatePromidiaPlaylists,
      sourceTemplateKey: sourceTemplate.key || '',
      themes: catalogs.themes,
      hymnals: catalogs.hymnals,
    });
  }

  try {
    const [result] = await db.query(
      'INSERT INTO services (service_date, service_type, playlist_name, notes) VALUES (?, ?, ?, ?)',
      [serviceDate, 'especial', playlistName, notes]
    );
    const serviceId = result.insertId;
    for (let i = 0; i < hymnIds.length; i += 1) {
      await db.query(
        'INSERT INTO service_hymns (service_id, hymn_id, position) VALUES (?, ?, ?)',
        [serviceId, hymnIds[i], i + 1]
      );
    }
    return res.redirect('/cultos');
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).render('service-form', {
        service: null,
        slots: slotsForRender,
        error: 'Já existe um culto registrado para essa data e playlist.',
        formSeed,
        templateServices: templates.templateServices,
        templatePromidiaPlaylists: templates.templatePromidiaPlaylists,
        sourceTemplateKey: sourceTemplate.key || '',
        themes: catalogs.themes,
        hymnals: catalogs.hymnals,
      });
    }
    throw err;
  }
}));

router.get('/cultos/:id/editar', requireLogin, asyncHandler(async (req, res) => {
  const serviceId = toPositiveInt(req.params.id);
  if (!serviceId) return res.redirect('/cultos');

  const [[service]] = await db.query('SELECT * FROM services WHERE id = ?', [serviceId]);
  if (!service) return res.redirect('/cultos');
  const slots = await loadServiceSlots(serviceId);
  const catalogs = await loadPlannerCatalogs();
  const templates = await loadCreateTemplates();
  res.render('service-form', {
    service,
    slots,
    error: null,
    formSeed: null,
    templateServices: [],
    templatePromidiaPlaylists: templates.templatePromidiaPlaylists,
    sourceTemplateKey: '',
    themes: catalogs.themes,
    hymnals: catalogs.hymnals,
  });
}));

router.post('/cultos/:id/atualizar', requireLogin, asyncHandler(async (req, res) => {
  const serviceId = toPositiveInt(req.params.id);
  if (!serviceId) return res.redirect('/cultos');

  const serviceDate = normalizeDateOnly(req.body.service_date);
  const playlistName = normalizeNullableText(req.body.playlist_name, 255);
  const notes = normalizeNullableText(req.body.notes, 500);
  const hymnIds = normalizeHymnIdSlots(req.body.hymn_ids);
  const catalogs = await loadPlannerCatalogs();
  const templates = await loadCreateTemplates();

  if (!serviceDate || !playlistName) {
    const [[service]] = await db.query('SELECT * FROM services WHERE id = ?', [serviceId]);
    return res.status(422).render('service-form', {
      service: service || null,
      slots: Array(5).fill(null),
      error: 'Data e nome da playlist são obrigatórios.',
      formSeed: null,
      templateServices: [],
      templatePromidiaPlaylists: templates.templatePromidiaPlaylists,
      sourceTemplateKey: '',
      themes: catalogs.themes,
      hymnals: catalogs.hymnals,
    });
  }

  try {
    await db.query(
      'UPDATE services SET service_date=?, playlist_name=?, notes=? WHERE id=?',
      [serviceDate, playlistName, notes, serviceId]
    );
    await db.query('DELETE FROM service_hymns WHERE service_id = ?', [serviceId]);
    for (let i = 0; i < hymnIds.length; i += 1) {
      await db.query(
        'INSERT INTO service_hymns (service_id, hymn_id, position) VALUES (?, ?, ?)',
        [serviceId, hymnIds[i], i + 1]
      );
    }
    return res.redirect('/cultos');
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      const [[service]] = await db.query('SELECT * FROM services WHERE id = ?', [serviceId]);
      return res.status(409).render('service-form', {
        service: service || null,
        slots: Array(5).fill(null),
        error: 'Já existe um culto registrado para essa data e playlist.',
        formSeed: null,
        templateServices: [],
        templatePromidiaPlaylists: templates.templatePromidiaPlaylists,
        sourceTemplateKey: '',
        themes: catalogs.themes,
        hymnals: catalogs.hymnals,
      });
    }
    throw err;
  }
}));

router.post('/api/cultos/:id/delete', requireLogin, asyncHandler(async (req, res) => {
  const serviceId = toPositiveInt(req.params.id);
  if (!serviceId) return res.status(400).json({ success: false, error: 'INVALID_ID' });
  await db.query('DELETE FROM services WHERE id = ?', [serviceId]);
  return res.json({ success: true });
}));

module.exports = router;
