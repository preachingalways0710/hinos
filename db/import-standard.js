/**
 * Import script for hymnals with standard column format:
 *   Number in hymnal, Title of hymn, English equivalent, Mp3, gloria machine#, Tags
 *
 * Works for: CC (Cantor Cristão), SHC (Salmos Hinos e Cânticos), VM (Voz de Melodia)
 *
 * Usage:
 *   node db/import-standard.js <hymnal_code> <path/to/file.csv>
 *
 * Examples:
 *   node db/import-standard.js CC  ~/Downloads/"IBBV hymn index - Copy of Cantor Cristão.csv"
 *   node db/import-standard.js SHC ~/Downloads/"IBBV hymn index - Psalmos, Hinos, Canticos.csv"
 *   node db/import-standard.js VM  ~/Downloads/"IBBV hymn index - Voz de Melodia.csv"
 *
 * Edge cases handled:
 *   - Header row skipped automatically
 *   - Rows with no number are skipped
 *   - Numbers with "?" suffix cleaned to digits only
 *   - Duplicate numbers: second occurrence skipped (INSERT IGNORE)
 *   - Quoted fields with commas inside parsed correctly
 */

'use strict';
require('dotenv').config();
const fs    = require('fs');
const mysql = require('mysql2/promise');

const hymnalCode = process.argv[2];
const csvPath    = process.argv[3];

if (!hymnalCode || !csvPath) {
  console.error('Usage: node db/import-standard.js <HYMNAL_CODE> <path/to/file.csv>');
  console.error('  e.g. node db/import-standard.js CC ~/Downloads/cantor-cristao.csv');
  process.exit(1);
}

function parseCSVLine(line) {
  const fields = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuotes = !inQuotes;
    } else if (c === ',' && !inQuotes) {
      fields.push(field.trim());
      field = '';
    } else {
      field += c;
    }
  }
  fields.push(field.trim());
  return fields;
}

async function main() {
  const db = await mysql.createConnection({
    host:        process.env.DB_HOST,
    user:        process.env.DB_USER,
    password:    process.env.DB_PASSWORD,
    database:    process.env.DB_NAME,
    dateStrings: true,
  });

  const [[hymnal]] = await db.query('SELECT id FROM hymnals WHERE code = ?', [hymnalCode]);
  if (!hymnal) {
    console.error('ERROR: Hymnal "' + hymnalCode + '" not found in database.');
    console.error('Make sure you have run schema.sql and that this code exists in the hymnals table.');
    await db.end();
    process.exit(1);
  }
  const hymnalId = hymnal.id;

  const raw   = fs.readFileSync(csvPath, 'utf8');
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);

  let imported = 0;
  let skipped  = 0;
  let dupes    = 0;

  for (let i = 0; i < lines.length; i++) {
    const fields       = parseCSVLine(lines[i]);
    const rawNum       = fields[0] || '';
    const title        = fields[1] || '';
    const englishTitle = fields[2] || '';

    // Skip header row
    if (rawNum.toLowerCase().includes('number')) continue;

    // Skip rows with no number
    if (!rawNum) {
      if (title) console.log('  SKIP (no number): "' + title + '"');
      skipped++;
      continue;
    }

    // Clean number: strip non-digit characters like "?"
    const numStr = rawNum.replace(/[^0-9]/g, '');
    if (!numStr) {
      console.log('  SKIP (invalid number "' + rawNum + '"): "' + title + '"');
      skipped++;
      continue;
    }
    const number = parseInt(numStr, 10);

    // Skip rows with no title
    if (!title) {
      skipped++;
      continue;
    }

    const [result] = await db.query(
      'INSERT IGNORE INTO hymns (number, title, english_title, hymnal_id) VALUES (?, ?, ?, ?)',
      [number, title, englishTitle || null, hymnalId]
    );

    if (result.affectedRows === 0) {
      console.log('  DUPE (skipped): ' + hymnalCode + ' ' + number + ' — ' + title);
      dupes++;
    } else {
      console.log('  OK: ' + hymnalCode + ' ' + number + ' — ' + title + (englishTitle ? ' (' + englishTitle + ')' : ''));
      imported++;
    }
  }

  await db.end();
  console.log('\n─────────────────────────────');
  console.log('Hymnal : ' + hymnalCode);
  console.log('Imported : ' + imported);
  console.log('Dupes    : ' + dupes);
  console.log('Skipped  : ' + skipped);
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
