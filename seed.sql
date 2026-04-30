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
      { "id": "bay-105", "label": "105", "x": 0, "y": 0, "width": 1188, "height": 444 },
      { "id": "bay-108", "label": "108", "x": 0, "y": 516, "width": 1164, "height": 324 },
      { "id": "bay-110", "label": "110", "x": 0, "y": 840, "width": 1164, "height": 324 }
    ],
    "tools": [
      { "id": "tool-saw", "assetId": "asset-table-saw", "name": "Table Saw", "x": 60, "y": 60, "width": 96, "height": 60, "rotation": 0, "color": "#db6b4d" },
      { "id": "tool-cnc", "assetId": "asset-cnc-router", "name": "CNC Router", "x": 240, "y": 60, "width": 120, "height": 72, "rotation": 0, "color": "#427f8f" },
      { "id": "tool-laser", "assetId": "asset-laser", "name": "Laser Cutter", "x": 440, "y": 60, "width": 72, "height": 42, "rotation": 0, "color": "#8267c7" },
      { "id": "tool-bench", "assetId": "asset-workbench", "name": "Workbench", "x": 60, "y": 540, "width": 84, "height": 36, "rotation": 0, "color": "#d5a23f" },
      { "id": "tool-rack", "assetId": "asset-storage", "name": "Material Rack", "x": 240, "y": 540, "width": 48, "height": 96, "rotation": 0, "color": "#6a7f47" },
      { "id": "tool-printer", "assetId": "asset-printer", "name": "3D Printer Pod", "x": 440, "y": 540, "width": 60, "height": 48, "rotation": 0, "color": "#4f7ccf" }
    ]
  }'
);
