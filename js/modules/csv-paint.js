import { escapeHtml, normalizeHeader, readFileAsText, readFileAsArrayBuffer, toNumber } from './utils.js';
import { csvHeatColor, findCsvColumn } from './styling.js';

export async function loadCsvPolygonData(ctx, file) {
  const ext = file.name.split('.').pop().toLowerCase();
  let rawRows;

  if (ext === 'csv') {
    const text = await readFileAsText(file);
    const parsed = Papa.parse(text, { header: true, skipEmptyLines: true, dynamicTyping: true });
    if (parsed.errors && parsed.errors.length) throw new Error('CSV con formato inválido.');
    rawRows = parsed.data;
  } else if (ext === 'xlsx' || ext === 'xls') {
    const buffer = await readFileAsArrayBuffer(file);
    const wb = XLSX.read(buffer, { type: 'array' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    rawRows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  } else {
    throw new Error('Formato no soportado. Usa CSV o Excel.');
  }

  if (!rawRows || !rawRows.length) throw new Error('No hay filas con datos.');

  const headers = Object.keys(rawRows[0]);
  const csvIdField = detectCsvIdField(headers);
  if (!csvIdField) throw new Error('No se detectó columna de ID de polígono. Incluye una columna llamada "id", "codigo", "ID_POLIGONO", etc.');

  const geoIdResult = detectGeoIdField(ctx, rawRows, csvIdField);
  if (!geoIdResult) throw new Error('No se encontró propiedad en el GeoJSON que coincida con los IDs del CSV. Verifica que los IDs coincidan.');
  const geoIdField = geoIdResult.field;
  const useNorm = geoIdResult.useNorm;

  const geoLookup = new Map();
  for (let i = 0; i < ctx.state.features.length; i += 1) {
    const props = ctx.state.features[i].feature.properties || {};
    let val = String(props[geoIdField] || '').trim();
    if (useNorm) val = normalizeGeoId(val);
    if (val) geoLookup.set(val, i);
  }

  const rows = new Map();
  for (let i = 0; i < rawRows.length; i += 1) {
    let csvId = String(rawRows[i][csvIdField] || '').trim();
    if (useNorm) csvId = normalizeGeoId(csvId);
    const featureIdx = geoLookup.get(csvId);
    if (featureIdx !== undefined) rows.set(featureIdx, rawRows[i]);
  }

  if (!rows.size) throw new Error('No se enlazó ningún polígono. Verifica que los IDs del CSV coincidan con la propiedad "' + geoIdField + '" del GeoJSON.');

  const numericCols = detectNumericColumns(rawRows, headers, csvIdField);

  ctx.state.csvPaint.loaded = true;
  ctx.state.csvPaint.rows = rows;
  ctx.state.csvPaint.columns = numericCols;
  ctx.state.csvPaint.fileName = file.name;
  ctx.state.csvPaint.activeColumn = numericCols.length ? numericCols[0].name : null;

  renderCsvSidebar(ctx);
  renderCsvPanel(ctx);
  if (ctx.state.csvPaint.activeColumn) {
    ctx._hooks.refreshFeatureStyles(ctx);
  }
}

export function detectCsvIdField(headers) {
  const candidates = ['id_poligono', 'idpoligono', 'poligonoid', 'polygon_id', 'polygonid', 'id_polygon',
    'alimentador', 'codigo', 'code', 'id', 'objectid', 'fid', 'gid', 'feature_id',
    'subgrupo', 'grupo', 'zone', 'zona'];
  const norm = headers.map(function (h) { return { raw: h, norm: normalizeHeader(h) }; });

  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = 0; j < norm.length; j += 1) {
      if (norm[j].norm === candidates[i]) return norm[j].raw;
    }
  }

  return headers[0] || null;
}

export function normalizeGeoId(str) {
  return str.replace(/^[^\d]+/, '').trim();
}

export function detectGeoIdField(ctx, csvRows, csvIdField) {
  if (!ctx.state.features.length) return null;

  const csvIds = new Set();
  for (let i = 0; i < Math.min(csvRows.length, 200); i += 1) {
    const v = String(csvRows[i][csvIdField] || '').trim();
    if (v) csvIds.add(v);
  }

  if (!csvIds.size) return null;

  const sampleFeat = ctx.state.features[0].feature;
  const propKeys = Object.keys(sampleFeat.properties || {});
  const sampleSize = Math.min(ctx.state.features.length, 200);

  let bestField = null;
  let bestScore = 0;
  for (let k = 0; k < propKeys.length; k += 1) {
    const prop = propKeys[k];
    let hits = 0;
    for (let i = 0; i < sampleSize; i += 1) {
      const val = String((ctx.state.features[i].feature.properties || {})[prop] || '').trim();
      if (csvIds.has(val)) hits += 1;
    }
    const score = hits / sampleSize;
    if (score > bestScore) { bestScore = score; bestField = prop; }
  }
  if (bestScore > 0.1) return { field: bestField, useNorm: false };

  const normCsvIds = new Set();
  csvIds.forEach(function (id) { normCsvIds.add(normalizeGeoId(id)); });

  bestField = null;
  bestScore = 0;
  for (let k = 0; k < propKeys.length; k += 1) {
    const prop = propKeys[k];
    let hits = 0;
    for (let i = 0; i < sampleSize; i += 1) {
      const val = normalizeGeoId(String((ctx.state.features[i].feature.properties || {})[prop] || '').trim());
      if (normCsvIds.has(val)) hits += 1;
    }
    const score = hits / sampleSize;
    if (score > bestScore) { bestScore = score; bestField = prop; }
  }
  return bestScore > 0.1 ? { field: bestField, useNorm: true } : null;
}

export function detectNumericColumns(rows, headers, idField) {
  const cols = [];
  const normId = normalizeHeader(idField);

  for (let h = 0; h < headers.length; h += 1) {
    const header = headers[h];
    if (normalizeHeader(header) === normId) continue;

    let numericCount = 0;
    const sample = Math.min(rows.length, 50);
    for (let i = 0; i < sample; i += 1) {
      const v = rows[i][header];
      if (v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v))) {
        numericCount += 1;
      }
    }
    if (numericCount < sample * 0.5) continue;

    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < rows.length; i += 1) {
      const v = toNumber(rows[i][header]);
      if (Number.isFinite(v)) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    if (!Number.isFinite(min)) continue;

    cols.push({ name: header, label: buildColLabel(header), min: min, max: max });
  }

  return cols;
}

export function buildColLabel(colName) {
  const norm = normalizeHeader(colName);
  if (norm.includes('dia') || norm.includes('day')) return 'Días';
  if (norm.includes('hora') || norm.includes('hour')) return 'Horas';
  if (norm.includes('solap') || norm.includes('overlap')) return 'Solapamiento';
  if (norm.includes('count') || norm.includes('conteo')) return 'Conteo';
  if (norm.includes('area')) return 'Área';
  return colName;
}

export function renderCsvSidebar(ctx) {
  ctx.els.csvMeta.textContent = ctx.state.csvPaint.fileName + ' · ' + ctx.state.csvPaint.rows.size + ' polígonos enlazados';
  ctx.els.btnCsvClear.disabled = false;

  if (!ctx.state.csvPaint.columns.length) {
    ctx.els.csvColumns.hidden = true;
    return;
  }

  const html = [];
  for (let i = 0; i < ctx.state.csvPaint.columns.length; i += 1) {
    const col = ctx.state.csvPaint.columns[i];
    const active = col.name === ctx.state.csvPaint.activeColumn;
    html.push(
      '<button class="btn-mini ' + (active ? 'btn-mini-primary' : '') + ' csv-col-btn" ' +
      'type="button" data-col="' + escapeHtml(col.name) + '" title="' + escapeHtml(col.name) + '">' +
      escapeHtml(col.label) + '</button>'
    );
  }

  ctx.els.csvColumns.innerHTML = html.join('');
  ctx.els.csvColumns.hidden = false;

  const btns = ctx.els.csvColumns.querySelectorAll('.csv-col-btn');
  for (let i = 0; i < btns.length; i += 1) {
    btns[i].addEventListener('click', function () {
      const colName = this.getAttribute('data-col');
      setCsvPaintColumn(ctx, colName);
    });
  }
}

export function setCsvPaintColumn(ctx, colName) {
  ctx.state.csvPaint.activeColumn = colName;
  renderCsvSidebar(ctx);
  renderCsvPanel(ctx);
  ctx._hooks.refreshFeatureStyles(ctx);
}

export function renderCsvPanel(ctx) {
  if (!ctx.state.csvPaint.loaded) {
    ctx.els.csvPanel.hidden = true;
    return;
  }

  const col = ctx.state.csvPaint.activeColumn;
  const colInfo = col ? findCsvColumn(ctx, col) : null;

  ctx.els.csvPanel.hidden = false;
  ctx.els.csvPanelTitle.textContent = 'CSV: ' + (colInfo ? colInfo.label : 'sin columna');
  ctx.els.csvPanelSub.textContent = colInfo ? (colInfo.min.toFixed(1) + ' – ' + colInfo.max.toFixed(1)) : '';

  if (colInfo) {
    const stops = 6;
    const swatches = [];
    for (let i = 0; i < stops; i += 1) {
      const r = i / (stops - 1);
      swatches.push('<span class="csv-swatch" style="background:' + csvHeatColor(r) + '"></span>');
    }
    ctx.els.csvLegend.innerHTML =
      '<div class="csv-legend-bar">' + swatches.join('') + '</div>' +
      '<div class="csv-legend-labels">' +
        '<span>' + colInfo.min.toFixed(1) + '</span>' +
        '<span>' + ((colInfo.min + colInfo.max) / 2).toFixed(1) + '</span>' +
        '<span>' + colInfo.max.toFixed(1) + '</span>' +
      '</div>';
  } else {
    ctx.els.csvLegend.innerHTML = '';
  }

  if (!colInfo) {
    ctx.els.csvRank.innerHTML = '<p class="muted">Selecciona una columna para ver el ranking.</p>';
    return;
  }

  const ranked = [];
  ctx.state.csvPaint.rows.forEach(function (row, featureIdx) {
    const feat = ctx.state.features[featureIdx];
    if (!feat) return;
    const val = toNumber(row[col]);
    if (!Number.isFinite(val)) return;
    ranked.push({ featureIdx: featureIdx, val: val, key: feat.meta.groupKey });
  });

  ranked.sort(function (a, b) { return b.val - a.val; });
  const top = ranked.slice(0, 8);
  const maxVal = top.length ? top[0].val : 1;

  if (!top.length) {
    ctx.els.csvRank.innerHTML = '<p class="muted">Sin datos numéricos para esta columna.</p>';
    return;
  }

  const parts = [];
  for (let i = 0; i < top.length; i += 1) {
    const item = top[i];
    const pct = Math.max(8, Math.round((item.val / maxVal) * 100));
    const barColor = csvHeatColor(colInfo.max > colInfo.min ? (item.val - colInfo.min) / (colInfo.max - colInfo.min) : 0.5);
    parts.push(
      '<div class="rank-item" data-fidx="' + item.featureIdx + '">' +
        '<div class="rank-name">' + (i + 1) + '. ' + escapeHtml(item.key) + '</div>' +
        '<div class="rank-bar-wrap"><div class="rank-bar" style="width:' + pct + '%;background:' + barColor + '"></div></div>' +
        '<div class="rank-sub">' + item.val.toFixed(1) + ' ' + escapeHtml(colInfo.label) + '</div>' +
      '</div>'
    );
  }

  ctx.els.csvRank.innerHTML = parts.join('');

  const items = ctx.els.csvRank.querySelectorAll('.rank-item');
  for (let i = 0; i < items.length; i += 1) {
    items[i].addEventListener('click', function () {
      const fidx = Number(this.getAttribute('data-fidx'));
      if (Number.isFinite(fidx)) ctx._hooks.openInfoPanel(ctx, fidx);
    });
  }
}

export function clearCsvPaint(ctx) {
  ctx.state.csvPaint.loaded = false;
  ctx.state.csvPaint.rows = new Map();
  ctx.state.csvPaint.columns = [];
  ctx.state.csvPaint.activeColumn = null;
  ctx.state.csvPaint.fileName = null;

  ctx.els.csvMeta.textContent = 'Sin datos cargados';
  ctx.els.btnCsvClear.disabled = true;
  ctx.els.csvColumns.hidden = true;
  ctx.els.csvColumns.innerHTML = '';
  ctx.els.csvPanel.hidden = true;

  ctx._hooks.refreshFeatureStyles(ctx);
  ctx.els.statusPill.textContent = 'Datos CSV eliminados.';
  ctx.els.statusPill.classList.remove('ok', 'warn', 'err');
  ctx.els.statusPill.classList.add('ok');
}
