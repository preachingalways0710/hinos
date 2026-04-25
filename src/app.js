'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieSession = require('cookie-session');
const { config } = require('./config');
const { ensureAppTables } = require('./db/pool');
const { requestContext } = require('./middleware/request-context');
const { attachCsrfToken, enforceCsrf } = require('./middleware/csrf');

const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const hymnRoutes = require('./routes/hymns');
const serviceRoutes = require('./routes/services');
const themeRoutes = require('./routes/themes');
const planningCenterRoutes = require('./routes/planning-center');
const promidiaSyncRoutes = require('./routes/promidia-sync');

const app = express();

app.disable('x-powered-by');
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));

app.use(express.urlencoded({ extended: false, limit: '5mb' }));
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use(cookieSession({
  name: 'session',
  secret: config.auth.sessionSecret || 'unsafe-dev-secret-change-me',
  maxAge: 1000 * 60 * 60 * 24 * 14,
  httpOnly: true,
  sameSite: 'lax',
  secure: config.isProd,
  signed: true,
}));

app.use(requestContext);
app.use(attachCsrfToken);
app.use(enforceCsrf);

app.locals.SERVICE_LABELS = {
  dom_manha: 'Domingo Manhã',
  dom_noite: 'Domingo Noite',
  qua: 'Quarta-Feira',
  especial: 'Culto Especial',
};

app.use(authRoutes);
app.use(dashboardRoutes);
app.use(hymnRoutes);
app.use(serviceRoutes);
app.use(themeRoutes);
app.use(planningCenterRoutes);
app.use(promidiaSyncRoutes);

app.use((err, req, res, next) => {
  console.error('APP ERROR:', err.stack || err.message);
  const message = config.isProd
    ? 'Algo deu errado no servidor. Tente novamente.'
    : `${err.message || err}`;
  if (req.accepts('json')) {
    return res.status(500).json({ ok: false, error: message });
  }
  return res.status(500).type('text/plain; charset=utf-8').send(message);
});

async function bootstrap() {
  await ensureAppTables();
}

module.exports = {
  app,
  bootstrap,
};
