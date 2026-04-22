'use strict';

const { createCsrfToken, constantTimeEqual } = require('../utils/security');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function attachCsrfToken(req, res, next) {
  if (!req.session) return next();
  if (!req.session.csrfToken) req.session.csrfToken = createCsrfToken();
  res.locals.csrfToken = req.session.csrfToken;
  next();
}

function enforceCsrf(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();

  const path = req.path || '';
  if (path.startsWith('/integracoes/planning-center/callback')) return next();
  if (path.startsWith('/api/integrations/promidia/')) return next();

  const sent = String(
    req.body?._csrf
    || req.headers['x-csrf-token']
    || req.query?._csrf
    || ''
  ).trim();

  const expected = String(req.session?.csrfToken || '').trim();
  if (!sent || !expected || !constantTimeEqual(sent, expected)) {
    return res.status(403).render('error', {
      title: 'Requisição inválida',
      message: 'Sua sessão de segurança expirou. Recarregue a página e tente novamente.',
    });
  }
  return next();
}

module.exports = {
  attachCsrfToken,
  enforceCsrf,
};
