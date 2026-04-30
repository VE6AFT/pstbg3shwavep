PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tabs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  author_id TEXT,
  cloned_from_tab_id TEXT,
  layout_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (cloned_from_tab_id) REFERENCES tabs(id)
);
