'use strict';

const crypto = require('crypto');
const express = require('express');
const { db } = require('../db/pool');
const { asyncHandler } = require('../utils/async');
const { requireLogin } = require('../middleware/auth');
const {
  getStatus,
  buildAuthorizeUrl,
  exchangeCode,
  disconnect,
  listServiceTypes,
  listPlans,
  previewPlanImport,
  importPreviewToService,
} = require('../services/planning-center');
const {
  normalizeDateOnly,
  normalizeNullableText,
  normalizeShortText,
} = require('../utils/validation');

const router = express.Router();

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

async function loadPlanningPageContext() {
  const [recentServices] = await db.query(`
    SELECT id, service_date, playlist_name, notes
    FROM services
    ORDER BY service_date DESC
    LIMIT 40
  `);
  const [promidiaPlaylists] = await db.query(`
    SELECT name
    FROM promidia_playlists
    WHERE provider = 'promidia'
    ORDER BY updated_at DESC, id DESC
    LIMIT 120
  `);
  return {
    recentServices,
    promidiaPlaylistNames: [...new Set((promidiaPlaylists || []).map(row => String(row?.name || '').trim()).filter(Boolean))],
  };
}

router.get('/integracoes/planning-center', requireLogin, asyncHandler(async (req, res) => {
  const status = await getStatus();
  const { recentServices, promidiaPlaylistNames } = await loadPlanningPageContext();
  res.render('planning-center', {
    status,
    recentServices,
    promidiaPlaylistNames,
    error: null,
    result: null,
  });
}));

router.post('/integracoes/planning-center/connect', requireLogin, asyncHandler(async (req, res) => {
  const state = crypto.randomBytes(24).toString('hex');
  req.session.pcoOauthState = state;
  const authUrl = buildAuthorizeUrl(state);
  return res.redirect(authUrl);
}));

router.get('/integracoes/planning-center/callback', requireLogin, asyncHandler(async (req, res) => {
  const code = normalizeShortText(req.query.code || '', 300);
  const state = normalizeShortText(req.query.state || '', 200);
  const expected = normalizeShortText(req.session.pcoOauthState || '', 200);
  req.session.pcoOauthState = null;

  if (!code || !state || !expected || state !== expected) {
    const status = await getStatus();
    const { recentServices, promidiaPlaylistNames } = await loadPlanningPageContext();
    return res.status(400).render('planning-center', {
      status,
      recentServices,
      promidiaPlaylistNames,
      error: 'Falha na validação do retorno OAuth (state inválido).',
      result: null,
    });
  }

  await exchangeCode(code);
  return res.redirect('/integracoes/planning-center');
}));

router.post('/integracoes/planning-center/disconnect', requireLogin, asyncHandler(async (req, res) => {
  await disconnect();
  return res.redirect('/integracoes/planning-center');
}));

router.get('/api/planning-center/status', requireLogin, asyncHandler(async (req, res) => {
  const status = await getStatus();
  res.json({ ok: true, status });
}));

router.get('/api/planning-center/service-types', requireLogin, asyncHandler(async (req, res) => {
  const rows = await listServiceTypes();
  res.json({ ok: true, serviceTypes: rows });
}));

router.get('/api/planning-center/plans', requireLogin, asyncHandler(async (req, res) => {
  const serviceTypeId = normalizeShortText(req.query.serviceTypeId || '', 40);
  if (!serviceTypeId) return res.status(400).json({ ok: false, error: 'MISSING_SERVICE_TYPE_ID' });
  const rows = await listPlans(serviceTypeId);
  res.json({ ok: true, plans: rows });
}));

router.get('/api/planning-center/preview', requireLogin, asyncHandler(async (req, res) => {
  const serviceTypeId = normalizeShortText(req.query.serviceTypeId || '', 40);
  const planId = normalizeShortText(req.query.planId || '', 40);
  const tolerance = normalizeShortText(req.query.tolerance || 'balanced', 20).toLowerCase();
  if (!serviceTypeId || !planId) {
    return res.status(400).json({ ok: false, error: 'MISSING_PLAN_SELECTION' });
  }
  const preview = await previewPlanImport({
    serviceTypeId,
    planId,
    tolerance,
  });
  return res.json({ ok: true, preview });
}));

router.post('/api/planning-center/import', requireLogin, asyncHandler(async (req, res) => {
  const serviceTypeId = normalizeShortText(req.body.serviceTypeId || '', 40);
  const planId = normalizeShortText(req.body.planId || '', 40);
  const tolerance = normalizeShortText(req.body.tolerance || 'balanced', 20).toLowerCase();
  const localPlaylistName = normalizeNullableText(req.body.localPlaylistName || '', 255);
  const localDate = normalizeDateOnly(req.body.localDate || '');
  const importMode = normalizeShortText(req.body.importMode || 'append', 20).toLowerCase();
  const maxSlots = Number(req.body.maxSlots || 5);

  if (!serviceTypeId || !planId || !localPlaylistName || !localDate) {
    return res.status(400).json({ ok: false, error: 'MISSING_REQUIRED_FIELDS' });
  }
  if (!await isPromidiaPlaylistName(localPlaylistName)) {
    return res.status(400).json({ ok: false, error: 'INVALID_LOCAL_PLAYLIST' });
  }

  const preview = await previewPlanImport({
    serviceTypeId,
    planId,
    tolerance,
  });

  const result = await importPreviewToService({
    preview,
    localPlaylistName,
    localDate,
    importMode,
    maxSlots,
  });

  return res.json({ ok: true, result, previewSummary: preview.summary });
}));

module.exports = router;
