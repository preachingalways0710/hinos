'use strict';

const path = require('path');
const express = require('express');
const { app, bootstrap } = require('./app');
const { config } = require('./config');

const publicDir = path.join(__dirname, '..', 'public');

// Serve the planning center static bundle.
app.use(express.static(publicDir));

function servePublicFile(res, filename) {
  return res.sendFile(path.join(publicDir, filename));
}

// Operator/projector aliases used by external site buttons.
app.get(['/app', '/app/', '/operator', '/operator/'], (_req, res) => servePublicFile(res, 'operator.html'));
app.get(['/ensaiar', '/ensaiar/'], (_req, res) => servePublicFile(res, 'operator.html'));
app.get(['/projector', '/projector/'], (_req, res) => servePublicFile(res, 'projector.html'));

// SPA fallback: unknown GET routes return index.html.
app.get('*', (req, res, next) => {
  if (req.method !== 'GET') return next();
  if (req.path.startsWith('/api/')) return next();
  return servePublicFile(res, 'index.html');
});

async function start() {
  try {
    await bootstrap();
  } catch (err) {
    // Keep the static planning center available even if DB bootstrap fails.
    console.warn('Bootstrap failed. Starting in static-only mode:', err?.message || err);
  }

  app.listen(config.port, () => {
    console.log(`Hinos listening on port ${config.port}`);
  });
}

start();
