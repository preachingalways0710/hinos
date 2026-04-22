'use strict';

const express = require('express');
const { constantTimeEqual } = require('../utils/security');
const { config } = require('../config');
const { checkLoginAllowed, markLoginFailure, clearLoginFailures } = require('../middleware/login-throttle');
const { requireLogin } = require('../middleware/auth');

const router = express.Router();

router.get('/login', (req, res) => {
  if (req.session?.loggedIn) return res.redirect('/');
  return res.render('login', { error: null });
});

router.post('/login', checkLoginAllowed, (req, res) => {
  const inputPassword = String(req.body.password || '');
  const correctPassword = String(config.auth.adminPassword || '');
  if (correctPassword && constantTimeEqual(inputPassword, correctPassword)) {
    req.session.loggedIn = true;
    clearLoginFailures(req);
    return res.redirect('/');
  }
  markLoginFailure(req);
  return res.status(401).render('login', { error: 'Senha incorreta.' });
});

router.post('/logout', requireLogin, (req, res) => {
  req.session = null;
  return res.redirect('/login');
});

module.exports = router;
