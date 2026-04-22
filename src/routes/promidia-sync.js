'use strict';

const express = require('express');
const { asyncHandler } = require('../utils/async');
const { requireLogin } = require('../middleware/auth');
const { assertSyncToken, syncFromPromidia, listRecentSyncLogs } = require('../services/promidia-sync');

const router = express.Router();

router.get('/integracoes/sync-logs', requireLogin, asyncHandler(async (req, res) => {
  const logs = await listRecentSyncLogs(50);
  return res.render('sync-logs', { logs });
}));

router.post('/api/integrations/promidia/sync-hymns', asyncHandler(async (req, res) => {
  const token = req.headers['x-sync-token'] || req.headers.authorization || req.query.token || '';
  try {
    assertSyncToken(token);
  } catch (err) {
    return res.status(401).json({ ok: false, error: String(err.message || 'UNAUTHORIZED') });
  }
  const result = await syncFromPromidia(req.body || {});
  return res.json({
    ok: true,
    result,
    syncedAt: new Date().toISOString(),
  });
}));

module.exports = router;
