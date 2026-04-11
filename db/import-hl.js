/**
 * Import script for Hinos de Louvor (HL).
 *
 * Column format (no header row):
 *   number, Portuguese title, empty, English title, composer, rating, YouTube URL
 *
 * Note: This file is a work in progress — many rows have a number but no title.
 * Only rows with at least a Portuguese OR English title are imported.
 *
 * Usage:
 *   node db/import-hl.js ~/Downloads/"IBBV hymn index - Hinos de Louvor.csv"
 */

'use strict';
require('dotenv').config();
const fs    = require('fs');
const mysql = require('mysql2/promise');

const csvPath = process.argv[2];

if (!csvPath) {
  console.error('Usage: node db/import-hl.js <path/to/file.csv>');
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

  const [[hymnal]] = await db.query("SELECT id FROM hymnals WHERE code = 'HL'");
  if (!hymnal) {
    console.error('ERROR: HL hymnal not found. Run schema.sql first.');
    await db.end();
    process.exit(1);
  }
  const hymnalId = hymnal.id;

  const raw   = fs.readFileSync(csvPath, 'utf8');
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);

  let imported = 0;
  let skipped  = 0;

  for (let i = 0; i < lines.length; i++) {
    const fields = parseCSVLine(lines[i]);
    // col0: number, col1: pt title, col2: empty, col3: en title
    const rawNum       = fields[0] || '';
    const title        = fields[1] || '';
    const englishTitle = fields[3] || '';

    const numStr = rawNum.replace(/[^0-9]/g, '');
    if (!numStr) { skipped++; continue; }
    const number = parseInt(numStr, 10);

    // Skip rows with no title at all
    if (!title && !englishTitle) { skipped++; continue; }

    const [result] = await db.query(
      'INSERT IGNORE INTO hymns (number, title, english_title, hymnal_id) VALUES (?, ?, ?, ?)',
      [number, title || '(' + englishTitle + ')', englishTitle || null, hymnalId]
    );

    if (result.affectedRows === 0) {
      console.log('  DUPE (skipped): HL ' + number);
      skipped++;
    } else {
      console.log('  OK: HL ' + number + ' — ' + (title || '(no pt title)') + (englishTitle ? ' (' + englishTitle + ')' : ''));
      imported++;
    }
  }

  await db.end();
  console.log('\n─────────────────────────────');
  console.log('Hymnal  : HL');
  console.log('Imported: ' + imported);
  console.log('Skipped : ' + skipped);
  console.log('\nNote: ' + skipped + ' rows skipped (no title). Add them later through the app.');
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
