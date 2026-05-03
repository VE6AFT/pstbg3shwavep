PRAGMA foreign_keys = ON;

INSERT OR IGNORE INTO tabs (
  id,
  name,
  author_id,
  layout_json
) VALUES (
  'now',
  'Now',
  NULL,
  '{
    "unit": "in",
    "tools": []
  }'
);
