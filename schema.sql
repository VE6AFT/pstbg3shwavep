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

CREATE INDEX IF NOT EXISTS idx_tabs_author_id ON tabs(author_id);
CREATE INDEX IF NOT EXISTS idx_tabs_cloned_from_tab_id ON tabs(cloned_from_tab_id);
