-- cheat-terminal web: D1 schema (v1.0.0).
-- Categories are looked up by name; entries store the category name.
-- Levels: 1 = Essential, 2 = Common, 3 = Advanced (same as the terminal app).

CREATE TABLE IF NOT EXISTS categories (
  name  TEXT PRIMARY KEY,
  title TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS entries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  category    TEXT NOT NULL REFERENCES categories (name),
  command     TEXT NOT NULL,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  tags        TEXT NOT NULL DEFAULT '',
  example     TEXT NOT NULL DEFAULT '',
  level       INTEGER NOT NULL DEFAULT 2 CHECK (level BETWEEN 1 AND 3)
);

CREATE INDEX IF NOT EXISTS idx_entries_category ON entries (category);
CREATE INDEX IF NOT EXISTS idx_entries_level ON entries (level);
