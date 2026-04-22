'use strict';

const crypto = require('crypto');

function deriveKey(secret = '') {
  const raw = String(secret || '').trim();
  if (!raw) return null;
  return crypto.createHash('sha256').update(raw, 'utf8').digest();
}

function encryptJson(payload, secret) {
  const key = deriveKey(secret);
  if (!key) return { encrypted: false, value: payload };

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    encrypted: true,
    value: Buffer.concat([iv, tag, encrypted]).toString('base64'),
  };
}

function decryptJson(node, secret) {
  if (!node || node.encrypted !== true) {
    return node && Object.prototype.hasOwnProperty.call(node, 'value') ? node.value : null;
  }
  const key = deriveKey(secret);
  if (!key || typeof node.value !== 'string') return null;

  const raw = Buffer.from(node.value, 'base64');
  if (raw.length < 12 + 16 + 1) return null;
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const data = raw.subarray(28);

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  return JSON.parse(plaintext);
}

module.exports = {
  encryptJson,
  decryptJson,
};
