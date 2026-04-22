'use strict';

const crypto = require('crypto');

function createCsrfToken() {
  return crypto.randomBytes(24).toString('hex');
}

function normalizeSecret(secret = '') {
  return Buffer.from(String(secret || ''), 'utf8');
}

function constantTimeEqual(left = '', right = '') {
  const a = normalizeSecret(left);
  const b = normalizeSecret(right);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = {
  createCsrfToken,
  constantTimeEqual,
};
