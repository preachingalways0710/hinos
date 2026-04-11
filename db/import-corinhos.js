/**
 * Import script for Corinhos da Escola.
 *
 * Column format (no header row):
 *   Category ("Corinhos Da Escola"), empty, Portuguese title, gloria machine# (or "##"), English title
 *
 * Since these songs have no hymnal numbers, they are assigned sequential
 * numbers (1, 2, 3...) in the order they appear in the file.
 *
 * Usage:
 *   node db/import-corinhos.js CDE ~/Downloads/"IBBV hymn index - Corinhos.csv"
 *
 * (Pass COR instead of CDE for the general Corinhos hymnal when you have that data.)
 */

'use strict';
require('dotenv').config();
const fs    = require('fs');
const mysql = require('mysql2/promise');

const hymnalCode = process.argv[2];
const csvPath    = process.argv[3];

if (!hymnalCode || !csvPath) {
  console.error('Usage: node db/import-corinhos.js <HYMNAL_CODE> <path/to/file.csv>');
  console.error('  e.g. node db/import-corinhos.js CDE ~/Downloads/corinhos.csv');
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
    console.error('ERROR: Hymnal "' + hymnalCode + '" not found. Run schema.sql first.');
    await db.end();
    process.exit(1);
  }
  const hymnalId = hymnal.id;

  const raw   = fs.readFileSync(csvPath, 'utf8');
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);

  // Track titles already inserted to avoid duplicates (the CSV has one duplicate row)
  const seen = new Set();

  let imported = 0;
  let skipped  = 0;
  let counter  = 1; // sequential number assigned to each corinho

  for (let i = 0; i < lines.length; i++) {
    const fields = parseCSVLine(lines[i]);
    // col0: category, col1: empty, col2: pt title, col3: gloria# or "##", col4: en title
    const title        = fields[2] || '';
    const englishTitle = fields[4] || '';

    if (!title) {
      skipped++;
      continue;
    }

    // Skip exact duplicate titles
    if (seen.has(title.toLowerCase())) {
      console.log('  DUPE (skipped): "' + title + '"');
      skipped++;
      continue;
    }
    seen.add(title.toLowerCase());

    await db.query(
      'INSERT IGNORE INTO hymns (number, title, english_title, hymnal_id) VALUES (?, ?, ?, ?)',
      [counter, title, englishTitle || null, hymnalId]
    );
    console.log('  OK: ' + hymnalCode + ' ' + counter + ' — ' + title + (englishTitle ? ' (' + englishTitle + ')' : ''));
    counter++;
    imported++;
  }

  await db.end();
  console.log('\n─────────────────────────────');
  console.log('Hymnal  : ' + hymnalCode);
  console.log('Imported: ' + imported);
  console.log('Skipped : ' + skipped);
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
