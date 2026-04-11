/**
 * Generates db/seed-themes.sql — assigns themes to hymns across all hymnals.
 * Run locally — no database connection needed.
 *
 * Usage:
 *   node db/generate-themes.js
 *
 * Output:
 *   db/seed-themes.sql  — paste into phpMyAdmin after seed-hymns.sql
 */

'use strict';
const fs   = require('fs');
const path = require('path');

// ─── Theme mappings ───────────────────────────────────────────────────────────
// Format: [hymnal_code, hymn_number, ['Theme1', 'Theme2', ...]]
// Theme names must match exactly what is in the themes table.

const MAPPINGS = [

  // ── Cantor Cristão (CC) ────────────────────────────────────────────────────

  // Adoração / Exaltação
  ['CC',  8,  ['Adoração']],
  ['CC',  9,  ['Adoração', 'Exaltação']],
  ['CC', 14,  ['Exaltação']],
  ['CC', 15,  ['Adoração', 'Exaltação']],
  ['CC', 60,  ['Adoração', 'Exaltação']],
  ['CC', 62,  ['Exaltação']],
  ['CC', 65,  ['Exaltação']],
  ['CC', 97,  ['Exaltação']],
  ['CC', 124, ['Adoração', 'Exaltação']],
  ['CC', 126, ['Adoração', 'Exaltação']],
  ['CC', 135, ['Adoração']],
  ['CC', 278, ['Adoração', 'Exaltação', 'Salvação']],
  ['CC', 282, ['Adoração', 'Exaltação', 'Salvação']],
  ['CC', 382, ['Adoração']],
  ['CC', 385, ['Adoração']],
  ['CC', 399, ['Adoração', 'Exaltação', 'Expiação']],
  ['CC', 487, ['Exaltação']],
  ['CC', 527, ['Adoração']],
  ['CC', 542, ['Exaltação']],

  // Natal / Encarnação
  ['CC', 12,  ['Natal / Encarnação']],
  ['CC', 26,  ['Natal / Encarnação']],
  ['CC', 27,  ['Natal / Encarnação']],
  ['CC', 30,  ['Natal / Encarnação']],
  ['CC', 82,  ['Natal / Encarnação']],
  ['CC', 199, ['Natal / Encarnação']],

  // Páscoa / Ressurreição
  ['CC', 99,  ['Páscoa / Ressurreição']],
  ['CC', 101, ['Páscoa / Ressurreição']],

  // Segunda Vinda
  ['CC', 108, ['Segunda Vinda']],
  ['CC', 114, ['Segunda Vinda']],
  ['CC', 190, ['Segunda Vinda']],
  ['CC', 402, ['Segunda Vinda']],
  ['CC', 481, ['Segunda Vinda']],
  ['CC', 496, ['Segunda Vinda']],
  ['CC', 500, ['Segunda Vinda']],
  ['CC', 503, ['Segunda Vinda']],
  ['CC', 504, ['Segunda Vinda']],
  ['CC', 507, ['Segunda Vinda']],
  ['CC', 571, ['Segunda Vinda']],

  // Salvação
  ['CC', 36,  ['Salvação']],
  ['CC', 37,  ['Salvação']],
  ['CC', 39,  ['Salvação']],
  ['CC', 46,  ['Salvação']],
  ['CC', 50,  ['Salvação']],
  ['CC', 79,  ['Salvação']],
  ['CC', 183, ['Exaltação', 'Salvação']],
  ['CC', 192, ['Salvação']],
  ['CC', 194, ['Salvação', 'Missões']],
  ['CC', 201, ['Salvação']],
  ['CC', 210, ['Salvação']],
  ['CC', 213, ['Salvação']],
  ['CC', 222, ['Salvação']],
  ['CC', 223, ['Salvação', 'Confiança']],
  ['CC', 225, ['Salvação']],
  ['CC', 234, ['Salvação']],
  ['CC', 243, ['Salvação']],
  ['CC', 266, ['Salvação']],
  ['CC', 273, ['Salvação']],
  ['CC', 274, ['Salvação']],
  ['CC', 375, ['Salvação', 'Confiança']],
  ['CC', 376, ['Salvação', 'Expiação']],
  ['CC', 407, ['Salvação']],
  ['CC', 448, ['Salvação', 'Missões']],
  ['CC', 525, ['Salvação']],

  // Expiação
  ['CC', 89,  ['Expiação', 'Salvação']],
  ['CC', 92,  ['Expiação', 'Consagração']],
  ['CC', 93,  ['Expiação', 'Salvação']],
  ['CC', 123, ['Expiação']],
  ['CC', 139, ['Expiação', 'Salvação']],
  ['CC', 268, ['Expiação', 'Salvação']],
  ['CC', 289, ['Expiação', 'Consagração']],
  ['CC', 306, ['Expiação', 'Consagração']],
  ['CC', 371, ['Expiação', 'Salvação']],
  ['CC', 390, ['Expiação', 'Salvação']],
  ['CC', 396, ['Expiação', 'Salvação']],

  // Oração
  ['CC', 148, ['Oração']],
  ['CC', 155, ['Oração', 'Confiança']],
  ['CC', 162, ['Oração']],
  ['CC', 283, ['Oração', 'Consagração']],
  ['CC', 345, ['Oração', 'Confiança']],
  ['CC', 384, ['Oração', 'Consagração']],
  ['CC', 518, ['Oração', 'Consagração']],
  ['CC', 578, ['Oração', 'Santificação']],

  // Consagração / Santificação
  ['CC', 28,  ['Consagração']],
  ['CC', 150, ['Consagração']],
  ['CC', 168, ['Consagração']],
  ['CC', 169, ['Consagração', 'Santificação']],
  ['CC', 175, ['Consagração', 'Santificação']],
  ['CC', 176, ['Santificação']],
  ['CC', 226, ['Consagração']],
  ['CC', 285, ['Santificação', 'Consagração']],
  ['CC', 292, ['Consagração']],
  ['CC', 295, ['Consagração']],

  // Confiança
  ['CC',  1,  ['Confiança']],
  ['CC', 38,  ['Confiança', 'Exaltação']],
  ['CC', 42,  ['Confiança', 'Salvação']],
  ['CC', 73,  ['Confiança', 'Exaltação']],
  ['CC', 81,  ['Confiança']],
  ['CC', 83,  ['Confiança']],
  ['CC', 116, ['Confiança', 'Oração']],
  ['CC', 129, ['Confiança', 'Encorajamento']],
  ['CC', 132, ['Adoração', 'Confiança']],
  ['CC', 152, ['Confiança']],
  ['CC', 154, ['Confiança']],
  ['CC', 291, ['Confiança']],
  ['CC', 299, ['Confiança']],
  ['CC', 301, ['Confiança', 'Consagração']],
  ['CC', 313, ['Confiança']],
  ['CC', 314, ['Confiança']],
  ['CC', 323, ['Confiança', 'Exaltação']],
  ['CC', 328, ['Confiança']],
  ['CC', 329, ['Confiança', 'Encorajamento']],
  ['CC', 343, ['Confiança']],
  ['CC', 344, ['Confiança']],
  ['CC', 348, ['Confiança']],
  ['CC', 356, ['Confiança']],
  ['CC', 359, ['Confiança']],
  ['CC', 362, ['Confiança', 'Encorajamento']],
  ['CC', 366, ['Confiança']],
  ['CC', 367, ['Confiança']],
  ['CC', 377, ['Confiança']],
  ['CC', 398, ['Confiança', 'Encorajamento']],
  ['CC', 406, ['Confiança']],

  // Encorajamento
  ['CC', 368, ['Encorajamento', 'Missões']],
  ['CC', 381, ['Encorajamento', 'Missões']],
  ['CC', 465, ['Encorajamento']],
  ['CC', 469, ['Encorajamento', 'Missões']],
  ['CC', 475, ['Encorajamento', 'Missões']],
  ['CC', 476, ['Encorajamento']],
  ['CC', 565, ['Encorajamento']],

  // Missões
  ['CC', 417, ['Missões']],
  ['CC', 429, ['Missões']],
  ['CC', 436, ['Missões']],
  ['CC', 443, ['Missões']],
  ['CC', 444, ['Missões', 'Encorajamento']],
  ['CC', 529, ['Missões']],

  // ── Salmos Hinos e Cânticos (SHC) ─────────────────────────────────────────

  // Adoração / Exaltação
  ['SHC',  5,  ['Exaltação', 'Salvação']],
  ['SHC',  6,  ['Adoração', 'Exaltação']],
  ['SHC',  8,  ['Adoração', 'Exaltação']],
  ['SHC', 15,  ['Adoração', 'Exaltação']],
  ['SHC', 22,  ['Exaltação']],
  ['SHC', 28,  ['Adoração', 'Exaltação', 'Salvação']],
  ['SHC', 32,  ['Exaltação', 'Salvação']],
  ['SHC', 33,  ['Adoração', 'Exaltação']],
  ['SHC', 36,  ['Exaltação', 'Salvação']],
  ['SHC', 40,  ['Exaltação']],
  ['SHC', 45,  ['Adoração', 'Exaltação', 'Confiança']],
  ['SHC', 55,  ['Exaltação', 'Expiação']],
  ['SHC', 63,  ['Exaltação', 'Salvação']],
  ['SHC', 76,  ['Exaltação', 'Encorajamento']],
  ['SHC', 81,  ['Adoração', 'Exaltação']],
  ['SHC', 82,  ['Exaltação']],
  ['SHC', 84,  ['Exaltação']],
  ['SHC', 85,  ['Exaltação']],
  ['SHC', 95,  ['Adoração', 'Exaltação']],
  ['SHC', 99,  ['Exaltação']],
  ['SHC', 104, ['Exaltação', 'Salvação']],
  ['SHC', 110, ['Adoração', 'Exaltação']],
  ['SHC', 124, ['Exaltação', 'Missões']],
  ['SHC', 126, ['Exaltação', 'Confiança']],
  ['SHC', 129, ['Exaltação', 'Salvação']],
  ['SHC', 143, ['Exaltação']],
  ['SHC', 163, ['Exaltação']],
  ['SHC', 166, ['Adoração', 'Exaltação']],
  ['SHC', 174, ['Adoração']],
  ['SHC', 184, ['Exaltação', 'Encorajamento']],
  ['SHC', 211, ['Missões', 'Exaltação']],
  ['SHC', 225, ['Adoração', 'Exaltação']],
  ['SHC', 259, ['Adoração']],

  // Segunda Vinda
  ['SHC',  3,  ['Segunda Vinda']],
  ['SHC',  7,  ['Segunda Vinda']],
  ['SHC', 16,  ['Segunda Vinda']],
  ['SHC', 120, ['Segunda Vinda', 'Encorajamento']],
  ['SHC', 232, ['Segunda Vinda']],

  // Páscoa / Ressurreição
  ['SHC', 31,  ['Páscoa / Ressurreição', 'Confiança']],

  // Salvação
  ['SHC',  4,  ['Salvação']],
  ['SHC', 12,  ['Salvação']],
  ['SHC', 17,  ['Salvação']],
  ['SHC', 27,  ['Salvação']],
  ['SHC', 34,  ['Salvação', 'Expiação']],
  ['SHC', 63,  ['Salvação']],
  ['SHC', 167, ['Salvação']],
  ['SHC', 229, ['Salvação']],
  ['SHC', 241, ['Salvação']],
  ['SHC', 244, ['Salvação']],

  // Expiação
  ['SHC', 18,  ['Salvação', 'Expiação']],
  ['SHC', 24,  ['Expiação']],
  ['SHC', 26,  ['Salvação', 'Expiação']],
  ['SHC', 30,  ['Expiação', 'Salvação']],
  ['SHC', 35,  ['Expiação', 'Confiança']],
  ['SHC', 37,  ['Expiação']],
  ['SHC', 49,  ['Expiação']],

  // Oração
  ['SHC', 64,  ['Consagração']],
  ['SHC', 184, ['Encorajamento']],

  // Consagração / Santificação
  ['SHC', 14,  ['Consagração']],
  ['SHC', 20,  ['Consagração', 'Missões']],
  ['SHC', 21,  ['Consagração']],
  ['SHC', 29,  ['Consagração']],
  ['SHC', 54,  ['Consagração', 'Missões']],
  ['SHC', 86,  ['Consagração']],
  ['SHC', 109, ['Consagração']],
  ['SHC', 113, ['Consagração']],
  ['SHC', 154, ['Consagração', 'Confiança']],
  ['SHC', 213, ['Consagração']],
  ['SHC', 234, ['Adoração', 'Consagração']],

  // Confiança
  ['SHC',  1,  ['Confiança']],
  ['SHC',  2,  ['Confiança', 'Exaltação']],
  ['SHC', 10,  ['Confiança', 'Encorajamento']],
  ['SHC', 11,  ['Confiança']],
  ['SHC', 53,  ['Confiança']],
  ['SHC', 98,  ['Confiança']],
  ['SHC', 115, ['Confiança']],
  ['SHC', 122, ['Confiança']],
  ['SHC', 131, ['Confiança']],
  ['SHC', 136, ['Confiança', 'Exaltação']],
  ['SHC', 159, ['Confiança']],
  ['SHC', 201, ['Confiança', 'Consagração']],
  ['SHC', 209, ['Confiança']],
  ['SHC', 224, ['Confiança']],

  // Encorajamento / Missões
  ['SHC', 90,  ['Missões']],
  ['SHC', 94,  ['Missões', 'Encorajamento']],
  ['SHC', 108, ['Encorajamento']],

  // ── Voz de Melodia (VM) ────────────────────────────────────────────────────

  // Adoração / Exaltação
  ['VM',  4,   ['Adoração', 'Exaltação']],
  ['VM',  9,   ['Adoração', 'Exaltação']],
  ['VM', 11,   ['Adoração', 'Exaltação']],
  ['VM', 13,   ['Adoração']],
  ['VM', 14,   ['Adoração', 'Exaltação']],
  ['VM', 31,   ['Adoração']],
  ['VM', 32,   ['Adoração', 'Exaltação']],
  ['VM', 82,   ['Adoração', 'Exaltação']],
  ['VM', 83,   ['Adoração', 'Exaltação', 'Expiação']],
  ['VM', 330,  ['Adoração']],
  ['VM', 417,  ['Adoração']],
  ['VM', 425,  ['Adoração', 'Consagração']],

  // Natal / Encarnação (VM 121–162 are all Christmas hymns per the Tags column)
  ['VM', 121, ['Natal / Encarnação']],
  ['VM', 122, ['Natal / Encarnação']],
  ['VM', 123, ['Natal / Encarnação']],
  ['VM', 124, ['Natal / Encarnação']],
  ['VM', 125, ['Natal / Encarnação']],
  ['VM', 126, ['Natal / Encarnação']],
  ['VM', 127, ['Natal / Encarnação']],
  ['VM', 128, ['Natal / Encarnação']],
  ['VM', 129, ['Natal / Encarnação']],
  ['VM', 130, ['Natal / Encarnação']],
  ['VM', 131, ['Natal / Encarnação']],
  ['VM', 132, ['Natal / Encarnação']],
  ['VM', 133, ['Natal / Encarnação']],
  ['VM', 134, ['Natal / Encarnação']],
  ['VM', 135, ['Natal / Encarnação']],
  ['VM', 136, ['Natal / Encarnação']],
  ['VM', 137, ['Natal / Encarnação']],
  ['VM', 138, ['Natal / Encarnação']],
  ['VM', 139, ['Natal / Encarnação']],
  ['VM', 140, ['Natal / Encarnação']],
  ['VM', 141, ['Natal / Encarnação']],
  ['VM', 142, ['Natal / Encarnação']],
  ['VM', 143, ['Natal / Encarnação']],
  ['VM', 144, ['Natal / Encarnação']],
  ['VM', 145, ['Natal / Encarnação']],
  ['VM', 146, ['Natal / Encarnação']],
  ['VM', 147, ['Natal / Encarnação']],
  ['VM', 148, ['Natal / Encarnação']],
  ['VM', 149, ['Natal / Encarnação']],
  ['VM', 150, ['Natal / Encarnação']],
  ['VM', 151, ['Natal / Encarnação']],
  ['VM', 152, ['Natal / Encarnação']],
  ['VM', 153, ['Natal / Encarnação']],
  ['VM', 154, ['Natal / Encarnação']],
  ['VM', 155, ['Natal / Encarnação']],
  ['VM', 156, ['Natal / Encarnação']],
  ['VM', 157, ['Natal / Encarnação']],
  ['VM', 158, ['Natal / Encarnação']],
  ['VM', 159, ['Natal / Encarnação']],
  ['VM', 160, ['Natal / Encarnação']],
  ['VM', 161, ['Natal / Encarnação']],
  ['VM', 162, ['Natal / Encarnação']],

  // Expiação (VM cross/blood section 163–194)
  ['VM', 163, ['Expiação']],
  ['VM', 165, ['Expiação']],
  ['VM', 168, ['Expiação']],
  ['VM', 172, ['Expiação']],
  ['VM', 175, ['Expiação']],
  ['VM', 176, ['Expiação', 'Exaltação']],
  ['VM', 178, ['Expiação', 'Salvação']],
  ['VM', 183, ['Expiação', 'Salvação']],
  ['VM', 184, ['Expiação', 'Salvação']],
  ['VM', 189, ['Expiação', 'Salvação']],

  // Páscoa / Ressurreição
  ['VM', 192, ['Páscoa / Ressurreição']],
  ['VM', 193, ['Páscoa / Ressurreição']],
  ['VM', 194, ['Páscoa / Ressurreição']],

  // Segunda Vinda (VM 195–205 are return of Christ hymns)
  ['VM', 195, ['Segunda Vinda']],
  ['VM', 196, ['Segunda Vinda']],
  ['VM', 197, ['Segunda Vinda']],
  ['VM', 198, ['Segunda Vinda']],
  ['VM', 199, ['Segunda Vinda']],
  ['VM', 200, ['Segunda Vinda']],
  ['VM', 201, ['Segunda Vinda']],
  ['VM', 202, ['Segunda Vinda']],
  ['VM', 203, ['Segunda Vinda']],
  ['VM', 204, ['Segunda Vinda']],
  ['VM', 339, ['Segunda Vinda', 'Exaltação']],
  ['VM', 428, ['Segunda Vinda']],
  ['VM', 429, ['Segunda Vinda']],
  ['VM', 433, ['Segunda Vinda']],

  // Salvação
  ['VM', 212, ['Salvação']],
  ['VM', 217, ['Salvação']],
  ['VM', 222, ['Salvação']],
  ['VM', 225, ['Salvação']],
  ['VM', 226, ['Salvação', 'Expiação']],
  ['VM', 228, ['Salvação']],
  ['VM', 234, ['Salvação', 'Confiança']],
  ['VM', 236, ['Salvação', 'Expiação']],
  ['VM', 241, ['Salvação']],
  ['VM', 244, ['Salvação']],
  ['VM', 251, ['Salvação']],
  ['VM', 252, ['Salvação']],
  ['VM', 257, ['Salvação']],
  ['VM', 326, ['Salvação', 'Encorajamento']],
  ['VM', 366, ['Salvação', 'Exaltação']],

  // Santificação / Consagração
  ['VM', 253, ['Santificação', 'Oração']],
  ['VM', 262, ['Consagração']],
  ['VM', 268, ['Consagração']],
  ['VM', 271, ['Santificação']],
  ['VM', 272, ['Santificação']],
  ['VM', 274, ['Consagração']],
  ['VM', 280, ['Consagração']],
  ['VM', 305, ['Consagração']],
  ['VM', 337, ['Consagração', 'Oração']],
  ['VM', 340, ['Expiação', 'Consagração']],
  ['VM', 403, ['Consagração', 'Missões']],
  ['VM', 409, ['Consagração']],

  // Oração
  ['VM', 307, ['Confiança', 'Oração']],
  ['VM', 309, ['Oração', 'Confiança']],
  ['VM', 313, ['Oração']],
  ['VM', 314, ['Oração']],

  // Confiança
  ['VM', 39,  ['Confiança', 'Exaltação']],
  ['VM', 52,  ['Confiança']],
  ['VM', 59,  ['Confiança', 'Exaltação']],
  ['VM', 62,  ['Confiança']],
  ['VM', 65,  ['Confiança']],
  ['VM', 66,  ['Confiança']],
  ['VM', 71,  ['Confiança']],
  ['VM', 209, ['Confiança']],
  ['VM', 210, ['Confiança']],
  ['VM', 281, ['Confiança']],
  ['VM', 290, ['Confiança']],
  ['VM', 292, ['Confiança']],
  ['VM', 294, ['Confiança']],
  ['VM', 299, ['Confiança']],
  ['VM', 300, ['Confiança']],
  ['VM', 302, ['Confiança']],
  ['VM', 303, ['Confiança']],
  ['VM', 321, ['Confiança']],
  ['VM', 323, ['Confiança']],

  // Missões
  ['VM', 372, ['Missões', 'Encorajamento']],
  ['VM', 381, ['Missões']],
  ['VM', 382, ['Missões']],
  ['VM', 393, ['Missões']],
  ['VM', 397, ['Missões']],
  ['VM', 399, ['Missões']],
  ['VM', 400, ['Missões']],
  ['VM', 402, ['Missões']],
  ['VM', 407, ['Missões']],

  // Batismo
  ['VM', 420, ['Batismo']],

  // ── Corinhos da Escola (CDE) ───────────────────────────────────────────────
  // Numbers are sequential as assigned by import-corinhos.js (see CSV order)

  ['CDE',  1, ['Confiança']],                           // Meu Bom Pastor
  ['CDE',  2, ['Adoração', 'Exaltação']],               // Tu Es Digno
  ['CDE',  3, ['Exaltação']],                           // Familia de Deus
  ['CDE',  4, ['Consagração']],                         // Eu Te Sirvo
  ['CDE',  5, ['Encorajamento']],                       // A alegria do senhor
  ['CDE',  6, ['Consagração']],                         // Tenho Resolvido
  ['CDE',  7, ['Adoração']],                            // Quero cantar
  ['CDE',  8, ['Consagração']],                         // Buscai Primeiro
  ['CDE',  9, ['Adoração', 'Exaltação']],               // Maravilhoso é
  ['CDE', 10, ['Confiança']],                           // Eu so confio no senhor
  ['CDE', 11, ['Expiação']],                            // Rude Cruz
  ['CDE', 12, ['Salvação', 'Expiação']],                // Preciosa Graca
  ['CDE', 13, ['Adoração', 'Exaltação']],               // Grandioso es tu
  ['CDE', 14, ['Salvação']],                            // Cristo te chama
  ['CDE', 15, ['Consagração']],                         // Ultima hora (Spirit of Living God)
  ['CDE', 16, ['Salvação']],                            // Tal qual estou
  ['CDE', 17, ['Adoração']],                            // Aleluiah
  ['CDE', 18, ['Adoração']],                            // Deus esta aqui
  ['CDE', 19, ['Adoração', 'Exaltação']],               // Deus e tao bom
  ['CDE', 20, ['Salvação']],                            // Vinde meninos
  ['CDE', 21, ['Adoração']],                            // Este e o dia
  ['CDE', 22, ['Confiança']],                           // Tenho paz como

];

// ─── Generate SQL ─────────────────────────────────────────────────────────────

const outputPath = path.join(__dirname, 'seed-themes.sql');
const out = [];

out.push('-- ─── Hymn theme assignments ──────────────────────────────────────────────────');
out.push('-- Generated by db/generate-themes.js');
out.push('-- Safe to re-run: uses INSERT IGNORE so duplicates are skipped.');
out.push('-- Run this in phpMyAdmin after seed-hymns.sql.');
out.push('');

let totalAssignments = 0;

for (const [code, number, themes] of MAPPINGS) {
  const themeList = themes.map(t => "'" + t.replace(/'/g, "\\'") + "'").join(', ');
  out.push(
    'INSERT IGNORE INTO hymn_themes (hymn_id, theme_id) ' +
    'SELECT h.id, t.id FROM hymns h ' +
    'JOIN hymnals hy ON hy.id = h.hymnal_id ' +
    'JOIN themes t ON t.name IN (' + themeList + ') ' +
    "WHERE hy.code = '" + code + "' AND h.number = " + number + ';'
  );
  totalAssignments += themes.length;
}

out.push('');
out.push('-- Total: ' + MAPPINGS.length + ' hymns tagged, ' + totalAssignments + ' theme assignments.');

fs.writeFileSync(outputPath, out.join('\n'), 'utf8');
console.log('Done. ' + MAPPINGS.length + ' hymns tagged across CC, SHC, VM, CDE.');
console.log('Total theme assignments: ' + totalAssignments);
console.log('Output: db/seed-themes.sql');
