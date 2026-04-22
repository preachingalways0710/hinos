'use strict';

const { config } = require('../config');

function requestContext(req, res, next) {
  res.locals.path = req.path;
  res.locals.loggedIn = req.session?.loggedIn === true;
  res.locals.appVersion = config.appVersion;
  next();
}

module.exports = {
  requestContext,
};
