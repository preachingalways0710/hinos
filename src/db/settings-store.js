'use strict';

const { db } = require('./pool');

async function getSetting(keyName) {
  const [[row]] = await db.query('SELECT value_json FROM app_settings WHERE key_name = ?', [keyName]);
  if (!row) return null;
  try {
    return JSON.parse(row.value_json);
  } catch {
    return null;
  }
}

async function setSetting(keyName, value) {
  const payload = JSON.stringify(value ?? null);
  await db.query(`
    INSERT INTO app_settings (key_name, value_json)
    VALUES (?, ?)
    ON DUPLICATE KEY UPDATE value_json = VALUES(value_json)
  `, [keyName, payload]);
}

async function deleteSetting(keyName) {
  await db.query('DELETE FROM app_settings WHERE key_name = ?', [keyName]);
}

module.exports = {
  getSetting,
  setSetting,
  deleteSetting,
};
