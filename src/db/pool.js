'use strict';

const mysql = require('mysql2/promise');
const { config } = require('../config');

const db = mysql.createPool({
  host: config.db.host,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  waitForConnections: true,
  connectionLimit: 10,
  dateStrings: true,
});

async function ensureAppTables() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key_name VARCHAR(120) PRIMARY KEY,
      value_json LONGTEXT NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS external_hymn_links (
      provider VARCHAR(40) NOT NULL,
      external_id VARCHAR(80) NOT NULL,
      hymn_id INT NOT NULL,
      payload_hash CHAR(64) DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (provider, external_id),
      INDEX idx_external_hymn_links_hymn (hymn_id),
      CONSTRAINT fk_external_hymn_links_hymn
        FOREIGN KEY (hymn_id) REFERENCES hymns(id) ON DELETE CASCADE
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS promidia_sync_logs (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      status ENUM('success','error') NOT NULL,
      source VARCHAR(40) NOT NULL DEFAULT 'promidia',
      received INT NOT NULL DEFAULT 0,
      processed INT NOT NULL DEFAULT 0,
      created_count INT NOT NULL DEFAULT 0,
      updated_count INT NOT NULL DEFAULT 0,
      unchanged_count INT NOT NULL DEFAULT 0,
      dropped_count INT NOT NULL DEFAULT 0,
      themed_links_count INT NOT NULL DEFAULT 0,
      error_code VARCHAR(180) DEFAULT NULL,
      details_json LONGTEXT DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS promidia_playlists (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      provider VARCHAR(40) NOT NULL DEFAULT 'promidia',
      external_playlist_id VARCHAR(120) NOT NULL,
      name VARCHAR(255) NOT NULL,
      item_count INT NOT NULL DEFAULT 0,
      payload_hash CHAR(64) DEFAULT NULL,
      payload_json LONGTEXT DEFAULT NULL,
      last_synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_promidia_playlists_provider_external (provider, external_playlist_id),
      KEY idx_promidia_playlists_updated (updated_at)
    )
  `);
}

module.exports = {
  db,
  ensureAppTables,
};
