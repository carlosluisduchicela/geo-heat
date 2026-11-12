# geo-heat — PRD

## Problem

People accumulate point lists — saved places, check-ins, deliveries, survey
responses — usually as a CSV with latitude and longitude columns. Seeing the
*density* in that list normally means uploading it to a hosted mapping
service: an account, map tiles, network calls, and your location data on
someone else's server. For a quick "where do these cluster?" question, that's
a lot of machinery and a real privacy trade.

## Product

A tiny, dependency-free heatmap tool with two faces over the same model:

1. A static web demo that runs entirely in the browser, offline, with no
   tiles and no server.
2. A Python (stdlib-only) CLI that turns a CSV into a single standalone HTML
   file that can be emailed, archived, or hosted anywhere.

## Users

Anyone with a points CSV: researchers binning field observations, operators
looking at delivery or visit density, people exploring their own saved-places
exports locally.

## Core loop

CSV in → bad rows skipped, valid points parsed → equirectangular projection
over the points' bounding box → two-pass canvas heat rendering (intensity
blobs, then a color ramp) → stats alongside the picture: count, bounding
box, densest grid cell, top labels.

## Requirements

- Input: CSV with `lat,lng` required, `weight,label` optional; invalid rows
  skipped, never fatal.
- Web controls: sample data (one click), file upload, paste box, heat radius,
  weights on/off, markers on/off, hover readout, live stats.
- CLI: `geo_heat.py input.csv -o output.html`, `--help`, no third-party
  packages, output file fully self-contained.
- Sample data is fake (generic labels, three visible clusters) so the first
  screen is a real heatmap, not an empty state.
- Python logic is unit-tested (parsing, projection, grid density).

## Non-goals

- No basemap, geocoding, routing, or place search — density and relative
  position only.
- No accounts, uploads, or analytics; nothing leaves the machine.
- No global-scale accuracy: equirectangular projection is a deliberate
  city-scale simplification, named as a limitation in the README.

## Success criteria

- A visitor opens the page and sees a working heatmap of the sample data in
  under a minute, offline.
- A user can go from their own CSV to a shareable standalone heatmap file
  with one CLI command.
- Tests pass with `python3 -m unittest discover -s tests -v`.
