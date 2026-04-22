'use strict';

const express = require('express');
const { db } = require('../db/pool');
const { asyncHandler } = require('../utils/async');
const { requireLogin } = require('../middleware/auth');
const {
  normalizeDateOnly,
  normalizeNullableText,
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

function nextSundayIso(today = new Date()) {
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const day = base.getDay();
  const delta = day === 0 ? 7 : (7 - day);
  base.setDate(base.getDate() + delta);
  return toIsoDate(base);
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
  const safeLimit = Math.max(1, Math.min(1000, Number(limit) || 300));
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
  const templatePromidiaPlaylists = await listPromidiaPlaylistTemplates();
  return { templatePromidiaPlaylists };
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

async function isPromidiaPlaylistName(name = '') {
  const normalized = normalizeNullableText(name, 255);
  if (!normalized) return false;
  const [[row]] = await db.query(
    `SELECT 1
     FROM promidia_playlists
     WHERE provider = 'promidia' AND name = ?
     LIMIT 1`,
    [normalized]
  );
  return !!row;
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
  const requestedDate = normalizeDateOnly(req.query.date || '');
  const templates = await loadCreateTemplates();
  const catalogs = await loadPlannerCatalogs();
  const defaultDate = requestedDate || nextSundayIso();
  const formSeed = {
    service_date: defaultDate,
    playlist_name: '',
    notes: '',
  };

  res.render('service-form', {
    service: null,
    slots: Array(5).fill(null),
    error: null,
    formSeed,
    templatePromidiaPlaylists: templates.templatePromidiaPlaylists,
    themes: catalogs.themes,
    hymnals: catalogs.hymnals,
  });
}));

router.post('/cultos', requireLogin, asyncHandler(async (req, res) => {
  const serviceDate = normalizeDateOnly(req.body.service_date);
  const playlistName = normalizeNullableText(req.body.playlist_name, 255);
  const notes = normalizeNullableText(req.body.notes, 500);
  const hymnIds = normalizeHymnIdSlots(req.body.hymn_ids);
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
      templatePromidiaPlaylists: templates.templatePromidiaPlaylists,
      themes: catalogs.themes,
      hymnals: catalogs.hymnals,
    });
  }
  if (!await isPromidiaPlaylistName(playlistName)) {
    return res.status(422).render('service-form', {
      service: null,
      slots: slotsForRender,
      error: 'Selecione uma playlist já sincronizada do Promidia.',
      formSeed,
      templatePromidiaPlaylists: templates.templatePromidiaPlaylists,
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
        templatePromidiaPlaylists: templates.templatePromidiaPlaylists,
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
    templatePromidiaPlaylists: templates.templatePromidiaPlaylists,
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
  const slotsForRender = await buildSlotsFromHymnIds(hymnIds);

  if (!serviceDate || !playlistName) {
    const [[service]] = await db.query('SELECT * FROM services WHERE id = ?', [serviceId]);
    return res.status(422).render('service-form', {
      service: service || null,
      slots: slotsForRender,
      error: 'Data e nome da playlist são obrigatórios.',
      formSeed: null,
      templatePromidiaPlaylists: templates.templatePromidiaPlaylists,
      themes: catalogs.themes,
      hymnals: catalogs.hymnals,
    });
  }
  if (!await isPromidiaPlaylistName(playlistName)) {
    const [[service]] = await db.query('SELECT * FROM services WHERE id = ?', [serviceId]);
    return res.status(422).render('service-form', {
      service: service || null,
      slots: slotsForRender,
      error: 'Selecione uma playlist já sincronizada do Promidia.',
      formSeed: null,
      templatePromidiaPlaylists: templates.templatePromidiaPlaylists,
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
        slots: slotsForRender,
        error: 'Já existe um culto registrado para essa data e playlist.',
        formSeed: null,
        templatePromidiaPlaylists: templates.templatePromidiaPlaylists,
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
