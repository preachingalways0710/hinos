'use strict';

const packageJson = require('../package.json');

const config = {
  appVersion: String(packageJson.version || '1.0.0'),
  env: process.env.NODE_ENV || 'development',
  isProd: process.env.NODE_ENV === 'production',
  port: Number(process.env.PORT || 3000),
  db: {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  },
  auth: {
    sessionSecret: process.env.SESSION_SECRET || '',
    adminPassword: process.env.ADMIN_PASSWORD || '',
  },
  crypto: {
    appEncryptionKey: process.env.APP_ENCRYPTION_KEY || '',
  },
  planningCenter: {
    clientId: process.env.PCO_CLIENT_ID || '',
    clientSecret: process.env.PCO_CLIENT_SECRET || '',
    redirectUri: process.env.PCO_REDIRECT_URI || '',
    scope: process.env.PCO_SCOPE || 'services current',
  },
  integrations: {
    promidiaSyncToken: process.env.PROMIDIA_SYNC_TOKEN || '',
  },
};

module.exports = {
  config,
};
