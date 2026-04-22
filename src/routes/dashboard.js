'use strict';

const express = require('express');
const { db } = require('../db/pool');
const { asyncHandler } = require('../utils/async');
const { requireLogin } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireLogin, asyncHandler(async (req, res) => {
  const [recent] = await db.query(`
    SELECT s.id, s.service_date, s.service_type,
           GROUP_CONCAT(
             CONCAT(hy.code, ' ', h.number, ' — ', h.title)
             ORDER BY sh.position SEPARATOR '\n'
           ) AS hymn_list
    FROM services s
    LEFT JOIN service_hymns sh ON sh.service_id = s.id
    LEFT JOIN hymns h          ON h.id = sh.hymn_id
    LEFT JOIN hymnals hy       ON hy.id = h.hymnal_id
    GROUP BY s.id
    ORDER BY s.service_date DESC
    LIMIT 10
  `);
  const [[stats]] = await db.query('SELECT COUNT(*) AS total FROM hymns');
  res.render('index', { recent, stats });
}));

module.exports = router;
