# geo-heat

Turn a CSV of latitude/longitude points into a heatmap in your browser or from the command line — no map tiles, no server, no network.

## What it does

- Renders a real heatmap on a `<canvas>`: points are drawn as radial-gradient intensity blobs on an offscreen canvas, then a second pass maps that intensity through a blue → cyan → green → yellow → red color ramp. Optional weights make high-traffic points burn hotter.
- Works fully offline and in the browser: load the bundled sample (40 fake points in three clusters), upload your own CSV, or paste CSV text. Markers, hover labels, and a stats panel (point count, bounding box, densest grid cell, top labels) update live as you change the heat radius.
- Ships a Python CLI that does the same thing from a file: one CSV in, one single self-contained `output.html` out — the points are embedded as JSON and the renderer is inline, so the output file needs no other assets.

## Run the web demo

No build step, no dependencies. Either serve the folder:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

or just open `index.html` in a browser (the sample data is embedded, so it works from `file://` too).

Controls: **Load Sample**, **Upload CSV**, paste-CSV box, heat **radius** slider, **Use weights** toggle, **Show markers** toggle. Hover a marker to see its label, coordinates, and weight.

## Run the CLI

```bash
python3 geo_heat.py sample/points.csv -o output.html
python3 geo_heat.py --help
```

Options: `-o/--output` (default `output.html`), `--title`, `--radius` (pixels, default 36).

## Input format

CSV with a header row. `lat` and `lng` are required; `weight` and `label` are optional.

```csv
lat,lng,weight,label
40.811,-73.946,3,cafe
40.728,-73.990,1,park
40.689,-74.020,2,market
```

Rows with a missing, non-numeric, or out-of-range latitude/longitude are skipped. An empty or invalid `weight` falls back to `1`.

## Architecture

- `index.html` / `app.js` / `styles.css` — the static web demo. Equirectangular projection onto a canvas sized to the points' bounding box (padded so edge heat isn't clipped), two-pass heat rendering (intensity pass → color-ramp pass), grid-density and label stats computed in plain JavaScript.
- `geo_heat.py` — the CLI, Python standard library only. It owns the canonical logic: `parse_points` / `read_points` (CSV in, valid points out, bad rows skipped), `project` (equirectangular projection), `densest_cell` and `top_labels` (stats), and `render_html` (a standalone page with the points embedded as JSON and a small inline canvas renderer with the same two-pass heat algorithm).
- `sample/points.csv` — 40 fake, NYC-ish points clustered in three neighborhoods, with generic labels (`cafe`, `park`, `bakery`, …). No real places.
- `tests/` — `unittest` coverage of the Python logic (see below).

The web demo and the CLI implement the same projection and heat model independently; the Python module is the tested reference implementation.

## Tests

```bash
python3 -m unittest discover -s tests -v
```

Covers: CSV parsing (bad rows skipped, empty weight defaults to 1), projection bounds (bounding-box corners and centre map exactly), grid density (picks the cell containing a known planted cluster), top labels, and standalone HTML rendering (points embedded, no external URLs).

## Limitations

- **Projection:** equirectangular — longitude and latitude are mapped linearly. That's fine at city scale (the intended use) and increasingly wrong at regional/global scale, where longitude lines converge and east-west distances are overstated away from the equator. For a world map, use a real projection and tile library instead.
- **No basemap:** there are deliberately no map tiles, streets, or place names underneath the heat — the output shows *density and relative position*, not geography. If you need to know which street a cluster is on, this is the wrong tool.
- **Scale:** the two-pass per-pixel ramp is comfortable into the low tens of thousands of points; far beyond that, aggregate/bin points first.
- **CSV parsing** expects one header row with `lat`/`lng` columns (plus optional `weight`/`label`); it is not a general-purpose CSV analysis tool.

## License

MIT — see `LICENSE`.
