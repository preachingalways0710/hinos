'use strict';

const express = require('express');
const { db } = require('../db/pool');
const { asyncHandler } = require('../utils/async');
const { requireLogin } = require('../middleware/auth');
const { normalizeShortText, toPositiveInt } = require('../utils/validation');

const router = express.Router();

router.get('/temas', requireLogin, asyncHandler(async (req, res) => {
  const [themes] = await db.query(`
    SELECT t.id, t.name, COUNT(ht.hymn_id) AS hymn_count
    FROM themes t
    LEFT JOIN hymn_themes ht ON ht.theme_id = t.id
    GROUP BY t.id
    ORDER BY t.name
  `);
  res.render('themes', { themes });
}));

router.post('/temas', requireLogin, asyncHandler(async (req, res) => {
  const name = normalizeShortText(req.body.name, 100);
  if (name) {
    try {
      await db.query('INSERT INTO themes (name) VALUES (?)', [name]);
    } catch (err) {
      if (err.code !== 'ER_DUP_ENTRY') throw err;
    }
  }
  res.redirect('/temas');
}));

router.post('/api/temas/:id/delete', requireLogin, asyncHandler(async (req, res) => {
  const themeId = toPositiveInt(req.params.id);
  if (!themeId) return res.status(400).json({ success: false, error: 'INVALID_ID' });
  await db.query('DELETE FROM themes WHERE id = ?', [themeId]);
  return res.json({ success: true });
}));

module.exports = router;
