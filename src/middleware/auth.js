'use strict';

function requireLogin(req, res, next) {
  if (req.session && req.session.loggedIn === true) return next();
  return res.redirect('/login');
}

module.exports = {
  requireLogin,
};
