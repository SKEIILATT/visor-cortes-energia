import { downloadText, escapeHtml, formatMinute } from './utils.js';
import {
  buildCsvTextFromRows,
  buildFeatureExportRow,
  computeFeatureMetrics,
  getCsvColumnSummary,
  getFeatureDisplayName,
  pickHighlightProperties,
} from './feature-insights.js';
import { fileBaseName } from './export.js';

/* ── Formateo ────────────────────────────────────────────────────────── */

function fmtNum(value, decimals) {
  if (!Number.isFinite(value)) return null;
  return value.toLocaleString('es', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

// ≥ 1 ha → "1.234,56 ha" | < 1 ha → "12.345 m²"
function fmtArea(ha) {
  if (!Number.isFinite(ha) || ha <= 0) return null;
  if (ha >= 100) return fmtNum(ha, 1) + ' ha';
  if (ha >= 1)   return fmtNum(ha, 2) + ' ha';
  return fmtNum(ha * 10000, 0) + ' m²';
}

// ≥ 1 km → "1,23 km" | < 1 km → "234 m"
function fmtDist(km) {
  if (!Number.isFinite(km) || km <= 0) return null;
  if (km >= 1) return fmtNum(km, 2) + ' km';
  return fmtNum(km * 1000, 0) + ' m';
}

// Coordenadas con punto cardinal
function fmtCoord(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const latStr = Math.abs(lat).toFixed(5) + '°\u00a0' + (lat >= 0 ? 'N' : 'S');
  const lngStr = Math.abs(lng).toFixed(5) + '°\u00a0' + (lng >= 0 ? 'E' : 'O');
  return latStr + ',\u2002' + lngStr;
}

// Extensión bbox en una sola línea compacta
function fmtBbox(xmin, ymin, xmax, ymax) {
  if (!Number.isFinite(xmin)) return null;
  return xmin.toFixed(4) + '° – ' + xmax.toFixed(4) + '° lon\u2002·\u2002'
       + ymin.toFixed(4) + '° – ' + ymax.toFixed(4) + '° lat';
}

// Tipo de geometría en español
function geoTypeLabel(type) {
  const map = {
    Polygon: 'Polígono', MultiPolygon: 'Multipolígono',
    LineString: 'Línea', MultiLineString: 'Multilínea',
    Point: 'Punto', MultiPoint: 'Multipunto',
    GeometryCollection: 'Colección de geometrías',
  };
  return map[type] || type || 'Sin geometría';
}

// snake_case / camelCase / ALLCAPS → etiqueta legible
function keyLabel(key) {
  return String(key)
    .replace(/([a-z])([A-Z])/g, '$1 $2')   // camelCase
    .replace(/[_\-\.]+/g, ' ')              // separadores
    .replace(/\b\w/g, function (c) { return c.toUpperCase(); })
    .trim();
}

// Formatea cualquier valor de propiedad para mostrar
function fmtPropValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    if (Number.isInteger(value)) return value.toLocaleString('es');
    return parseFloat(value.toFixed(4)).toLocaleString('es', { maximumFractionDigits: 4 });
  }
  const str = String(value).trim();
  if (!str || str === 'null' || str === 'undefined' || str === 'NaN') return null;
  return str;
}

/* ── Constructores de HTML ────────────────────────────────────────────── */

function row(label, value) {
  if (value === null || value === undefined || value === '') return '';
  return '<div class="info-row">' +
    '<span class="info-k">' + escapeHtml(label) + '</span>' +
    '<span class="info-v">' + escapeHtml(String(value)) + '</span>' +
  '</div>';
}

function sectionHead(label) {
  return '<div class="info-block-head">' + escapeHtml(label) + '</div>';
}

/* ── Apertura del panel ───────────────────────────────────────────────── */

export function openInfoPanel(ctx, featureId) {
  const feat = ctx.state.features[featureId];
  if (!feat) return;

  if (feat.layer && typeof feat.layer.closeTooltip === 'function') feat.layer.closeTooltip();
  ctx.state.selectedFeatureId = featureId;
  ctx._hooks.refreshFeatureStyles(ctx);

  const props   = feat.feature && feat.feature.properties ? feat.feature.properties : {};
  const slots   = feat.meta.slots || [];
  const metrics = computeFeatureMetrics(feat.feature);
  const highlights = pickHighlightProperties(props, ctx.state.analysis.groupBy);

  ctx.els.info.hidden = false;
  ctx.els.infoTitle.textContent = getFeatureDisplayName(ctx, feat) || 'Detalle';

  /* ── KPIs destacados ── */
  const kpiHtml = highlights.length
    ? '<div class="info-kpis">' +
        highlights.map(function (item) {
          const formatted = fmtPropValue(item.value);
          if (!formatted) return '';
          return '<div class="info-kpi">' +
            '<span class="info-kpi-label">' + escapeHtml(keyLabel(item.key)) + '</span>' +
            '<strong>' + escapeHtml(formatted) + '</strong>' +
          '</div>';
        }).filter(Boolean).join('') +
      '</div>'
    : '';

  /* ── Métricas geoespaciales ── */
  const totalHours = feat.meta.totalOutageMin / 60;
  const geomRows = [
    row('Grupo',       feat.meta.groupKey || '—'),
    row('Geometría',   geoTypeLabel(metrics.geometryType)),
    row('Área',        fmtArea(metrics.areaHa)),
    row('Perímetro',   fmtDist(metrics.perimeterKm)),
    row('Longitud',    fmtDist(metrics.lengthKm)),
    row('Vértices',    metrics.vertexCount > 0 ? metrics.vertexCount.toLocaleString('es') : null),
    row('Centroide',   fmtCoord(metrics.centroidLat, metrics.centroidLng)),
    row('Extensión',   fmtBbox(metrics.bboxXMin, metrics.bboxYMin, metrics.bboxXMax, metrics.bboxYMax)),
  ].join('');

  /* ── Cortes ── */
  let outageHtml = '';
  if (feat.meta.slotCount > 0) {
    const slotChips = slots.map(function (slot) {
      return '<span class="slot-chip">' +
        escapeHtml(formatMinute(slot[0]) + '\u2009–\u2009' + formatMinute(slot[1])) +
      '</span>';
    }).join('');

    outageHtml =
      '<div class="info-block">' +
        sectionHead('Cortes') +
        '<div class="info-outage-summary">' +
          '<span class="info-outage-hours">' + fmtNum(totalHours, 1) + ' h</span>' +
          '<span class="info-outage-meta">' + feat.meta.slotCount +
            (feat.meta.slotCount === 1 ? ' evento' : ' eventos') +
          '</span>' +
        '</div>' +
        '<div class="slot-list">' + slotChips + '</div>' +
      '</div>';
  }

  /* ── Datos CSV vinculados ── */
  const csvBlock = buildInfoCsvBlock(ctx, featureId);

  /* ── Propiedades del feature ── */
  const propRows = Object.keys(props)
    .map(function (key) {
      const formatted = fmtPropValue(props[key]);
      if (formatted === null) return null;
      return row(keyLabel(key), formatted);
    })
    .filter(Boolean)
    .join('');

  const propsHtml = propRows
    ? '<div class="info-block">' + sectionHead('Propiedades') +
        '<div class="info-grid">' + propRows + '</div>' +
      '</div>'
    : '';

  ctx.els.infoContent.innerHTML =
    '<div class="info-actions">' +
      '<button class="btn-mini" type="button" data-info-action="zoom">Zoom</button>' +
      '<button class="btn-mini" type="button" data-info-action="export-row">Exportar fila</button>' +
      '<button class="btn-mini" type="button" data-info-action="toggle-group">Aislar grupo</button>' +
    '</div>' +
    kpiHtml +
    '<div class="info-block">' +
      sectionHead('Geometría') +
      '<div class="info-grid">' + geomRows + '</div>' +
    '</div>' +
    outageHtml +
    csvBlock +
    propsHtml;

  bindInfoActions(ctx, featureId);
}

export function closeInfoPanel(ctx) {
  ctx.els.info.hidden = true;
  ctx.state.selectedFeatureId = null;
  if (ctx._hooks && ctx._hooks.refreshFeatureStyles) ctx._hooks.refreshFeatureStyles(ctx);
}

export function buildInfoCsvBlock(ctx, featureId) {
  const cols = getCsvColumnSummary(ctx, featureId);
  if (!cols.length) return '';

  const dataRows = cols.map(function (col) {
    const formatted = fmtPropValue(col.value);
    const display = formatted !== null ? formatted : '—';
    return '<div class="info-row' + (col.isActive ? ' info-row-active' : '') + '">' +
      '<span class="info-k">' + escapeHtml(keyLabel(col.label)) + '</span>' +
      '<span class="info-v">' + escapeHtml(display) + '</span>' +
    '</div>';
  }).join('');

  return '<div class="info-block">' +
    sectionHead('Datos CSV') +
    '<div class="info-grid">' + dataRows + '</div>' +
  '</div>';
}

/* ── Acciones internas ────────────────────────────────────────────────── */

function bindInfoActions(ctx, featureId) {
  const actionEls = ctx.els.infoContent.querySelectorAll('[data-info-action]');
  for (let i = 0; i < actionEls.length; i += 1) {
    actionEls[i].addEventListener('click', function () {
      const action = this.getAttribute('data-info-action');
      if (action === 'zoom')         { zoomToFeature(ctx, featureId); return; }
      if (action === 'export-row')   { exportSingleRow(ctx, featureId); return; }
      if (action === 'toggle-group') { isolateGroup(ctx, featureId); }
    });
  }
}

function zoomToFeature(ctx, featureId) {
  const feat = ctx.state.features[featureId];
  if (!feat || !feat.layer || typeof feat.layer.getBounds !== 'function') return;
  const bounds = feat.layer.getBounds();
  if (bounds && bounds.isValid()) ctx.state.map.fitBounds(bounds.pad(0.25));
}

function exportSingleRow(ctx, featureId) {
  const feat = ctx.state.features[featureId];
  if (!feat) return;
  const csv = buildCsvTextFromRows([buildFeatureExportRow(ctx, feat)]);
  downloadText(fileBaseName(ctx) + '_feature_' + featureId + '.csv', csv, 'text/csv;charset=utf-8');
}

function isolateGroup(ctx, featureId) {
  const feat = ctx.state.features[featureId];
  if (!feat) return;
  ctx.state.groups.forEach(function (group) {
    group.visible = group.key === feat.meta.groupKey;
  });
  ctx._hooks.refreshAll(ctx);
}
