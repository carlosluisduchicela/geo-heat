'use strict';

/* geo-heat web demo. No libraries, no network, no map tiles.
 * Heat is rendered in two passes:
 *   1. radial-gradient intensity blobs on an offscreen canvas (grayscale)
 *   2. a color ramp applied per-pixel, then composited onto the visible canvas
 * The sample below mirrors sample/points.csv so the demo also works
 * straight from file:// with no fetch.
 */
const SAMPLE_CSV = "lat,lng,weight,label\n40.809465,-73.941909,1,cafe\n40.817677,-73.941643,3,park\n40.799582,-73.95472,2,bakery\n40.817221,-73.944009,1,bookstore\n40.811445,-73.935893,1,market\n40.812432,-73.949643,2,gallery\n40.80559,-73.953742,1,cafe\n40.805662,-73.949746,2,park\n40.82236,-73.941436,3,cafe\n40.804461,-73.941145,3,bakery\n40.802561,-73.950476,1,market\n40.803537,-73.951601,3,cafe\n40.818749,-73.938745,1,bookstore\n40.805847,-73.952372,4,park\n40.729144,-73.998825,5,cafe\n40.725075,-73.98538,2,gallery\n40.726586,-73.99568,3,bakery\n40.715914,-73.992573,5,park\n40.724033,-73.968231,1,bookstore\n40.724407,-73.99036,3,cafe\n40.732016,-73.982433,1,market\n40.730344,-73.99076,3,gallery\n40.725011,-73.983731,5,cafe\n40.722194,-73.994249,1,park\n40.734395,-73.993089,1,bakery\n40.73666,-73.985372,5,cafe\n40.726722,-73.982287,3,gallery\n40.695611,-74.018742,2,park\n40.683632,-74.025991,2,cafe\n40.689361,-74.024183,2,market\n40.67828,-74.009324,5,bakery\n40.694731,-74.015763,3,gallery\n40.69725,-74.029898,3,bookstore\n40.684238,-74.042593,4,park\n40.692312,-74.021201,2,cafe\n40.694112,-74.010456,1,market\n40.681033,-74.018993,3,park\n40.688329,-74.015601,3,bakery\n40.684947,-74.02446,2,cafe\n40.686362,-74.028965,1,gallery\n";

const state = {
  points: [],
  projected: [], // {x, y, point} in canvas coordinates, for hover
  bounds: null,
};

const els = {
  canvas: document.getElementById('heat'),
  tooltip: document.getElementById('tooltip'),
  loadSample: document.getElementById('loadSample'),
  fileInput: document.getElementById('fileInput'),
  pasteBox: document.getElementById('pasteBox'),
  loadPaste: document.getElementById('loadPaste'),
  radius: document.getElementById('radius'),
  radiusValue: document.getElementById('radiusValue'),
  useWeights: document.getElementById('useWeights'),
  showMarkers: document.getElementById('showMarkers'),
  status: document.getElementById('status'),
  statCount: document.getElementById('statCount'),
  statBounds: document.getElementById('statBounds'),
  statDensest: document.getElementById('statDensest'),
  statLabels: document.getElementById('statLabels'),
};

// ---------------------------------------------------------------- CSV parsing

function splitCsvLine(line) {
  const fields = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else { field += ch; }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      fields.push(field); field = '';
    } else { field += ch; }
  }
  fields.push(field);
  return fields.map(function (f) { return f.trim(); });
}

function parseCSV(text) {
  const lines = String(text).split(/\r?\n/).filter(function (l) { return l.trim() !== ''; });
  if (lines.length < 2) return [];
  const header = splitCsvLine(lines[0]).map(function (h) { return h.toLowerCase(); });
  const iLat = header.indexOf('lat');
  const iLng = header.indexOf('lng');
  if (iLat === -1 || iLng === -1) return [];
  const iWeight = header.indexOf('weight');
  const iLabel = header.indexOf('label');
  const points = [];
  for (let r = 1; r < lines.length; r++) {
    const cols = splitCsvLine(lines[r]);
    const lat = parseFloat(cols[iLat]);
    const lng = parseFloat(cols[iLng]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;
    let weight = 1;
    if (iWeight !== -1) {
      const w = parseFloat(cols[iWeight]);
      if (Number.isFinite(w) && w > 0) weight = w;
    }
    points.push({ lat: lat, lng: lng, weight: weight, label: iLabel !== -1 ? (cols[iLabel] || '') : '' });
  }
  return points;
}

// ---------------------------------------------------------------- Geometry

function computeBounds(points) {
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  points.forEach(function (p) {
    minLat = Math.min(minLat, p.lat); maxLat = Math.max(maxLat, p.lat);
    minLng = Math.min(minLng, p.lng); maxLng = Math.max(maxLng, p.lng);
  });
  // Pad by 8% of span so edge points (and their heat) are not clipped.
  const latPad = ((maxLat - minLat) || 0.01) * 0.08;
  const lngPad = ((maxLng - minLng) || 0.01) * 0.08;
  return {
    raw: { minLat: minLat, maxLat: maxLat, minLng: minLng, maxLng: maxLng },
    minLat: minLat - latPad, maxLat: maxLat + latPad,
    minLng: minLng - lngPad, maxLng: maxLng + lngPad,
  };
}

function project(p, bounds, width, height) {
  const latSpan = (bounds.maxLat - bounds.minLat) || 1;
  const lngSpan = (bounds.maxLng - bounds.minLng) || 1;
  return [
    (p.lng - bounds.minLng) / lngSpan * width,
    (bounds.maxLat - p.lat) / latSpan * height,
  ];
}

function densestCell(points, grid) {
  const b = computeBounds(points).raw;
  const latSpan = (b.maxLat - b.minLat) || 1;
  const lngSpan = (b.maxLng - b.minLng) || 1;
  const counts = new Map();
  points.forEach(function (p) {
    let col = Math.floor((p.lng - b.minLng) / lngSpan * grid);
    let row = Math.floor((b.maxLat - p.lat) / latSpan * grid);
    col = Math.min(Math.max(col, 0), grid - 1);
    row = Math.min(Math.max(row, 0), grid - 1);
    const key = row + ',' + col;
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  let bestKey = null, bestCount = -1;
  counts.forEach(function (count, key) { if (count > bestCount) { bestCount = count; bestKey = key; } });
  const parts = bestKey.split(',');
  const row = Number(parts[0]), col = Number(parts[1]);
  return {
    row: row, col: col, count: bestCount,
    centerLat: b.maxLat - (row + 0.5) / grid * latSpan,
    centerLng: b.minLng + (col + 0.5) / grid * lngSpan,
  };
}

function topLabels(points, limit) {
  const counts = new Map();
  points.forEach(function (p) {
    if (p.label) counts.set(p.label, (counts.get(p.label) || 0) + 1);
  });
  return Array.from(counts.entries())
    .sort(function (a, b) { return b[1] - a[1] || (a[0] < b[0] ? -1 : 1); })
    .slice(0, limit);
}

// ---------------------------------------------------------------- Rendering

const RAMP = [[0, 0, 255], [0, 255, 255], [0, 255, 0], [255, 255, 0], [255, 0, 0]];

function rampColor(t) {
  const pos = Math.min(Math.max(t, 0), 0.999) * (RAMP.length - 1);
  const i = Math.floor(pos), f = pos - i, a = RAMP[i], b = RAMP[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

function render() {
  const canvas = els.canvas;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#f7f6f2';
  ctx.fillRect(0, 0, W, H);
  state.projected = [];

  if (!state.points.length) {
    ctx.fillStyle = '#666';
    ctx.font = '16px system-ui, sans-serif';
    ctx.fillText('Load the sample data, upload a CSV, or paste one to begin.', 24, 40);
    updateStats();
    return;
  }

  const bounds = state.bounds;
  const radius = Number(els.radius.value);
  const useWeights = els.useWeights.checked;
  const maxWeight = Math.max.apply(null, state.points.map(function (p) { return p.weight; }).concat([1]));

  // Pass 1: grayscale intensity on an offscreen canvas.
  const off = document.createElement('canvas');
  off.width = W; off.height = H;
  const octx = off.getContext('2d');
  state.points.forEach(function (p) {
    const xy = project(p, bounds, W, H);
    state.projected.push({ x: xy[0], y: xy[1], point: p });
    const effective = useWeights ? p.weight : 1;
    const a = 0.22 + 0.55 * (effective / (useWeights ? maxWeight : 1));
    const g = octx.createRadialGradient(xy[0], xy[1], 0, xy[0], xy[1], radius);
    g.addColorStop(0, 'rgba(255,255,255,' + Math.min(a, 0.85) + ')');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    octx.fillStyle = g;
    octx.fillRect(xy[0] - radius, xy[1] - radius, radius * 2, radius * 2);
  });

  // Pass 2: map intensity through the color ramp, composite over background.
  const img = octx.getImageData(0, 0, W, H);
  const data = img.data;
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    if (alpha === 0) continue;
    const c = rampColor(alpha / 255);
    data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2];
    data[i + 3] = Math.min(255, alpha * 1.7);
  }
  const heatLayer = document.createElement('canvas');
  heatLayer.width = W; heatLayer.height = H;
  heatLayer.getContext('2d').putImageData(img, 0, 0);
  ctx.drawImage(heatLayer, 0, 0);

  if (els.showMarkers.checked) {
    ctx.fillStyle = 'rgba(20,20,20,0.85)';
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1;
    state.projected.forEach(function (item) {
      ctx.beginPath();
      ctx.arc(item.x, item.y, 3, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
    });
  }
  updateStats();
}

function fmt(n) { return n.toFixed(3); }

function updateStats() {
  const points = state.points;
  if (!points.length) {
    els.statCount.textContent = '0';
    els.statBounds.textContent = '—';
    els.statDensest.textContent = '—';
    els.statLabels.textContent = '—';
    return;
  }
  const b = state.bounds.raw;
  els.statCount.textContent = String(points.length);
  els.statBounds.textContent =
    'lat ' + fmt(b.minLat) + ' to ' + fmt(b.maxLat) + ', lng ' + fmt(b.minLng) + ' to ' + fmt(b.maxLng);
  const cell = densestCell(points, 10);
  els.statDensest.textContent =
    cell.count + ' points near ' + fmt(cell.centerLat) + ', ' + fmt(cell.centerLng) +
    ' (row ' + cell.row + ', col ' + cell.col + ')';
  const tops = topLabels(points, 5);
  els.statLabels.textContent = tops.length
    ? tops.map(function (t) { return t[0] + ' ×' + t[1]; }).join(', ')
    : '—';
}

function setPoints(points, sourceLabel) {
  state.points = points;
  state.bounds = points.length ? computeBounds(points) : null;
  els.status.textContent = points.length
    ? points.length + ' points loaded from ' + sourceLabel + '.'
    : 'No valid points found in ' + sourceLabel + '. Check the lat,lng header and values.';
  render();
}

// ---------------------------------------------------------------- Events

els.loadSample.addEventListener('click', function () {
  setPoints(parseCSV(SAMPLE_CSV), 'sample data');
});

els.fileInput.addEventListener('change', function () {
  const file = els.fileInput.files && els.fileInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function () { setPoints(parseCSV(String(reader.result || '')), file.name); };
  reader.readAsText(file);
});

els.loadPaste.addEventListener('click', function () {
  setPoints(parseCSV(els.pasteBox.value), 'pasted CSV');
});

[els.radius, els.useWeights, els.showMarkers].forEach(function (el) {
  el.addEventListener('input', function () {
    els.radiusValue.textContent = els.radius.value;
    render();
  });
  el.addEventListener('change', render);
});

els.canvas.addEventListener('mousemove', function (ev) {
  if (!state.projected.length) { els.tooltip.hidden = true; return; }
  const rect = els.canvas.getBoundingClientRect();
  const x = (ev.clientX - rect.left) * (els.canvas.width / rect.width);
  const y = (ev.clientY - rect.top) * (els.canvas.height / rect.height);
  let best = null, bestDist = 16;
  state.projected.forEach(function (item) {
    const d = Math.hypot(item.x - x, item.y - y);
    if (d < bestDist) { bestDist = d; best = item; }
  });
  if (!best) { els.tooltip.hidden = true; return; }
  const p = best.point;
  els.tooltip.textContent =
    (p.label ? p.label + ' · ' : '') + fmt(p.lat) + ', ' + fmt(p.lng) + ' · weight ' + p.weight;
  els.tooltip.style.left = (ev.clientX - rect.left + 12) + 'px';
  els.tooltip.style.top = (ev.clientY - rect.top + 12) + 'px';
  els.tooltip.hidden = false;
});
els.canvas.addEventListener('mouseleave', function () { els.tooltip.hidden = true; });

function fitCanvas() {
  const wrap = els.canvas.parentElement;
  const w = wrap.clientWidth;
  if (w > 0) {
    els.canvas.width = w;
    els.canvas.height = Math.round(w * 0.625);
  }
  render();
}
window.addEventListener('resize', fitCanvas);

// Start with the sample so the first screen is a real heatmap, not a blank box.
fitCanvas();
setPoints(parseCSV(SAMPLE_CSV), 'sample data');
