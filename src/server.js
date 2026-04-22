'use strict';

const { app, bootstrap } = require('./app');
const { config } = require('./config');

bootstrap()
  .then(() => {
    app.listen(config.port, () => {
      console.log(`Hinos listening on port ${config.port}`);
    });
  })
  .catch(err => {
    console.error('Failed to bootstrap app:', err);
    process.exit(1);
  });
