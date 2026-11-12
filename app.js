'use strict';

/* geo-heat web demo — the offline heatmap lab. No libraries, no network,
 * no map tiles. Heat is rendered in two passes:
 *   1. radial-gradient intensity blobs on an offscreen canvas (grayscale)
 *   2. a color ramp applied per-pixel, composited at the chosen opacity
 * Scenes are fictional point sets generated locally with a seeded PRNG,
 * so the demo is identical on every load and works straight from file://.
 */

// ------------------------------------------------------------- Sample + scenes

const SAMPLE_CSV = "lat,lng,weight,label\n40.809465,-73.941909,1,cafe\n40.817677,-73.941643,3,park\n40.799582,-73.95472,2,bakery\n40.817221,-73.944009,1,bookstore\n40.811445,-73.935893,1,market\n40.812432,-73.949643,2,gallery\n40.80559,-73.953742,1,cafe\n40.805662,-73.949746,2,park\n40.82236,-73.941436,3,cafe\n40.804461,-73.941145,3,bakery\n40.802561,-73.950476,1,market\n40.803537,-73.951601,3,cafe\n40.818749,-73.938745,1,bookstore\n40.805847,-73.952372,4,park\n40.729144,-73.998825,5,cafe\n40.725075,-73.98538,2,gallery\n40.726586,-73.99568,3,bakery\n40.715914,-73.992573,5,park\n40.724033,-73.968231,1,bookstore\n40.724407,-73.99036,3,cafe\n40.732016,-73.982433,1,market\n40.730344,-73.99076,3,gallery\n40.725011,-73.983731,5,cafe\n40.722194,-73.994249,1,park\n40.734395,-73.993089,1,bakery\n40.73666,-73.985372,5,cafe\n40.726722,-73.982287,3,gallery\n40.695611,-74.018742,2,park\n40.683632,-74.025991,2,cafe\n40.689361,-74.024183,2,market\n40.67828,-74.009324,5,bakery\n40.694731,-74.015763,3,gallery\n40.69725,-74.029898,3,bookstore\n40.684238,-74.042593,4,park\n40.692312,-74.021201,2,cafe\n40.694112,-74.010456,1,market\n40.681033,-74.018993,3,park\n40.688329,-74.015601,3,bakery\n40.684947,-74.02446,2,cafe\n40.686362,-74.028965,1,gallery\n";

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/* Roughly gaussian scatter in [-1, 1]. */
function gauss(rng) { return (rng() + rng() + rng()) / 1.5 - 1; }

function clusterCsv(rng, clusters) {
  const rows = ['lat,lng,weight,label'];
  clusters.forEach(function (c) {
    for (let i = 0; i < c.n; i++) {
      let lat, lng;
      if (c.ring) { // points on a fuzzy ring around the center
        const ang = rng() * Math.PI * 2;
        const rad = c.ring * (0.85 + rng() * 0.3);
        lat = c.lat + Math.sin(ang) * rad;
        lng = c.lng + Math.cos(ang) * rad * 1.3;
      } else {
        lat = c.lat + gauss(rng) * c.spread;
        lng = c.lng + gauss(rng) * c.spread * 1.3;
      }
      const w = Math.max(1, Math.round(c.weight * (0.5 + rng())));
      rows.push(lat.toFixed(6) + ',' + lng.toFixed(6) + ',' + w + ',' + c.label);
    }
  });
  return rows.join('\n');
}

const SCENES = {
  sample: {
    name: 'Neighborhoods',
    csv: function () { return SAMPLE_CSV; },
  },
  delivery: {
    name: 'Delivery rush',
    csv: function () {
      return clusterCsv(mulberry32(20240), [
        { lat: 40.758, lng: -73.985, n: 46, spread: 0.006, weight: 5, label: 'restaurant' },
        { lat: 40.741, lng: -73.990, n: 34, spread: 0.007, weight: 4, label: 'courier' },
        { lat: 40.728, lng: -74.000, n: 24, spread: 0.005, weight: 3, label: 'hub' },
        { lat: 40.770, lng: -73.970, n: 20, spread: 0.006, weight: 3, label: 'restaurant' },
        { lat: 40.715, lng: -73.980, n: 14, spread: 0.008, weight: 2, label: 'courier' },
      ]);
    },
  },
  stadium: {
    name: 'Stadium night',
    csv: function () {
      return clusterCsv(mulberry32(9182), [
        { lat: 40.820, lng: -73.950, n: 90, spread: 0.0032, weight: 5, label: 'gate' },
        { lat: 40.820, lng: -73.950, n: 52, ring: 0.010, weight: 3, label: 'transit' },
        { lat: 40.812, lng: -73.938, n: 22, spread: 0.004, weight: 3, label: 'food' },
        { lat: 40.831, lng: -73.962, n: 16, spread: 0.004, weight: 2, label: 'food' },
      ]);
    },
  },
  parks: {
    name: 'Weekend parks',
    csv: function () {
      return clusterCsv(mulberry32(55501), [
        { lat: 40.790, lng: -73.960, n: 26, spread: 0.009, weight: 3, label: 'picnic' },
        { lat: 40.768, lng: -73.972, n: 22, spread: 0.010, weight: 2, label: 'run' },
        { lat: 40.802, lng: -73.945, n: 20, spread: 0.008, weight: 3, label: 'dogs' },
        { lat: 40.748, lng: -73.990, n: 16, spread: 0.009, weight: 2, label: 'picnic' },
      ]);
    },
  },
};

// ------------------------------------------------------------- State + elements

const state = {
  points: [],
  projected: [], // {x, y, point} in CSS-pixel canvas coordinates, for hover
  bounds: null,
  scene: 'sample',
};

const els = {
  canvas: document.getElementById('heat'),
  tooltip: document.getElementById('tooltip'),
  cursorReadout: document.getElementById('cursorReadout'),
  legendRamp: document.getElementById('legendRamp'),
  fileInput: document.getElementById('fileInput'),
  pasteBox: document.getElementById('pasteBox'),
  loadPaste: document.getElementById('loadPaste'),
  exportPng: document.getElementById('exportPng'),
  radius: document.getElementById('radius'),
  radiusValue: document.getElementById('radiusValue'),
  intensity: document.getElementById('intensity'),
  intensityValue: document.getElementById('intensityValue'),
  opacity: document.getElementById('opacity'),
  opacityValue: document.getElementById('opacityValue'),
  palette: document.getElementById('palette'),
  useWeights: document.getElementById('useWeights'),
  showMarkers: document.getElementById('showMarkers'),
  showDensest: document.getElementById('showDensest'),
  sceneChips: Array.prototype.slice.call(document.querySelectorAll('.chip[data-scene]')),
  status: document.getElementById('status'),
  statCount: document.getElementById('statCount'),
  statDensest: document.getElementById('statDensest'),
  statWeight: document.getElementById('statWeight'),
  statHot: document.getElementById('statHot'),
  statDensestCenter: document.getElementById('statDensestCenter'),
  statBounds: document.getElementById('statBounds'),
  statSpan: document.getElementById('statSpan'),
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
  if (!lines.length) return [];
  const header = splitCsvLine(lines[0]).map(function (h) { return h.toLowerCase(); });
  let iLat = header.indexOf('lat'), iLng = header.indexOf('lng');
  let iWeight = header.indexOf('weight'), iLabel = header.indexOf('label');
  let firstRow = 1;
  if (iLat === -1 || iLng === -1) {
    // Headerless paste: bare "lat,lng[,weight[,label]]" rows.
    if (!Number.isFinite(parseFloat(splitCsvLine(lines[0])[0]))) return [];
    iLat = 0; iLng = 1; iWeight = 2; iLabel = 3; firstRow = 0;
  }
  const points = [];
  for (let r = firstRow; r < lines.length; r++) {
    const cols = splitCsvLine(lines[r]);
    const lat = parseFloat(cols[iLat]);
    const lng = parseFloat(cols[iLng]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;
    let weight = 1;
    if (iWeight !== -1 && cols[iWeight] !== undefined) {
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

function unproject(x, y, bounds, width, height) {
  const latSpan = (bounds.maxLat - bounds.minLat) || 1;
  const lngSpan = (bounds.maxLng - bounds.minLng) || 1;
  return [
    bounds.maxLat - y / height * latSpan,
    bounds.minLng + x / width * lngSpan,
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

function hottestLabel(points) {
  const weights = new Map();
  points.forEach(function (p) {
    if (p.label) weights.set(p.label, (weights.get(p.label) || 0) + p.weight);
  });
  let best = null, bestW = -1;
  weights.forEach(function (w, label) { if (w > bestW) { bestW = w; best = label; } });
  return best;
}

// ---------------------------------------------------------------- Rendering

const PALETTES = {
  classic: [[0, 0, 255], [0, 255, 255], [0, 255, 0], [255, 255, 0], [255, 0, 0]],
  ember: [[38, 10, 60], [122, 22, 92], [222, 62, 42], [250, 160, 40], [255, 232, 165]],
  ocean: [[8, 40, 90], [0, 110, 160], [0, 190, 190], [120, 240, 200], [240, 255, 220]],
};

function rampColor(stops, t) {
  const pos = Math.min(Math.max(t, 0), 0.999) * (stops.length - 1);
  const i = Math.floor(pos), f = pos - i, a = stops[i], b = stops[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

function cssRamp(stops) {
  return 'linear-gradient(to right, ' + stops.map(function (s) {
    return 'rgb(' + s[0] + ',' + s[1] + ',' + s[2] + ')';
  }).join(', ') + ')';
}

function drawGrid(ctx, W, H, dpr) {
  ctx.fillStyle = '#10151f';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(148,180,255,0.07)';
  ctx.lineWidth = 1;
  const step = 48 * dpr;
  ctx.beginPath();
  for (let x = step; x < W; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
  for (let y = step; y < H; y += step) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
  ctx.stroke();
  if (state.bounds) { // corner coordinate ticks, map-lab style
    ctx.fillStyle = 'rgba(220,230,255,0.5)';
    ctx.font = (11 * dpr) + 'px ui-monospace, Menlo, monospace';
    const b = state.bounds;
    ctx.fillText(fmt(b.maxLat) + ', ' + fmt(b.minLng), 8 * dpr, 16 * dpr);
    const se = fmt(b.minLat) + ', ' + fmt(b.maxLng);
    ctx.fillText(se, W - ctx.measureText(se).width - 8 * dpr, H - 8 * dpr);
  }
}

let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(function () { renderQueued = false; render(); });
}

function render() {
  const canvas = els.canvas;
  const wrap = canvas.parentElement;
  const cssW = wrap.clientWidth || 960;
  const cssH = Math.round(cssW * 0.625);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
  }
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  drawGrid(ctx, W, H, dpr);
  state.projected = [];

  if (!state.points.length) {
    ctx.fillStyle = 'rgba(230,236,255,0.85)';
    ctx.font = (16 * dpr) + 'px system-ui, sans-serif';
    ctx.fillText('Pick a scene, upload a CSV, or paste points to begin.', 24 * dpr, 44 * dpr);
    updateStats(cssW, cssH);
    return;
  }

  const bounds = state.bounds;
  const radius = Number(els.radius.value) * dpr;
  const intensity = Number(els.intensity.value) / 100;
  const opacity = Number(els.opacity.value) / 100;
  const stops = PALETTES[els.palette.value] || PALETTES.classic;
  const useWeights = els.useWeights.checked;
  const maxWeight = Math.max.apply(null, state.points.map(function (p) { return p.weight; }).concat([1]));

  // Pass 1: grayscale intensity on an offscreen canvas.
  const off = document.createElement('canvas');
  off.width = W; off.height = H;
  const octx = off.getContext('2d');
  state.points.forEach(function (p) {
    const xy = project(p, bounds, W, H);
    state.projected.push({ x: xy[0] / dpr, y: xy[1] / dpr, point: p });
    const effective = useWeights ? p.weight : 1;
    const a = (0.20 + 0.55 * (effective / (useWeights ? maxWeight : 1))) * intensity;
    const g = octx.createRadialGradient(xy[0], xy[1], 0, xy[0], xy[1], radius);
    g.addColorStop(0, 'rgba(255,255,255,' + Math.min(a, 0.9) + ')');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    octx.fillStyle = g;
    octx.fillRect(xy[0] - radius, xy[1] - radius, radius * 2, radius * 2);
  });

  // Pass 2: map intensity through the color ramp, composite at chosen opacity.
  const img = octx.getImageData(0, 0, W, H);
  const data = img.data;
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    if (alpha === 0) continue;
    const c = rampColor(stops, alpha / 255);
    data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2];
    data[i + 3] = Math.min(255, alpha * 1.7);
  }
  const heatLayer = document.createElement('canvas');
  heatLayer.width = W; heatLayer.height = H;
  heatLayer.getContext('2d').putImageData(img, 0, 0);
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.drawImage(heatLayer, 0, 0);
  ctx.restore();

  if (els.showMarkers.checked) {
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.strokeStyle = 'rgba(10,14,22,0.9)';
    ctx.lineWidth = 1;
    state.projected.forEach(function (item) {
      ctx.beginPath();
      ctx.arc(item.x * dpr, item.y * dpr, 2.6 * dpr, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
    });
  }

  if (els.showDensest.checked) {
    const cell = densestCell(state.points, 10);
    const xy = project({ lat: cell.centerLat, lng: cell.centerLng }, bounds, W, H);
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = 1.6 * dpr;
    ctx.setLineDash([6 * dpr, 4 * dpr]);
    ctx.beginPath();
    ctx.arc(xy[0], xy[1], radius * 0.85, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = '600 ' + (11 * dpr) + 'px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.fillText('densest · ' + cell.count + ' pts', xy[0] + radius * 0.6, xy[1] - radius * 0.6);
    ctx.restore();
  }
  updateStats(cssW, cssH);
}

function fmt(n) { return n.toFixed(3); }

function updateStats() {
  const points = state.points;
  if (!points.length) {
    els.statCount.textContent = '0';
    els.statDensest.textContent = '—';
    els.statWeight.textContent = '—';
    els.statHot.textContent = '—';
    els.statDensestCenter.textContent = '—';
    els.statBounds.textContent = '—';
    els.statSpan.textContent = '—';
    els.statLabels.textContent = '—';
    return;
  }
  const b = state.bounds.raw;
  els.statCount.textContent = String(points.length);
  const cell = densestCell(points, 10);
  els.statDensest.textContent = String(cell.count);
  els.statDensestCenter.textContent = fmt(cell.centerLat) + ', ' + fmt(cell.centerLng);
  const totalWeight = points.reduce(function (sum, p) { return sum + p.weight; }, 0);
  els.statWeight.textContent = String(Math.round(totalWeight * 10) / 10);
  els.statHot.textContent = hottestLabel(points) || '—';
  els.statBounds.textContent =
    'lat ' + fmt(b.minLat) + ' to ' + fmt(b.maxLat) + ' · lng ' + fmt(b.minLng) + ' to ' + fmt(b.maxLng);
  const kmLat = (b.maxLat - b.minLat) * 111.2;
  const kmLng = (b.maxLng - b.minLng) * 85.4; // ~1° lng at 40°N
  els.statSpan.textContent = kmLat.toFixed(1) + ' km N–S × ' + kmLng.toFixed(1) + ' km E–W';
  const tops = topLabels(points, 5);
  els.statLabels.textContent = tops.length
    ? tops.map(function (t) { return t[0] + ' ×' + t[1]; }).join(', ')
    : '—';
}

function setPoints(points, sourceLabel) {
  state.points = points;
  state.bounds = points.length ? computeBounds(points) : null;
  els.status.textContent = points.length
    ? points.length + ' points on the map · ' + sourceLabel + '. Drag the sliders — the heat re-renders live.'
    : 'No valid points found in ' + sourceLabel + '. Check for lat,lng values in range.';
  scheduleRender();
}

function setScene(key) {
  state.scene = key;
  els.sceneChips.forEach(function (chip) {
    chip.classList.toggle('is-active', chip.dataset.scene === key);
  });
  setPoints(parseCSV(SCENES[key].csv()), 'scene: ' + SCENES[key].name);
}

// ---------------------------------------------------------------- Events

els.sceneChips.forEach(function (chip) {
  chip.addEventListener('click', function () { setScene(chip.dataset.scene); });
});

els.fileInput.addEventListener('change', function () {
  const file = els.fileInput.files && els.fileInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function () { setPoints(parseCSV(String(reader.result || '')), file.name); };
  reader.readAsText(file);
});

els.loadPaste.addEventListener('click', function () {
  setPoints(parseCSV(els.pasteBox.value), 'pasted points');
});

els.exportPng.addEventListener('click', function () {
  if (!state.points.length) return;
  const a = document.createElement('a');
  a.download = 'geo-heat-' + state.scene + '.png';
  a.href = els.canvas.toDataURL('image/png');
  a.click();
});

function syncControlLabels() {
  els.radiusValue.textContent = els.radius.value + 'px';
  els.intensityValue.textContent = els.intensity.value + '%';
  els.opacityValue.textContent = els.opacity.value + '%';
  els.legendRamp.style.background = cssRamp(PALETTES[els.palette.value] || PALETTES.classic);
}
[els.radius, els.intensity, els.opacity, els.palette, els.useWeights, els.showMarkers, els.showDensest]
  .forEach(function (el) {
    el.addEventListener('input', function () { syncControlLabels(); scheduleRender(); });
    el.addEventListener('change', function () { syncControlLabels(); scheduleRender(); });
  });

function canvasPos(ev) {
  const rect = els.canvas.getBoundingClientRect();
  return { x: ev.clientX - rect.left, y: ev.clientY - rect.top, rect: rect };
}

els.canvas.addEventListener('mousemove', function (ev) {
  const pos = canvasPos(ev);
  if (state.bounds) {
    const ll = unproject(pos.x, pos.y, state.bounds, pos.rect.width, pos.rect.height);
    els.cursorReadout.textContent = fmt(ll[0]) + ', ' + fmt(ll[1]);
  }
  if (!state.projected.length) { els.tooltip.hidden = true; return; }
  let best = null, bestDist = 16;
  state.projected.forEach(function (item) {
    const d = Math.hypot(item.x - pos.x, item.y - pos.y);
    if (d < bestDist) { bestDist = d; best = item; }
  });
  if (!best) { els.tooltip.hidden = true; return; }
  const p = best.point;
  els.tooltip.textContent =
    (p.label ? p.label + ' · ' : '') + fmt(p.lat) + ', ' + fmt(p.lng) + ' · weight ' + p.weight;
  els.tooltip.style.left = (pos.x + 12) + 'px';
  els.tooltip.style.top = (pos.y + 12) + 'px';
  els.tooltip.hidden = false;
});
els.canvas.addEventListener('mouseleave', function () {
  els.tooltip.hidden = true;
  els.cursorReadout.textContent = 'move over the map';
});

let resizeTimer = null;
window.addEventListener('resize', function () {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(scheduleRender, 120);
});

// Start on the sample scene so the first screen is a real heatmap, not a blank box.
syncControlLabels();
setScene('sample');
