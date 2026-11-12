# geo-heat

Turn a CSV of latitude/longitude points into a heatmap in your browser or from the command line — no map tiles, no server, no network.

## What it does

- Renders a real heatmap on a `<canvas>`: points are drawn as radial-gradient intensity blobs on an offscreen canvas, then a second pass maps that intensity through a color ramp (Classic, Ember, or Ocean). Optional weights make high-traffic points burn hotter. Radius, intensity, and heat opacity sliders re-render live, each scene carries its own default control state, and **Reset** restores the active scene's defaults.
- Works fully offline and in the browser, styled as a small "map lab": a dark gridded canvas with corner coordinates, a cursor lat/lng readout, and a dashed ring around the densest cluster. Four fictional scenes ship as one-click presets — Neighborhoods (40 fake points in three clusters), Delivery rush, Stadium night, and Weekend parks, all generated locally with a seeded PRNG — or bring your own points via the **Use your own** panel (paste `lat,lng` lines, headers optional, or upload a CSV). An insights panel (point count, densest cluster and its center, total weight, hottest label, bounding box, area covered in km, top labels) updates with every change, and the map exports to PNG.
- Optional "my places" mode: if a `places-data.js` file sits next to `index.html` and defines `window.PLACES_DATA` as `[{n, lat, lng, c}, …]` (name, coordinates, category), a **My places** scene becomes the default — real saved places with category filter chips, neighborhood labels drawn under the heat, and insights for places plotted / top category / densest neighborhood. Without the file, the demo behaves exactly as above; the file is not shipped in this repo.
- Ships a Python CLI that does the same thing from a file: one CSV in, one single self-contained `output.html` out — the points are embedded as JSON and the renderer is inline, so the output file needs no other assets.

## Run the web demo

No build step, no dependencies. Either serve the folder:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

or just open `index.html` in a browser (the sample data is embedded, so it works from `file://` too).

Controls: scene chips, **Use your own** paste box and **Upload CSV**, **Export PNG**, heat **radius** / **intensity** / **opacity** sliders, **palette** picker, **Use weights**, **Show markers**, and **Ring the densest cluster** toggles, and **Reset**. Hover a marker to see its label, coordinates, and weight (in places mode, its name and category); the corner readout tracks your cursor's lat/lng.

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
- `geo_heat.py` — the CLI, Python standard library only. It owns the canonical logic: `parse_points` / `read_points` (CSV in, valid points out, bad rows skipped), `project` (equirectangular projection), `densest_cell` and `top_labels` (stats), `scene_defaults` (per-scene control defaults), the saved-places helpers (`places_to_points`, `distinct_categories`, `filter_by_category`, `labels_in_view`, `nearest_label`), and `render_html` (a standalone page with the points embedded as JSON and a small inline canvas renderer with the same two-pass heat algorithm).
- `sample/points.csv` — 40 fake, NYC-ish points clustered in three neighborhoods, with generic labels (`cafe`, `park`, `bakery`, …). No real places.
- `tests/` — `unittest` coverage of the Python logic (see below).

The web demo and the CLI implement the same projection and heat model independently; the Python module is the tested reference implementation.

## Tests

```bash
python3 -m unittest discover -s tests -v
```

Covers: CSV parsing (bad rows skipped, empty weight defaults to 1), projection bounds (bounding-box corners and centre map exactly), grid density (picks the cell containing a known planted cluster), top labels, standalone HTML rendering (points embedded, no external URLs), per-scene default/reset state, saved-places conversion and category filtering, and neighborhood labels (in-view selection, on-canvas projection, nearest label). The web demo mirrors these pure functions (`sceneDefaults`, `placesToPoints`, `filterByCategory`, `labelsInView`, `nearestLabel`) with identical semantics.

## Limitations

- **Projection:** equirectangular — longitude and latitude are mapped linearly. That's fine at city scale (the intended use) and increasingly wrong at regional/global scale, where longitude lines converge and east-west distances are overstated away from the equator. For a world map, use a real projection and tile library instead.
- **No basemap:** there are deliberately no map tiles or streets underneath the heat — the output shows *density and relative position*, not geography. (Places mode adds fixed neighborhood-name labels as orientation, nothing more.) If you need to know which street a cluster is on, this is the wrong tool.
- **Scale:** the two-pass per-pixel ramp is comfortable into the low tens of thousands of points; far beyond that, aggregate/bin points first.
- **CSV parsing** expects one header row with `lat`/`lng` columns (plus optional `weight`/`label`); it is not a general-purpose CSV analysis tool.

## License

MIT — see `LICENSE`.
