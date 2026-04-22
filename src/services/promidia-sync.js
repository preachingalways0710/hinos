'use strict';

const crypto = require('crypto');
const { db } = require('../db/pool');
const { config } = require('../config');
const { normalizeShortText, toInt } = require('../utils/validation');
const { constantTimeEqual } = require('../utils/security');

const PROVIDER = 'promidia';

const THEME_RULES = [
  { theme: 'Adoração', patterns: ['adora', 'worship', 'louvor', 'praise', 'gloria', 'glória'] },
  { theme: 'Missões', patterns: ['misso', 'mission', 'evangeliza'] },
  { theme: 'Oração', patterns: ['oração', 'oracao', 'ora ', 'prayer'] },
  { theme: 'Natal / Encarnação', patterns: ['natal', 'christmas', 'encarna', 'advento'] },
  { theme: 'Páscoa / Ressurreição', patterns: ['pascoa', 'páscoa', 'ressurre', 'resurrection', 'empty tomb'] },
  { theme: 'Ceia do Senhor', patterns: ['ceia', 'comunhão', 'comunhao', 'lord supper'] },
  { theme: 'Batismo', patterns: ['batismo', 'baptis'] },
  { theme: 'Salvação', patterns: ['salva', 'salvação', 'salvacao', 'redeemer'] },
  { theme: 'Santificação', patterns: ['santifica', 'holy living', 'santo'] },
  { theme: 'Segunda Vinda', patterns: ['segunda vinda', 'volta de cristo', 'retorno de cristo', 'second coming'] },
  { theme: 'Confiança', patterns: ['confian', 'trust', 'faithful'] },
  { theme: 'Consagração', patterns: ['consagra', 'entrega', 'surrender'] },
  { theme: 'Encorajamento', patterns: ['encoraja', 'consolo', 'comfort', 'fortale'] },
  { theme: 'Expiação', patterns: ['expia', 'cross', 'cruz', 'sangue', 'calvário', 'calvario', 'atonement'] },
];

function normalizeForMatch(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function resolveHymnalCode(row = {}) {
  const code = normalizeShortText(row.code || '', 20).toUpperCase();
  if (code) return code;
  return 'PROM';
}

function resolveHymnalName(row = {}) {
  const library = normalizeShortText(row.library || '', 255);
  if (library) return library;
  const code = resolveHymnalCode(row);
  return code === 'PROM' ? 'Promidia' : code;
}

function normalizeIncomingHymn(row = {}) {
  const externalId = normalizeShortText(row.id || '', 80);
  const title = normalizeShortText(row.title || '', 255);
  if (!externalId || !title) return null;
  const number = toInt(row.number, 0);
  const englishTitle = normalizeShortText(row.englishTitle || row.english_title || '', 255) || null;
  const sourceAudio = normalizeShortText(row.audioFile || '', 180);
  const sourceLibrary = normalizeShortText(row.library || '', 255);
  return {
    externalId,
    title,
    number: number > 0 ? number : 0,
    englishTitle,
    code: resolveHymnalCode(row),
    hymnalName: resolveHymnalName(row),
    sourceAudio,
    sourceLibrary,
  };
}

function buildManagedNotesFragment(row = {}) {
  const parts = [];
  if (row.sourceLibrary) parts.push(`Biblioteca Promidia: ${row.sourceLibrary}`);
  if (row.sourceAudio) parts.push(`Audio Promidia: ${row.sourceAudio}`);
  if (!parts.length) return '';
  return `[Promidia]\n${parts.join('\n')}`;
}

function mergeNotes(existingNotes = '', managedFragment = '') {
  const prev = String(existingNotes || '');
  const cleaned = prev.replace(/\n?\[Promidia\][\s\S]*$/m, '').trim();
  if (!managedFragment) return cleaned || null;
  return [cleaned, managedFragment].filter(Boolean).join('\n\n').trim();
}

function payloadHash(row = {}) {
  return crypto.createHash('sha256').update(JSON.stringify(row)).digest('hex');
}

async function loadThemeLookup(conn) {
  const [rows] = await conn.query('SELECT id, name FROM themes');
  const byName = new Map();
  rows.forEach(row => {
    const key = normalizeForMatch(row.name);
    if (!key) return;
    byName.set(key, row.id);
  });
  return byName;
}

function inferThemeNames(row = {}) {
  const haystack = normalizeForMatch(`${row.sourceLibrary || ''} ${row.title || ''}`);
  if (!haystack) return [];
  const found = new Set();
  THEME_RULES.forEach(rule => {
    const match = rule.patterns.some(pattern => haystack.includes(normalizeForMatch(pattern)));
    if (match) found.add(rule.theme);
  });
  return [...found];
}

async function applyInferredThemes(conn, hymnId, row, themeLookup) {
  if (!hymnId || !themeLookup) return 0;
  const inferred = inferThemeNames(row);
  let linked = 0;
  for (const themeName of inferred) {
    const themeId = themeLookup.get(normalizeForMatch(themeName));
    if (!themeId) continue;
    const [insert] = await conn.query(
      'INSERT IGNORE INTO hymn_themes (hymn_id, theme_id) VALUES (?, ?)',
      [hymnId, themeId]
    );
    if (insert && Number(insert.affectedRows) > 0) linked += 1;
  }
  return linked;
}

async function writeSyncLog(payload = {}) {
  const safeStatus = payload.status === 'error' ? 'error' : 'success';
  const detailsJson = JSON.stringify(payload.details || null);
  await db.query(
    `INSERT INTO promidia_sync_logs
     (status, source, received, processed, created_count, updated_count, unchanged_count, dropped_count, themed_links_count, error_code, details_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      safeStatus,
      'promidia',
      Number(payload.received || 0),
      Number(payload.processed || 0),
      Number(payload.created || 0),
      Number(payload.updated || 0),
      Number(payload.unchanged || 0),
      Number(payload.dropped || 0),
      Number(payload.themedLinks || 0),
      payload.errorCode ? String(payload.errorCode).slice(0, 180) : null,
      detailsJson,
    ]
  );
}

async function ensureHymnal(conn, code, name) {
  const [[existing]] = await conn.query('SELECT id FROM hymnals WHERE code = ? LIMIT 1', [code]);
  if (existing && existing.id) {
    await conn.query('UPDATE hymnals SET name = ? WHERE id = ?', [name, existing.id]);
    return existing.id;
  }
  const [insert] = await conn.query('INSERT INTO hymnals (code, name) VALUES (?, ?)', [code, name]);
  return insert.insertId;
}

async function findLinkedHymn(conn, externalId) {
  const [[row]] = await conn.query(
    'SELECT hymn_id, payload_hash FROM external_hymn_links WHERE provider = ? AND external_id = ? LIMIT 1',
    [PROVIDER, externalId]
  );
  return row || null;
}

async function findFallbackHymn(conn, hymnalId, number, title) {
  if (number > 0) {
    const [[byNumber]] = await conn.query(
      'SELECT id, notes FROM hymns WHERE hymnal_id = ? AND number = ? LIMIT 1',
      [hymnalId, number]
    );
    if (byNumber) return byNumber;
  }
  const [[byTitle]] = await conn.query(
    'SELECT id, notes FROM hymns WHERE hymnal_id = ? AND title = ? LIMIT 1',
    [hymnalId, title]
  );
  return byTitle || null;
}

async function upsertHymn(conn, normalizedRow) {
  const nextHash = payloadHash(normalizedRow);
  const hymnalId = await ensureHymnal(conn, normalizedRow.code, normalizedRow.hymnalName);
  const managedNotes = buildManagedNotesFragment(normalizedRow);

  const linked = await findLinkedHymn(conn, normalizedRow.externalId);
  if (linked && linked.hymn_id) {
    if (linked.payload_hash && linked.payload_hash === nextHash) {
      return { hymnId: linked.hymn_id, changed: false, created: false };
    }
    const [[existing]] = await conn.query('SELECT notes FROM hymns WHERE id = ? LIMIT 1', [linked.hymn_id]);
    const notes = mergeNotes(existing?.notes || '', managedNotes);
    await conn.query(
      `UPDATE hymns
       SET number = ?, title = ?, english_title = ?, hymnal_id = ?, notes = ?
       WHERE id = ?`,
      [normalizedRow.number, normalizedRow.title, normalizedRow.englishTitle, hymnalId, notes, linked.hymn_id]
    );
    await conn.query(
      `UPDATE external_hymn_links
       SET payload_hash = ?, hymn_id = ?
       WHERE provider = ? AND external_id = ?`,
      [nextHash, linked.hymn_id, PROVIDER, normalizedRow.externalId]
    );
    return { hymnId: linked.hymn_id, changed: true, created: false };
  }

  const fallback = await findFallbackHymn(conn, hymnalId, normalizedRow.number, normalizedRow.title);
  if (fallback && fallback.id) {
    const notes = mergeNotes(fallback.notes || '', managedNotes);
    await conn.query(
      `UPDATE hymns
       SET number = ?, title = ?, english_title = ?, hymnal_id = ?, notes = ?
       WHERE id = ?`,
      [normalizedRow.number, normalizedRow.title, normalizedRow.englishTitle, hymnalId, notes, fallback.id]
    );
    await conn.query(
      `INSERT INTO external_hymn_links (provider, external_id, hymn_id, payload_hash)
       VALUES (?, ?, ?, ?)`,
      [PROVIDER, normalizedRow.externalId, fallback.id, nextHash]
    );
    return { hymnId: fallback.id, changed: true, created: false };
  }

  const notes = mergeNotes('', managedNotes);
  const [insert] = await conn.query(
    `INSERT INTO hymns (number, title, english_title, hymnal_id, notes)
     VALUES (?, ?, ?, ?, ?)`,
    [normalizedRow.number, normalizedRow.title, normalizedRow.englishTitle, hymnalId, notes]
  );
  const hymnId = insert.insertId;
  await conn.query(
    `INSERT INTO external_hymn_links (provider, external_id, hymn_id, payload_hash)
     VALUES (?, ?, ?, ?)`,
    [PROVIDER, normalizedRow.externalId, hymnId, nextHash]
  );
  return { hymnId, changed: true, created: true };
}

function assertSyncToken(providedToken = '') {
  const expectedToken = String(config.integrations.promidiaSyncToken || '').trim();
  const sent = String(providedToken || '').trim();
  if (!expectedToken) {
    throw new Error('PROMIDIA_SYNC_NOT_CONFIGURED');
  }
  if (!sent || !constantTimeEqual(sent, expectedToken)) {
    throw new Error('PROMIDIA_SYNC_UNAUTHORIZED');
  }
}

async function syncFromPromidia(payload = {}) {
  const inputRows = Array.isArray(payload.hymns) ? payload.hymns : [];
  const normalized = inputRows
    .map(normalizeIncomingHymn)
    .filter(Boolean);

  const conn = await db.getConnection();
  let summary = null;
  try {
    await conn.beginTransaction();
    const themeLookup = await loadThemeLookup(conn);
    let created = 0;
    let updated = 0;
    let unchanged = 0;
    let themedLinks = 0;
    for (const row of normalized) {
      const result = await upsertHymn(conn, row);
      themedLinks += await applyInferredThemes(conn, result.hymnId, row, themeLookup);
      if (!result.changed) {
        unchanged += 1;
      } else if (result.created) {
        created += 1;
      } else {
        updated += 1;
      }
    }
    await conn.commit();
    summary = {
      received: inputRows.length,
      processed: normalized.length,
      created,
      updated,
      unchanged,
      dropped: Math.max(0, inputRows.length - normalized.length),
      themedLinks,
    };
    await writeSyncLog({
      status: 'success',
      ...summary,
      details: {
        sourceVersion: payload?.sourceVersion || '',
        exportedAt: payload?.exportedAt || '',
      },
    });
    return summary;
  } catch (err) {
    try { await conn.rollback(); } catch {}
    await writeSyncLog({
      status: 'error',
      received: inputRows.length,
      processed: normalized.length,
      created: summary?.created || 0,
      updated: summary?.updated || 0,
      unchanged: summary?.unchanged || 0,
      dropped: Math.max(0, inputRows.length - normalized.length),
      themedLinks: summary?.themedLinks || 0,
      errorCode: String(err?.message || err || 'SYNC_FAILED'),
      details: {
        sourceVersion: payload?.sourceVersion || '',
        exportedAt: payload?.exportedAt || '',
      },
    }).catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

async function listRecentSyncLogs(limit = 40) {
  const safeLimit = Math.max(1, Math.min(200, toInt(limit, 40)));
  const [rows] = await db.query(
    `SELECT id, status, source, received, processed, created_count, updated_count, unchanged_count,
            dropped_count, themed_links_count, error_code, details_json, created_at
     FROM promidia_sync_logs
     ORDER BY id DESC
     LIMIT ?`,
    [safeLimit]
  );
  return rows.map(row => {
    let details = null;
    try {
      details = row.details_json ? JSON.parse(row.details_json) : null;
    } catch {
      details = null;
    }
    return {
      id: row.id,
      status: row.status,
      source: row.source,
      received: row.received,
      processed: row.processed,
      created: row.created_count,
      updated: row.updated_count,
      unchanged: row.unchanged_count,
      dropped: row.dropped_count,
      themedLinks: row.themed_links_count,
      errorCode: row.error_code,
      details,
      createdAt: row.created_at,
    };
  });
}

module.exports = {
  assertSyncToken,
  syncFromPromidia,
  listRecentSyncLogs,
};
