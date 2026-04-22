-- ─── Tables ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS hymnals (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  code       VARCHAR(20)  NOT NULL UNIQUE,
  name       VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Forward-compatible: english_title, song_key, and time_signature are nullable now,
-- ready to populate whenever needed for future ProPresenter features.
CREATE TABLE IF NOT EXISTS hymns (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  number         INT          NOT NULL,
  title          VARCHAR(255) NOT NULL,
  english_title  VARCHAR(255) DEFAULT NULL,
  hymnal_id      INT          NOT NULL,
  song_key       VARCHAR(10)  DEFAULT NULL,
  time_signature VARCHAR(10)  DEFAULT NULL,
  notes          TEXT         DEFAULT NULL,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (hymnal_id) REFERENCES hymnals(id),
  UNIQUE KEY unique_hymn (hymnal_id, number)
);

-- Future table (not created yet):
-- CREATE TABLE IF NOT EXISTS hymn_verses (
--   id           INT AUTO_INCREMENT PRIMARY KEY,
--   hymn_id      INT NOT NULL,
--   verse_number TINYINT NOT NULL,
--   verse_type   ENUM('verse','chorus','bridge') NOT NULL DEFAULT 'verse',
--   lyrics_pt    TEXT DEFAULT NULL,
--   lyrics_en    TEXT DEFAULT NULL,
--   FOREIGN KEY (hymn_id) REFERENCES hymns(id) ON DELETE CASCADE,
--   UNIQUE KEY unique_verse (hymn_id, verse_number)
-- );

CREATE TABLE IF NOT EXISTS themes (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(100) NOT NULL UNIQUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS hymn_themes (
  hymn_id  INT NOT NULL,
  theme_id INT NOT NULL,
  PRIMARY KEY (hymn_id, theme_id),
  FOREIGN KEY (hymn_id)  REFERENCES hymns(id)  ON DELETE CASCADE,
  FOREIGN KEY (theme_id) REFERENCES themes(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS services (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  service_date DATE NOT NULL,
  service_type ENUM('dom_manha','dom_noite','qua','especial') NOT NULL,
  playlist_name VARCHAR(255) NOT NULL,
  notes        VARCHAR(500) DEFAULT NULL,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_service_playlist (service_date, playlist_name)
);

CREATE TABLE IF NOT EXISTS service_hymns (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  service_id INT NOT NULL,
  hymn_id    INT NOT NULL,
  position   TINYINT NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE,
  FOREIGN KEY (hymn_id)    REFERENCES hymns(id),
  UNIQUE KEY unique_slot (service_id, position)
);

-- ─── Seed Data ────────────────────────────────────────────────────────────────

INSERT IGNORE INTO hymnals (code, name) VALUES
  ('CC',  'Cantor Cristão'),
  ('SHC', 'Salmos Hinos e Cânticos'),
  ('VM',  'Voz de Melodia'),
  ('CP',  'Composições Pessoais'),
  ('CDE', 'Corinhos da Escola'),
  ('COR', 'Corinhos'),
  ('HL',  'Hinos de Louvor');

INSERT IGNORE INTO themes (name) VALUES
  ('Adoração'),
  ('Batismo'),
  ('Ceia do Senhor'),
  ('Confiança'),
  ('Consagração'),
  ('Encorajamento'),
  ('Exaltação'),
  ('Expiação'),
  ('Missões'),
  ('Natal / Encarnação'),
  ('Oração'),
  ('Páscoa / Ressurreição'),
  ('Salvação'),
  ('Santificação'),
  ('Segunda Vinda');
