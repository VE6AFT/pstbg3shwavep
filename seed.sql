PRAGMA foreign_keys = ON;

INSERT OR IGNORE INTO tabs (
  id,
  name,
  author_id,
  cloned_from_tab_id,
  layout_json
) VALUES (
  'tab-default',
  'Now',
  NULL,
  NULL,
  '{
    "unit": "in",
    "tools": []
  }'
);
