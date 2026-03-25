import { escapeHtml, normalizeHeader, readFileAsText, readFileAsArrayBuffer, toNumber } from './utils.js';

export async function parseIncidenceFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();

  if (ext === 'csv') {
    const text = await readFileAsText(file);
    const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
    if (parsed.errors && parsed.errors.length) {
      throw new Error('CSV con formato inválido. Revisa separadores y comillas.');
    }
    return normalizeIncidenceRows(parsed.data);
  }

  if (ext === 'xlsx' || ext === 'xls') {
    const buffer = await readFileAsArrayBuffer(file);
    const wb = XLSX.read(buffer, { type: 'array' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    return normalizeIncidenceRows(rows);
  }

  throw new Error('Formato no soportado. Usa CSV o Excel.');
}

export function normalizeIncidenceRows(rows) {
  if (!rows || !rows.length) throw new Error('No hay filas con datos.');

  const headers = Object.keys(rows[0]);
  const col = detectLatLonColumns(headers);

  if (!col.lat || !col.lon) throw new Error('No se detectaron columnas de latitud/longitud.');

  const idCol = detectIdColumn(headers);
  const points = [];

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const lat = toNumber(row[col.lat]);
    const lon = toNumber(row[col.lon]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    points.push({ id: idCol ? row[idCol] : i + 1, lat: lat, lon: lon, props: row });
  }

  if (!points.length) throw new Error('No se encontraron coordenadas válidas.');
  return points;
}

export function detectLatLonColumns(headers) {
  const normalized = headers.map(function (h) {
    return { raw: h, norm: normalizeHeader(h) };
  });

  function findByCandidates(candidates) {
    for (let i = 0; i < candidates.length; i += 1) {
      const c = candidates[i];
      for (let j = 0; j < normalized.length; j += 1) {
        if (normalized[j].norm === c) return normalized[j].raw;
      }
    }
    for (let i = 0; i < candidates.length; i += 1) {
      const c = candidates[i];
      for (let j = 0; j < normalized.length; j += 1) {
        if (normalized[j].norm.includes(c)) return normalized[j].raw;
      }
    }
    return null;
  }

  return {
    lat: findByCandidates(['latitud', 'lat', 'latitude', 'y']),
    lon: findByCandidates(['longitud', 'lon', 'lng', 'longitude', 'x']),
  };
}

export function detectIdColumn(headers) {
  const candidates = ['id', 'codigo', 'code', 'ticket'];
  const normalized = headers.map(function (h) {
    return { raw: h, norm: normalizeHeader(h) };
  });
  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = 0; j < normalized.length; j += 1) {
      if (normalized[j].norm === candidates[i]) return normalized[j].raw;
    }
  }
  return null;
}

export function renderIncidences(ctx, points, fileName) {
  ctx.state.incidences.points = points.slice();
  ctx.state.incidences.fileName = fileName;
  ctx.state.incidences.visible = true;

  removeIncidenceLayer(ctx);
  ctx.state.incidences.layer = buildIncidenceLayer(ctx);

  if (ctx.state.incidences.layer) ctx.state.incidences.layer.addTo(ctx.state.map);

  ctx.els.btnIncToggle.disabled = false;
  ctx.els.btnIncCluster.disabled = false;
  ctx.els.btnIncClear.disabled = false;
  ctx.els.btnIncToggle.textContent = 'Ocultar';
  ctx.els.btnIncCluster.textContent = ctx.state.incidences.clustered ? 'Cluster ON' : 'Cluster OFF';
  ctx.els.incMeta.textContent = fileName + ' · ' + points.length + ' puntos';
}

export function buildIncidenceLayer(ctx) {
  const useCluster = ctx.state.incidences.clustered && typeof L.markerClusterGroup === 'function';
  const layer = useCluster
    ? L.markerClusterGroup({ showCoverageOnHover: false, disableClusteringAtZoom: 16 })
    : L.layerGroup();

  const pts = ctx.state.incidences.points;

  for (let i = 0; i < pts.length; i += 1) {
    const p = pts[i];
    const marker = L.marker([p.lat, p.lon], {
      icon: L.divIcon({
        className: '',
        html: '<div class="inc-marker"></div>',
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      }),
    });

    const popupRows = [];
    const props = p.props || {};
    const keys = Object.keys(props).slice(0, 14);

    for (let j = 0; j < keys.length; j += 1) {
      const k = keys[j];
      const nk = normalizeHeader(k);
      if (nk === 'lat' || nk === 'latitud' || nk === 'latitude' || nk === 'y') continue;
      if (nk === 'lon' || nk === 'lng' || nk === 'longitud' || nk === 'longitude' || nk === 'x') continue;
      popupRows.push('<div><strong>' + escapeHtml(k) + ':</strong> ' + escapeHtml(props[k]) + '</div>');
    }

    marker.bindPopup(
      '<div style="font-size:12px;line-height:1.4">' +
        '<div><strong>Incidencia:</strong> ' + escapeHtml(p.id) + '</div>' +
        popupRows.join('') +
        '<div><strong>Lat:</strong> ' + p.lat.toFixed(6) + '</div>' +
        '<div><strong>Lon:</strong> ' + p.lon.toFixed(6) + '</div>' +
      '</div>'
    );

    layer.addLayer(marker);
  }

  return layer;
}

export function removeIncidenceLayer(ctx) {
  if (ctx.state.incidences.layer && ctx.state.map.hasLayer(ctx.state.incidences.layer)) {
    ctx.state.map.removeLayer(ctx.state.incidences.layer);
  }
  ctx.state.incidences.layer = null;
}

export function toggleIncidenceLayer(ctx) {
  if (!ctx.state.incidences.layer) return;
  ctx.state.incidences.visible = !ctx.state.incidences.visible;
  if (ctx.state.incidences.visible) {
    ctx.state.incidences.layer.addTo(ctx.state.map);
    ctx.els.btnIncToggle.textContent = 'Ocultar';
  } else {
    ctx.state.map.removeLayer(ctx.state.incidences.layer);
    ctx.els.btnIncToggle.textContent = 'Mostrar';
  }
}

export function toggleIncidenceCluster(ctx) {
  if (!ctx.state.incidences.points.length) return;
  ctx.state.incidences.clustered = !ctx.state.incidences.clustered;
  const wasVisible = ctx.state.incidences.visible;
  removeIncidenceLayer(ctx);
  ctx.state.incidences.layer = buildIncidenceLayer(ctx);
  if (wasVisible && ctx.state.incidences.layer) {
    ctx.state.incidences.layer.addTo(ctx.state.map);
  }
  ctx.els.btnIncCluster.textContent = ctx.state.incidences.clustered ? 'Cluster ON' : 'Cluster OFF';
}

export function clearIncidences(ctx) {
  removeIncidenceLayer(ctx);
  ctx.state.incidences.points = [];
  ctx.state.incidences.visible = true;
  ctx.state.incidences.fileName = null;
  ctx.els.btnIncToggle.disabled = true;
  ctx.els.btnIncCluster.disabled = true;
  ctx.els.btnIncClear.disabled = true;
  ctx.els.btnIncToggle.textContent = 'Ocultar';
  ctx.els.incMeta.textContent = 'Sin incidencias cargadas';
}
