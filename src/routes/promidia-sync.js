'use strict';

const express = require('express');
const { asyncHandler } = require('../utils/async');
const { requireLogin } = require('../middleware/auth');
const { normalizeShortText } = require('../utils/validation');
const {
  assertSyncToken,
  syncFromPromidia,
  listRecentSyncLogs,
  getSyncAuthStatus,
  rotateManagedSyncToken,
  clearManagedSyncToken,
  replayLastPromidiaSync,
  getLatestSyncPayloadInfo,
  getNextServiceForPromidia,
} = require('../services/promidia-sync');

const router = express.Router();

router.get('/integracoes/sync-logs', requireLogin, asyncHandler(async (req, res) => {
  const logs = await listRecentSyncLogs(50);
  const syncAuth = await getSyncAuthStatus();
  const latestPayloadInfo = await getLatestSyncPayloadInfo();
  const oneTimeToken = String(req.session.promidiaOneTimeToken || '');
  req.session.promidiaOneTimeToken = '';
  const syncMessage = req.session.promidiaSyncMessage && typeof req.session.promidiaSyncMessage === 'object'
    ? req.session.promidiaSyncMessage
    : null;
  req.session.promidiaSyncMessage = null;
  const endpoint = `${req.protocol}://${req.get('host')}/api/integrations/promidia/sync-hymns`;
  return res.render('sync-logs', {
    logs,
    syncAuth,
    latestPayloadInfo,
    syncMessage,
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

router.post('/integracoes/sync-now', requireLogin, asyncHandler(async (req, res) => {
  try {
    const replay = await replayLastPromidiaSync();
    const info = replay?.result || {};
    req.session.promidiaSyncMessage = {
      type: 'ok',
      text: `Sync manual concluído: hinos proc ${info.processed || 0}, playlists proc ${info.playlistsProcessed || 0}.`,
    };
  } catch (err) {
    const code = String(err?.message || 'PROMIDIA_SYNC_MANUAL_FAILED');
    req.session.promidiaSyncMessage = {
      type: 'error',
      text: code === 'PROMIDIA_SYNC_NO_LAST_PAYLOAD'
        ? 'Nenhum pacote recebido ainda. Rode o Sync no app Promidia primeiro.'
        : `Falha no sync manual: ${code}`,
    };
  }
  return res.redirect('/integracoes/sync-logs');
}));

router.post('/api/integrations/promidia/replay-last', requireLogin, asyncHandler(async (req, res) => {
  try {
    const replay = await replayLastPromidiaSync();
    return res.json({ ok: true, replay });
  } catch (err) {
    const code = String(err?.message || 'PROMIDIA_SYNC_MANUAL_FAILED');
    return res.status(400).json({ ok: false, error: code });
  }
}));

router.get('/api/integrations/promidia/next-service', asyncHandler(async (req, res) => {
  const token = req.headers['x-sync-token'] || req.headers.authorization || req.query.token || '';
  try {
    await assertSyncToken(token);
  } catch (err) {
    return res.status(401).json({ ok: false, error: String(err.message || 'UNAUTHORIZED') });
  }
  const fromDate = normalizeShortText(req.query.fromDate || '', 12);
  const plan = await getNextServiceForPromidia({ fromDate });
  if (!plan) {
    return res.status(404).json({ ok: false, error: 'NO_SERVICE_AVAILABLE' });
  }
  return res.json({
    ok: true,
    plan,
    fetchedAt: new Date().toISOString(),
  });
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
