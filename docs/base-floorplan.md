# Base floorplan coordinates

`src/assets/now.svg` uses the cleaned geometry from `empty.svg` supplied with PR #2.
The entire exported `tools` group is removed: that file still included HVAC and
other objects despite its name. Now is deliberately an empty starting layout;
tools added to a clone or loaded from a saved tab remain editable application data.

Saved tool coordinates are in inches. Keep the original viewBox
`-400 -400 2269.9179999999997 1570.643`, remove the editor export's outer
`translate(400,400)`, and keep the building's inner `translate(-200,-200)`.
The export had changed that inner translation to `(-192.602,-197.078)` as well.
Changing these offsets moves the background away from saved tools; changing the
viewBox changes the initial framing. Do not move or rescale database layouts to
compensate for an SVG export.

The mezzanine group retains `data-layer="mezzanine"` so the app can toggle it.
The supplied cleaned geometry has no infrastructure layer.
