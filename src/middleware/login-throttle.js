'use strict';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 8;
const LOCK_MS = 20 * 60 * 1000;

const attempts = new Map();

function getClientKey(req) {
  return String(req.ip || req.headers['x-forwarded-for'] || 'unknown');
}

function pruneExpired(now = Date.now()) {
  for (const [key, row] of attempts.entries()) {
    if (!row) {
      attempts.delete(key);
      continue;
    }
    const noRecentAttempts = row.entries.every(ts => now - ts > WINDOW_MS);
    const lockExpired = !row.lockUntil || now >= row.lockUntil;
    if (noRecentAttempts && lockExpired) attempts.delete(key);
  }
}

function checkLoginAllowed(req, res, next) {
  const now = Date.now();
  pruneExpired(now);
  const key = getClientKey(req);
  const row = attempts.get(key);
  if (row && row.lockUntil && now < row.lockUntil) {
    const minutesLeft = Math.max(1, Math.ceil((row.lockUntil - now) / 60000));
    return res.status(429).render('login', {
      error: `Muitas tentativas. Tente novamente em ${minutesLeft} min.`,
    });
  }
  return next();
}

function markLoginFailure(req) {
  const now = Date.now();
  const key = getClientKey(req);
  const row = attempts.get(key) || { entries: [], lockUntil: 0 };
  row.entries = row.entries.filter(ts => now - ts <= WINDOW_MS);
  row.entries.push(now);
  if (row.entries.length >= MAX_ATTEMPTS) {
    row.lockUntil = now + LOCK_MS;
    row.entries = [];
  }
  attempts.set(key, row);
}

function clearLoginFailures(req) {
  const key = getClientKey(req);
  attempts.delete(key);
}

module.exports = {
  checkLoginAllowed,
  markLoginFailure,
  clearLoginFailures,
};
