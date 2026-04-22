'use strict';

const express = require('express');
const { asyncHandler } = require('../utils/async');
const { requireLogin } = require('../middleware/auth');
const {
  assertSyncToken,
  syncFromPromidia,
  listRecentSyncLogs,
  getSyncAuthStatus,
  rotateManagedSyncToken,
  clearManagedSyncToken,
} = require('../services/promidia-sync');

const router = express.Router();

router.get('/integracoes/sync-logs', requireLogin, asyncHandler(async (req, res) => {
  const logs = await listRecentSyncLogs(50);
  const syncAuth = await getSyncAuthStatus();
  const oneTimeToken = String(req.session.promidiaOneTimeToken || '');
  req.session.promidiaOneTimeToken = '';
  const endpoint = `${req.protocol}://${req.get('host')}/api/integrations/promidia/sync-hymns`;
  return res.render('sync-logs', {
    logs,
    syncAuth,
    endpoint,
    oneTimeToken,
  });
}));

router.post('/integracoes/sync-token/regenerate', requireLogin, asyncHandler(async (req, res) => {
  const rotated = await rotateManagedSyncToken();
  req.session.promidiaOneTimeToken = rotated.token;
  return res.redirect('/integracoes/sync-logs');
}));

router.post('/integracoes/sync-token/clear', requireLogin, asyncHandler(async (req, res) => {
  await clearManagedSyncToken();
  req.session.promidiaOneTimeToken = '';
  return res.redirect('/integracoes/sync-logs');
}));

router.post('/api/integrations/promidia/sync-hymns', asyncHandler(async (req, res) => {
  const token = req.headers['x-sync-token'] || req.headers.authorization || req.query.token || '';
  try {
    await assertSyncToken(token);
  } catch (err) {
    return res.status(401).json({ ok: false, error: String(err.message || 'UNAUTHORIZED') });
  }
  try {
    const result = await syncFromPromidia(req.body || {});
    return res.json({
      ok: true,
      result,
      syncedAt: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: String(err?.message || 'SYNC_FAILED'),
    });
  }
}));

router.get('/api/integrations/promidia/ping', asyncHandler(async (req, res) => {
  const token = req.headers['x-sync-token'] || req.headers.authorization || req.query.token || '';
  try {
    await assertSyncToken(token);
  } catch (err) {
    return res.status(401).json({ ok: false, error: String(err.message || 'UNAUTHORIZED') });
  }
  return res.json({ ok: true, serverTime: new Date().toISOString() });
}));

module.exports = router;
