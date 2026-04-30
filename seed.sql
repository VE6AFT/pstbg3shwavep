PRAGMA foreign_keys = ON;

INSERT OR IGNORE INTO tabs (
  id,
  name,
  author_id,
  cloned_from_tab_id,
  layout_json
) VALUES (
  'tab-default',
  'Baseline Layout',
  NULL,
  NULL,
  '{
    "unit": "in",
    "bays": [
      { "id": "bay-105", "label": "105", "x": 0, "y": 0, "width": 444, "height": 1188 },
      { "id": "bay-108", "label": "108", "x": 516, "y": 0, "width": 324, "height": 1164 },
      { "id": "bay-110", "label": "110", "x": 840, "y": 0, "width": 324, "height": 1164 }
    ],
    "tools": [
      { "id": "tool-saw", "assetId": "asset-table-saw", "name": "Table Saw", "x": 242, "y": 552, "width": 96, "height": 60, "rotation": 0, "color": "#db6b4d" },
      { "id": "tool-cnc", "assetId": "asset-cnc-router", "name": "CNC Router", "x": 420, "y": 142, "width": 120, "height": 72, "rotation": 0, "color": "#427f8f" },
      { "id": "tool-laser", "assetId": "asset-laser", "name": "Laser Cutter", "x": 624, "y": 232, "width": 72, "height": 42, "rotation": 0, "color": "#8267c7" },
      { "id": "tool-bench", "assetId": "asset-workbench", "name": "Workbench", "x": 810, "y": 148, "width": 84, "height": 36, "rotation": 0, "color": "#d5a23f" },
      { "id": "tool-rack", "assetId": "asset-storage", "name": "Material Rack", "x": 1014, "y": 188, "width": 48, "height": 96, "rotation": 0, "color": "#6a7f47" },
      { "id": "tool-printer", "assetId": "asset-printer", "name": "3D Printer Pod", "x": 210, "y": 238, "width": 60, "height": 48, "rotation": 0, "color": "#4f7ccf" }
    ]
  }'
);
