'use strict';

const express = require('express');
const { db } = require('../db/pool');
const { asyncHandler } = require('../utils/async');
const { requireLogin } = require('../middleware/auth');
const {
  normalizeNullableText,
  normalizeShortText,
  toInt,
  toPositiveInt,
} = require('../utils/validation');

const router = express.Router();

router.get('/hinos', requireLogin, asyncHandler(async (req, res) => {
  const q = normalizeShortText(req.query.q || '', 120);
  const themeId = toPositiveInt(req.query.theme, 0);
  const hymnalCode = normalizeShortText(req.query.hymnal || '', 20).toUpperCase();
  const pageSize = 60;
  const page = Math.max(1, toInt(req.query.page, 1));

  const where = [];
  const whereParams = [];

  if (themeId > 0) {
    where.push(`EXISTS (
      SELECT 1 FROM hymn_themes ht2
      WHERE ht2.hymn_id = h.id AND ht2.theme_id = ?
    )`);
    whereParams.push(themeId);
  }
  if (hymnalCode) {
    where.push('hy.code = ?');
    whereParams.push(hymnalCode);
  }
  if (q) {
    const like = `%${q}%`;
    where.push(`(
      h.title LIKE ?
      OR h.english_title LIKE ?
      OR CAST(h.number AS CHAR) LIKE ?
      OR CONCAT(hy.code, ' ', h.number) LIKE ?
      OR EXISTS (
        SELECT 1
        FROM hymn_themes htx
        JOIN themes tx ON tx.id = htx.theme_id
        WHERE htx.hymn_id = h.id
          AND tx.name LIKE ?
      )
    )`);
    whereParams.push(like, like, like, like, like);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [[countRow]] = await db.query(`
    SELECT COUNT(*) AS total
    FROM hymns h
    JOIN hymnals hy ON hy.id = h.hymnal_id
    ${whereSql}
  `, whereParams);

  const total = Number(countRow?.total || 0);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, pageCount);
  const offset = (safePage - 1) * pageSize;

  const [hymns] = await db.query(`
    SELECT h.id, h.number, h.title, h.english_title, hy.code AS hymnal,
           MAX(s.service_date) AS last_used,
           GROUP_CONCAT(DISTINCT t.name ORDER BY t.name SEPARATOR ', ') AS themes
    FROM hymns h
    JOIN hymnals hy ON hy.id = h.hymnal_id
    LEFT JOIN hymn_themes ht ON ht.hymn_id = h.id
    LEFT JOIN themes t       ON t.id = ht.theme_id
    LEFT JOIN service_hymns sh ON sh.hymn_id = h.id
    LEFT JOIN services s       ON s.id = sh.service_id
    ${whereSql}
    GROUP BY h.id, h.number, h.title, h.english_title, hy.code
    ORDER BY (MAX(s.service_date) IS NULL) DESC, MAX(s.service_date) ASC, hy.code ASC, h.number ASC
    LIMIT ? OFFSET ?
  `, [...whereParams, pageSize, offset]);

  const [themes] = await db.query('SELECT * FROM themes ORDER BY name');
  const [hymnals] = await db.query('SELECT code, name FROM hymnals ORDER BY code');

  function buildListUrl(overrides = {}) {
    const merged = {
      q,
      theme: themeId > 0 ? String(themeId) : '',
      hymnal: hymnalCode,
      page: String(safePage),
      ...overrides,
    };
    const params = new URLSearchParams();
    Object.entries(merged).forEach(([key, value]) => {
      const raw = String(value ?? '').trim();
      if (!raw || raw === '0') return;
      params.set(key, raw);
    });
    const query = params.toString();
    return query ? `/hinos?${query}` : '/hinos';
  }

  const pageItems = [];
  const windowStart = Math.max(1, safePage - 2);
  const windowEnd = Math.min(pageCount, safePage + 2);
  for (let i = windowStart; i <= windowEnd; i += 1) pageItems.push(i);

  res.render('hymns', {
    hymns,
    themes,
    hymnals,
    q,
    themeId,
    hymnalCode,
    total,
    pageSize,
    page: safePage,
    pageCount,
    pageItems,
    buildListUrl,
  });
}));

router.get('/hinos/novo', requireLogin, asyncHandler(async (req, res) => {
  const [hymnals] = await db.query('SELECT * FROM hymnals ORDER BY name');
  const [themes] = await db.query('SELECT * FROM themes ORDER BY name');
  res.render('hymn-form', { hymn: null, hymnals, themes, selectedThemes: [], error: null });
}));

router.post('/hinos', requireLogin, asyncHandler(async (req, res) => {
  const number = toPositiveInt(req.body.number);
  const title = normalizeShortText(req.body.title, 255);
  const hymnalId = toPositiveInt(req.body.hymnal_id);
  const englishTitle = normalizeNullableText(req.body.english_title, 255);
  const songKey = normalizeNullableText(req.body.song_key, 10);
  const timeSignature = normalizeNullableText(req.body.time_signature, 10);
  const notes = normalizeNullableText(req.body.notes, 2000);
  const themeIds = []
    .concat(req.body.theme_ids || [])
    .map(value => toPositiveInt(value, 0))
    .filter(Boolean);

  if (!number || !title || !hymnalId) {
    const [hymnals] = await db.query('SELECT * FROM hymnals ORDER BY name');
    const [themes] = await db.query('SELECT * FROM themes ORDER BY name');
    return res.status(422).render('hymn-form', {
      hymn: null,
      hymnals,
      themes,
      selectedThemes: themeIds,
      error: 'Preencha hinário, número e título.',
    });
  }

  try {
    const [result] = await db.query(
      'INSERT INTO hymns (number, title, english_title, hymnal_id, song_key, time_signature, notes) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [number, title, englishTitle, hymnalId, songKey, timeSignature, notes]
    );
    const hymnId = result.insertId;
    for (const tid of themeIds) {
      await db.query('INSERT IGNORE INTO hymn_themes (hymn_id, theme_id) VALUES (?, ?)', [hymnId, tid]);
    }
    return res.redirect('/hinos');
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      const [hymnals] = await db.query('SELECT * FROM hymnals ORDER BY name');
      const [themes] = await db.query('SELECT * FROM themes ORDER BY name');
      return res.status(409).render('hymn-form', {
        hymn: null,
        hymnals,
        themes,
        selectedThemes: themeIds,
        error: 'Já existe um hino com esse número nesse hinário.',
      });
    }
    throw err;
  }
}));

router.get('/hinos/:id/editar', requireLogin, asyncHandler(async (req, res) => {
  const hymnId = toPositiveInt(req.params.id);
  if (!hymnId) return res.redirect('/hinos');

  const [[hymn]] = await db.query('SELECT * FROM hymns WHERE id = ?', [hymnId]);
  if (!hymn) return res.redirect('/hinos');
  const [hymnals] = await db.query('SELECT * FROM hymnals ORDER BY name');
  const [themes] = await db.query('SELECT * FROM themes ORDER BY name');
  const [htRows] = await db.query('SELECT theme_id FROM hymn_themes WHERE hymn_id = ?', [hymnId]);
  const selectedThemes = htRows.map(row => row.theme_id);
  res.render('hymn-form', { hymn, hymnals, themes, selectedThemes, error: null });
}));

router.post('/hinos/:id/atualizar', requireLogin, asyncHandler(async (req, res) => {
  const hymnId = toPositiveInt(req.params.id);
  if (!hymnId) return res.redirect('/hinos');

  const number = toPositiveInt(req.body.number);
  const title = normalizeShortText(req.body.title, 255);
  const hymnalId = toPositiveInt(req.body.hymnal_id);
  const englishTitle = normalizeNullableText(req.body.english_title, 255);
  const songKey = normalizeNullableText(req.body.song_key, 10);
  const timeSignature = normalizeNullableText(req.body.time_signature, 10);
  const notes = normalizeNullableText(req.body.notes, 2000);
  const themeIds = []
    .concat(req.body.theme_ids || [])
    .map(value => toPositiveInt(value, 0))
    .filter(Boolean);

  if (!number || !title || !hymnalId) {
    const [[hymn]] = await db.query('SELECT * FROM hymns WHERE id = ?', [hymnId]);
    const [hymnals] = await db.query('SELECT * FROM hymnals ORDER BY name');
    const [themes] = await db.query('SELECT * FROM themes ORDER BY name');
    return res.status(422).render('hymn-form', {
      hymn,
      hymnals,
      themes,
      selectedThemes: themeIds,
      error: 'Preencha hinário, número e título.',
    });
  }

  try {
    await db.query(
      'UPDATE hymns SET number=?, title=?, english_title=?, hymnal_id=?, song_key=?, time_signature=?, notes=? WHERE id=?',
      [number, title, englishTitle, hymnalId, songKey, timeSignature, notes, hymnId]
    );
    await db.query('DELETE FROM hymn_themes WHERE hymn_id = ?', [hymnId]);
    for (const tid of themeIds) {
      await db.query('INSERT IGNORE INTO hymn_themes (hymn_id, theme_id) VALUES (?, ?)', [hymnId, tid]);
    }
    return res.redirect('/hinos');
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      const [[hymn]] = await db.query('SELECT * FROM hymns WHERE id = ?', [hymnId]);
      const [hymnals] = await db.query('SELECT * FROM hymnals ORDER BY name');
      const [themes] = await db.query('SELECT * FROM themes ORDER BY name');
      return res.status(409).render('hymn-form', {
        hymn,
        hymnals,
        themes,
        selectedThemes: themeIds,
        error: 'Já existe um hino com esse número nesse hinário.',
      });
    }
    throw err;
  }
}));

router.post('/api/hinos/:id/delete', requireLogin, asyncHandler(async (req, res) => {
  const hymnId = toPositiveInt(req.params.id);
  if (!hymnId) return res.status(400).json({ success: false, error: 'INVALID_ID' });
  await db.query('DELETE FROM hymns WHERE id = ?', [hymnId]);
  return res.json({ success: true });
}));

router.get('/api/hinos', requireLogin, asyncHandler(async (req, res) => {
  const q = normalizeShortText(req.query.q || '', 120);
  if (q.length < 2) return res.json([]);
  const like = `%${q}%`;
  const [rows] = await db.query(`
    SELECT h.id, h.number, h.title, h.english_title, hy.code AS hymnal
    FROM hymns h
    JOIN hymnals hy ON hy.id = h.hymnal_id
    WHERE h.title LIKE ?
       OR h.english_title LIKE ?
       OR CAST(h.number AS CHAR) LIKE ?
       OR CONCAT(hy.code, ' ', h.number) LIKE ?
    ORDER BY hy.code ASC, h.number ASC
    LIMIT 20
  `, [like, like, like, like]);
  return res.json(rows);
}));

module.exports = router;
