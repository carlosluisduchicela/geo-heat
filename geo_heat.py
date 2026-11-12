#!/usr/bin/env python3
"""geo-heat: turn a CSV of lat/lng points into a standalone HTML heatmap.

Standard library only. No tiles, no network, no external assets in the
output file.

Input CSV must have a header row with at least:

    lat,lng

and may also have:

    weight,label

Rows with a missing, non-numeric, or out-of-range lat/lng are skipped.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import math
import sys
from typing import Dict, Iterable, List, Sequence, Tuple

Point = Dict[str, object]
Bounds = Tuple[float, float, float, float]  # (min_lat, max_lat, min_lng, max_lng)


# --------------------------------------------------------------------------
# Parsing
# --------------------------------------------------------------------------

def parse_points(rows: Iterable[Dict[str, str]]) -> List[Point]:
    """Return valid points from DictReader-style rows, skipping bad rows."""
    points: List[Point] = []
    for row in rows:
        if row is None:
            continue
        try:
            lat_raw = (row.get("lat") or "").strip()
            lng_raw = (row.get("lng") or "").strip()
            if not lat_raw or not lng_raw:
                continue
            lat = float(lat_raw)
            lng = float(lng_raw)
        except (TypeError, ValueError):
            continue
        if not (math.isfinite(lat) and math.isfinite(lng)):
            continue
        if not (-90.0 <= lat <= 90.0 and -180.0 <= lng <= 180.0):
            continue

        weight = 1.0
        weight_raw = (row.get("weight") or "").strip()
        if weight_raw:
            try:
                parsed_weight = float(weight_raw)
                if math.isfinite(parsed_weight) and parsed_weight > 0:
                    weight = parsed_weight
            except ValueError:
                weight = 1.0

        label = (row.get("label") or "").strip()
        points.append({"lat": lat, "lng": lng, "weight": weight, "label": label})
    return points


def read_points(source) -> List[Point]:
    """Read points from a path, a file object, or CSV text."""
    if hasattr(source, "read"):
        return parse_points(csv.DictReader(source))
    if isinstance(source, str) and ("\n" in source or "," in source) and not _looks_like_path(source):
        return parse_points(csv.DictReader(io.StringIO(source)))
    with open(source, newline="", encoding="utf-8") as handle:
        return parse_points(csv.DictReader(handle))


def _looks_like_path(value: str) -> bool:
    return value.endswith(".csv") and "\n" not in value


# --------------------------------------------------------------------------
# Geometry (equirectangular projection)
# --------------------------------------------------------------------------

def compute_bounds(points: Sequence[Point]) -> Bounds:
    """Return (min_lat, max_lat, min_lng, max_lng) for a non-empty list."""
    if not points:
        raise ValueError("at least one point is required")
    lats = [float(p["lat"]) for p in points]
    lngs = [float(p["lng"]) for p in points]
    return (min(lats), max(lats), min(lngs), max(lngs))


def project(lat: float, lng: float, bounds: Bounds, width: float, height: float,
            pad: float = 0.0) -> Tuple[float, float]:
    """Project lat/lng into canvas coordinates.

    Equirectangular projection: longitude maps linearly to x, latitude
    maps linearly to y (inverted, so north is up). Correct enough at city
    scale; it does not correct for longitude lines converging at the poles.
    """
    min_lat, max_lat, min_lng, max_lng = bounds
    lat_span = (max_lat - min_lat) or 1.0
    lng_span = (max_lng - min_lng) or 1.0
    usable_w = max(width - 2 * pad, 1.0)
    usable_h = max(height - 2 * pad, 1.0)
    x = pad + (lng - min_lng) / lng_span * usable_w
    y = pad + (max_lat - lat) / lat_span * usable_h
    return (x, y)


def densest_cell(points: Sequence[Point], grid: int = 10) -> Dict[str, object]:
    """Return the grid cell (over the points' bounding box) with most points.

    Result keys: row, col, count, center_lat, center_lng.
    Rows run north (row 0) to south, columns west (col 0) to east.
    """
    if not points:
        raise ValueError("at least one point is required")
    if grid < 1:
        raise ValueError("grid must be >= 1")
    min_lat, max_lat, min_lng, max_lng = compute_bounds(points)
    lat_span = (max_lat - min_lat) or 1.0
    lng_span = (max_lng - min_lng) or 1.0

    counts: Dict[Tuple[int, int], int] = {}
    for p in points:
        col = int((float(p["lng"]) - min_lng) / lng_span * grid)
        row = int((max_lat - float(p["lat"])) / lat_span * grid)
        col = min(max(col, 0), grid - 1)
        row = min(max(row, 0), grid - 1)
        counts[(row, col)] = counts.get((row, col), 0) + 1

    (row, col), count = max(counts.items(), key=lambda item: item[1])
    center_lat = max_lat - (row + 0.5) / grid * lat_span
    center_lng = min_lng + (col + 0.5) / grid * lng_span
    return {
        "row": row,
        "col": col,
        "count": count,
        "center_lat": center_lat,
        "center_lng": center_lng,
    }


def top_labels(points: Sequence[Point], limit: int = 5) -> List[Tuple[str, int]]:
    """Most common non-empty labels, most common first."""
    counts: Dict[str, int] = {}
    for p in points:
        label = str(p.get("label") or "").strip()
        if label:
            counts[label] = counts.get(label, 0) + 1
    return sorted(counts.items(), key=lambda item: (-item[1], item[0]))[:limit]


# --------------------------------------------------------------------------
# Standalone HTML output
# --------------------------------------------------------------------------

_HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>__TITLE__</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; margin: 24px; color: #1a1a1a; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  p.meta { color: #555; margin: 0 0 16px; font-size: 14px; }
  canvas { width: 100%; max-width: 960px; height: auto; border: 1px solid #ddd; border-radius: 8px; display: block; }
</style>
</head>
<body>
<h1>__TITLE__</h1>
<p class="meta">__COUNT__ points &middot; generated by geo-heat &middot; equirectangular projection</p>
<canvas id="heat" width="960" height="600"></canvas>
<script>
const POINTS = __POINTS_JSON__;
const canvas = document.getElementById('heat');
const ctx = canvas.getContext('2d');
const W = canvas.width, H = canvas.height, PAD = 24, RADIUS = __RADIUS__;
let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
POINTS.forEach(function (p) {
  minLat = Math.min(minLat, p.lat); maxLat = Math.max(maxLat, p.lat);
  minLng = Math.min(minLng, p.lng); maxLng = Math.max(maxLng, p.lng);
});
const latSpan = (maxLat - minLat) || 1, lngSpan = (maxLng - minLng) || 1;
function project(p) {
  return [
    PAD + (p.lng - minLng) / lngSpan * (W - 2 * PAD),
    PAD + (maxLat - p.lat) / latSpan * (H - 2 * PAD)
  ];
}
// Pass 1: grayscale intensity on an offscreen canvas.
const off = document.createElement('canvas'); off.width = W; off.height = H;
const octx = off.getContext('2d');
const maxW = Math.max.apply(null, POINTS.map(function (p) { return p.weight || 1; }).concat([1]));
POINTS.forEach(function (p) {
  const xy = project(p), x = xy[0], y = xy[1];
  const a = 0.25 + 0.55 * ((p.weight || 1) / maxW);
  const g = octx.createRadialGradient(x, y, 0, x, y, RADIUS);
  g.addColorStop(0, 'rgba(255,255,255,' + a + ')');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  octx.fillStyle = g;
  octx.fillRect(x - RADIUS, y - RADIUS, RADIUS * 2, RADIUS * 2);
});
// Pass 2: map intensity to a color ramp.
const img = octx.getImageData(0, 0, W, H), data = img.data;
const stops = [[0,0,255],[0,255,255],[0,255,0],[255,255,0],[255,0,0]];
function ramp(t) {
  const pos = Math.min(Math.max(t, 0), 0.999) * (stops.length - 1);
  const i = Math.floor(pos), f = pos - i, a = stops[i], b = stops[i + 1];
  return [a[0]+(b[0]-a[0])*f, a[1]+(b[1]-a[1])*f, a[2]+(b[2]-a[2])*f];
}
for (let i = 0; i < data.length; i += 4) {
  const alpha = data[i + 3];
  if (alpha === 0) continue;
  const c = ramp(alpha / 255);
  data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2];
  data[i + 3] = Math.min(255, alpha * 1.6);
}
ctx.putImageData(img, 0, 0);
// Markers on top.
ctx.fillStyle = 'rgba(20,20,20,0.85)';
POINTS.forEach(function (p) {
  const xy = project(p);
  ctx.beginPath(); ctx.arc(xy[0], xy[1], 2.5, 0, Math.PI * 2); ctx.fill();
});
</script>
</body>
</html>
"""


def render_html(points: Sequence[Point], title: str = "geo-heat", radius: int = 36) -> str:
    payload = [
        {"lat": float(p["lat"]), "lng": float(p["lng"]),
         "weight": float(p.get("weight") or 1.0), "label": str(p.get("label") or "")}
        for p in points
    ]
    return (
        _HTML_TEMPLATE
        .replace("__TITLE__", title)
        .replace("__COUNT__", str(len(points)))
        .replace("__RADIUS__", str(int(radius)))
        .replace("__POINTS_JSON__", json.dumps(payload))
    )


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------

def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="geo_heat",
        description="Turn a CSV of lat/lng points into a standalone HTML heatmap page.",
    )
    parser.add_argument("input", help="input CSV with lat,lng columns (weight,label optional)")
    parser.add_argument("-o", "--output", default="output.html",
                        help="output HTML file (default: output.html)")
    parser.add_argument("--title", default="geo-heat", help="page title (default: geo-heat)")
    parser.add_argument("--radius", type=int, default=36,
                        help="heat radius in pixels (default: 36)")
    args = parser.parse_args(argv)

    try:
        points = read_points(args.input)
    except OSError as exc:
        print(f"error: cannot read {args.input}: {exc}", file=sys.stderr)
        return 1
    if not points:
        print("error: no valid points found in input", file=sys.stderr)
        return 1

    html = render_html(points, title=args.title, radius=args.radius)
    with open(args.output, "w", encoding="utf-8") as handle:
        handle.write(html)
    print(f"wrote {args.output} ({len(points)} points)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
