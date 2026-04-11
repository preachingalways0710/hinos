'use strict';
require('dotenv').config();
const express      = require('express');
const cookieSession = require('cookie-session');
const mysql        = require('mysql2/promise');

const app = express();

// ─── Database ─────────────────────────────────────────────────────────────────

const db = mysql.createPool({
  host:               process.env.DB_HOST,
  user:               process.env.DB_USER,
  password:           process.env.DB_PASSWORD,
  database:           process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit:    10,
  dateStrings:        true,
});

// ─── App setup ────────────────────────────────────────────────────────────────

app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(express.static('public'));
app.use(cookieSession({
  name:   'session',
  secret: process.env.SESSION_SECRET,
  maxAge: 1000 * 60 * 60 * 24 * 30,
}));

// Make current path available in all templates for nav active state
app.use((req, res, next) => {
  res.locals.path = req.path;
  next();
});

// Service type labels available in all templates
app.locals.SERVICE_LABELS = {
  dom_manha: 'Domingo Manhã',
  dom_noite: 'Domingo Noite',
  qua:       'Quarta-Feira',
  especial:  'Culto Especial',
};

// ─── Auth ─────────────────────────────────────────────────────────────────────

function requireLogin(req, res, next) {
  if (req.session.loggedIn) return next();
  res.redirect('/login');
}

app.get('/login', (req, res) => res.render('login', { error: null }));

app.post('/login', (req, res) => {
  if (req.body.password === process.env.ADMIN_PASSWORD) {
    req.session.loggedIn = true;
    res.redirect('/');
  } else {
    res.render('login', { error: 'Senha incorreta.' });
  }
});

app.post('/logout', requireLogin, (req, res) => {
  req.session = null;
  res.redirect('/login');
});

// ─── Dashboard ────────────────────────────────────────────────────────────────

app.get('/', requireLogin, async (req, res) => {
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
});

// ─── Hymns ────────────────────────────────────────────────────────────────────

app.get('/hymns', requireLogin, async (req, res) => {
  const themeId = parseInt(req.query.theme) || 0;
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
    WHERE (? = 0 OR EXISTS (
      SELECT 1 FROM hymn_themes ht2
      WHERE ht2.hymn_id = h.id AND ht2.theme_id = ?
    ))
    GROUP BY h.id, h.number, h.title, h.english_title, hy.code
    ORDER BY (last_used IS NULL) DESC, last_used ASC, hy.code ASC, h.number ASC
  `, [themeId, themeId]);
  const [themes] = await db.query('SELECT * FROM themes ORDER BY name');
  res.render('hymns', { hymns, themes, themeId });
});

// IMPORTANT: /hymns/new must come before /hymns/:id/edit
app.get('/hymns/new', requireLogin, async (req, res) => {
  const [hymnals] = await db.query('SELECT * FROM hymnals ORDER BY name');
  const [themes]  = await db.query('SELECT * FROM themes ORDER BY name');
  res.render('hymn-form', { hymn: null, hymnals, themes, selectedThemes: [], error: null });
});

app.post('/hymns', requireLogin, async (req, res) => {
  const { number, title, hymnal_id, song_key, time_signature, notes } = req.body;
  const themeIds = [].concat(req.body.theme_ids || []).filter(Boolean);
  try {
    const [result] = await db.query(
      'INSERT INTO hymns (number, title, english_title, hymnal_id, song_key, time_signature, notes) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [number, title, req.body.english_title || null, hymnal_id, song_key || null, time_signature || null, notes || null]
    );
    const hymnId = result.insertId;
    for (const tid of themeIds) {
      await db.query('INSERT IGNORE INTO hymn_themes (hymn_id, theme_id) VALUES (?, ?)', [hymnId, tid]);
    }
    res.redirect('/hymns');
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      const [hymnals] = await db.query('SELECT * FROM hymnals ORDER BY name');
      const [themes]  = await db.query('SELECT * FROM themes ORDER BY name');
      return res.render('hymn-form', {
        hymn: null, hymnals, themes,
        selectedThemes: themeIds.map(Number),
        error: 'Já existe um hino com esse número nesse hinário.',
      });
    }
    throw err;
  }
});

app.get('/hymns/:id/edit', requireLogin, async (req, res) => {
  const [[hymn]] = await db.query('SELECT * FROM hymns WHERE id = ?', [req.params.id]);
  if (!hymn) return res.redirect('/hymns');
  const [hymnals] = await db.query('SELECT * FROM hymnals ORDER BY name');
  const [themes]  = await db.query('SELECT * FROM themes ORDER BY name');
  const [htRows]  = await db.query('SELECT theme_id FROM hymn_themes WHERE hymn_id = ?', [req.params.id]);
  const selectedThemes = htRows.map(r => r.theme_id);
  res.render('hymn-form', { hymn, hymnals, themes, selectedThemes, error: null });
});

app.post('/hymns/:id/update', requireLogin, async (req, res) => {
  const { number, title, hymnal_id, song_key, time_signature, notes } = req.body;
  const themeIds = [].concat(req.body.theme_ids || []).filter(Boolean);
  try {
    await db.query(
      'UPDATE hymns SET number=?, title=?, english_title=?, hymnal_id=?, song_key=?, time_signature=?, notes=? WHERE id=?',
      [number, title, req.body.english_title || null, hymnal_id, song_key || null, time_signature || null, notes || null, req.params.id]
    );
    await db.query('DELETE FROM hymn_themes WHERE hymn_id = ?', [req.params.id]);
    for (const tid of themeIds) {
      await db.query('INSERT IGNORE INTO hymn_themes (hymn_id, theme_id) VALUES (?, ?)', [req.params.id, tid]);
    }
    res.redirect('/hymns');
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      const [[hymn]] = await db.query('SELECT * FROM hymns WHERE id = ?', [req.params.id]);
      const [hymnals] = await db.query('SELECT * FROM hymnals ORDER BY name');
      const [themes]  = await db.query('SELECT * FROM themes ORDER BY name');
      return res.render('hymn-form', {
        hymn, hymnals, themes,
        selectedThemes: themeIds.map(Number),
        error: 'Já existe um hino com esse número nesse hinário.',
      });
    }
    throw err;
  }
});

app.post('/api/hymns/:id/delete', requireLogin, async (req, res) => {
  await db.query('DELETE FROM hymns WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

// Typeahead search — must come before /api/hymns/:id routes
app.get('/api/hymns', requireLogin, async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json([]);
  const like = '%' + q + '%';
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
  res.json(rows);
});

// ─── Services ─────────────────────────────────────────────────────────────────

app.get('/services', requireLogin, async (req, res) => {
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
});

// IMPORTANT: /services/new must come before /services/:id/edit
app.get('/services/new', requireLogin, (req, res) => {
  res.render('service-form', { service: null, slots: Array(5).fill(null), error: null });
});

app.post('/services', requireLogin, async (req, res) => {
  const { service_date, service_type, notes } = req.body;
  const hymnIds = [].concat(req.body.hymn_ids || []);
  try {
    const [result] = await db.query(
      'INSERT INTO services (service_date, service_type, notes) VALUES (?, ?, ?)',
      [service_date, service_type, notes || null]
    );
    const serviceId = result.insertId;
    for (let i = 0; i < hymnIds.length; i++) {
      if (hymnIds[i]) {
        await db.query(
          'INSERT INTO service_hymns (service_id, hymn_id, position) VALUES (?, ?, ?)',
          [serviceId, hymnIds[i], i + 1]
        );
      }
    }
    res.redirect('/services');
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.render('service-form', {
        service: null, slots: Array(5).fill(null),
        error: 'Já existe um culto registrado para essa data e tipo.',
      });
    }
    throw err;
  }
});

app.get('/services/:id/edit', requireLogin, async (req, res) => {
  const [[service]] = await db.query('SELECT * FROM services WHERE id = ?', [req.params.id]);
  if (!service) return res.redirect('/services');
  const [shRows] = await db.query(`
    SELECT sh.position, h.id, h.number, h.title, hy.code AS hymnal
    FROM service_hymns sh
    JOIN hymns h    ON h.id = sh.hymn_id
    JOIN hymnals hy ON hy.id = h.hymnal_id
    WHERE sh.service_id = ?
    ORDER BY sh.position
  `, [req.params.id]);
  const slots = Array(5).fill(null);
  for (const row of shRows) slots[row.position - 1] = row;
  res.render('service-form', { service, slots, error: null });
});

app.post('/services/:id/update', requireLogin, async (req, res) => {
  const { service_date, service_type, notes } = req.body;
  const hymnIds = [].concat(req.body.hymn_ids || []);
  try {
    await db.query(
      'UPDATE services SET service_date=?, service_type=?, notes=? WHERE id=?',
      [service_date, service_type, notes || null, req.params.id]
    );
    await db.query('DELETE FROM service_hymns WHERE service_id = ?', [req.params.id]);
    for (let i = 0; i < hymnIds.length; i++) {
      if (hymnIds[i]) {
        await db.query(
          'INSERT INTO service_hymns (service_id, hymn_id, position) VALUES (?, ?, ?)',
          [req.params.id, hymnIds[i], i + 1]
        );
      }
    }
    res.redirect('/services');
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      const [[service]] = await db.query('SELECT * FROM services WHERE id = ?', [req.params.id]);
      const slots = Array(5).fill(null);
      return res.render('service-form', {
        service, slots,
        error: 'Já existe um culto registrado para essa data e tipo.',
      });
    }
    throw err;
  }
});

app.post('/api/services/:id/delete', requireLogin, async (req, res) => {
  await db.query('DELETE FROM services WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

// ─── Themes ───────────────────────────────────────────────────────────────────

app.get('/themes', requireLogin, async (req, res) => {
  const [themes] = await db.query(`
    SELECT t.id, t.name, COUNT(ht.hymn_id) AS hymn_count
    FROM themes t
    LEFT JOIN hymn_themes ht ON ht.theme_id = t.id
    GROUP BY t.id
    ORDER BY t.name
  `);
  res.render('themes', { themes });
});

app.post('/themes', requireLogin, async (req, res) => {
  const name = (req.body.name || '').trim();
  if (name) {
    try {
      await db.query('INSERT INTO themes (name) VALUES (?)', [name]);
    } catch (err) {
      if (err.code !== 'ER_DUP_ENTRY') throw err;
    }
  }
  res.redirect('/themes');
});

app.post('/api/themes/:id/delete', requireLogin, async (req, res) => {
  await db.query('DELETE FROM themes WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

// ─── Error handler ────────────────────────────────────────────────────────────

app.use((err, req, res, next) => {
  console.error('APP ERROR:', err.message);
  res.status(500).send('<pre>ERROR: ' + err.message + '</pre>');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Hinos listening on port ' + PORT));
