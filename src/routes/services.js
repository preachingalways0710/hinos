'use strict';

const express = require('express');
const { db } = require('../db/pool');
const { asyncHandler } = require('../utils/async');
const { requireLogin } = require('../middleware/auth');
const {
  normalizeDateOnly,
  normalizeNullableText,
  normalizeServiceType,
  toPositiveInt,
} = require('../utils/validation');

const router = express.Router();

function normalizeHymnIdSlots(input = []) {
  return []
    .concat(input || [])
    .map(value => toPositiveInt(value, 0))
    .filter(value => value > 0)
    .slice(0, 5);
}

router.get('/cultos', requireLogin, asyncHandler(async (req, res) => {
  const [services] = await db.query(`
    SELECT s.id, s.service_date, s.service_type, s.notes,
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
  `);
  res.render('services', { services });
}));

router.get('/cultos/novo', requireLogin, (req, res) => {
  res.render('service-form', { service: null, slots: Array(5).fill(null), error: null });
});

router.post('/cultos', requireLogin, asyncHandler(async (req, res) => {
  const serviceDate = normalizeDateOnly(req.body.service_date);
  const serviceType = normalizeServiceType(req.body.service_type);
  const notes = normalizeNullableText(req.body.notes, 500);
  const hymnIds = normalizeHymnIdSlots(req.body.hymn_ids);

  if (!serviceDate || !serviceType) {
    return res.status(422).render('service-form', {
      service: null,
      slots: Array(5).fill(null),
      error: 'Data e tipo de culto são obrigatórios.',
    });
  }

  try {
    const [result] = await db.query(
      'INSERT INTO services (service_date, service_type, notes) VALUES (?, ?, ?)',
      [serviceDate, serviceType, notes]
    );
    const serviceId = result.insertId;
    for (let i = 0; i < hymnIds.length; i += 1) {
      await db.query(
        'INSERT INTO service_hymns (service_id, hymn_id, position) VALUES (?, ?, ?)',
        [serviceId, hymnIds[i], i + 1]
      );
    }
    return res.redirect('/cultos');
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).render('service-form', {
        service: null,
        slots: Array(5).fill(null),
        error: 'Já existe um culto registrado para essa data e tipo.',
      });
    }
    throw err;
  }
}));

router.get('/cultos/:id/editar', requireLogin, asyncHandler(async (req, res) => {
  const serviceId = toPositiveInt(req.params.id);
  if (!serviceId) return res.redirect('/cultos');

  const [[service]] = await db.query('SELECT * FROM services WHERE id = ?', [serviceId]);
  if (!service) return res.redirect('/cultos');
  const [shRows] = await db.query(`
    SELECT sh.position, h.id, h.number, h.title, hy.code AS hymnal
    FROM service_hymns sh
    JOIN hymns h    ON h.id = sh.hymn_id
    JOIN hymnals hy ON hy.id = h.hymnal_id
    WHERE sh.service_id = ?
    ORDER BY sh.position
  `, [serviceId]);
  const slots = Array(5).fill(null);
  for (const row of shRows) {
    if (row.position >= 1 && row.position <= 5) slots[row.position - 1] = row;
  }
  res.render('service-form', { service, slots, error: null });
}));

router.post('/cultos/:id/atualizar', requireLogin, asyncHandler(async (req, res) => {
  const serviceId = toPositiveInt(req.params.id);
  if (!serviceId) return res.redirect('/cultos');

  const serviceDate = normalizeDateOnly(req.body.service_date);
  const serviceType = normalizeServiceType(req.body.service_type);
  const notes = normalizeNullableText(req.body.notes, 500);
  const hymnIds = normalizeHymnIdSlots(req.body.hymn_ids);

  if (!serviceDate || !serviceType) {
    const [[service]] = await db.query('SELECT * FROM services WHERE id = ?', [serviceId]);
    return res.status(422).render('service-form', {
      service: service || null,
      slots: Array(5).fill(null),
      error: 'Data e tipo de culto são obrigatórios.',
    });
  }

  try {
    await db.query(
      'UPDATE services SET service_date=?, service_type=?, notes=? WHERE id=?',
      [serviceDate, serviceType, notes, serviceId]
    );
    await db.query('DELETE FROM service_hymns WHERE service_id = ?', [serviceId]);
    for (let i = 0; i < hymnIds.length; i += 1) {
      await db.query(
        'INSERT INTO service_hymns (service_id, hymn_id, position) VALUES (?, ?, ?)',
        [serviceId, hymnIds[i], i + 1]
      );
    }
    return res.redirect('/cultos');
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      const [[service]] = await db.query('SELECT * FROM services WHERE id = ?', [serviceId]);
      return res.status(409).render('service-form', {
        service: service || null,
        slots: Array(5).fill(null),
        error: 'Já existe um culto registrado para essa data e tipo.',
      });
    }
    throw err;
  }
}));

router.post('/api/cultos/:id/delete', requireLogin, asyncHandler(async (req, res) => {
  const serviceId = toPositiveInt(req.params.id);
  if (!serviceId) return res.status(400).json({ success: false, error: 'INVALID_ID' });
  await db.query('DELETE FROM services WHERE id = ?', [serviceId]);
  return res.json({ success: true });
}));

module.exports = router;
