'use strict';

function toInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toPositiveInt(value, fallback = 0) {
  const parsed = toInt(value, fallback);
  return parsed > 0 ? parsed : fallback;
}

function normalizeServiceType(value) {
  const allowed = new Set(['dom_manha', 'dom_noite', 'qua', 'especial']);
  const next = String(value || '').trim();
  return allowed.has(next) ? next : '';
}

function normalizeDateOnly(value) {
  const text = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function normalizeShortText(value, maxLen = 255) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

function normalizeNullableText(value, maxLen = 255) {
  const text = normalizeShortText(value, maxLen);
  return text || null;
}

module.exports = {
  toInt,
  toPositiveInt,
  normalizeServiceType,
  normalizeDateOnly,
  normalizeShortText,
  normalizeNullableText,
};
