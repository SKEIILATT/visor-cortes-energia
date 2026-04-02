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

export function openInfoPanel(ctx, featureId) {
  const feat = ctx.state.features[featureId];
  if (!feat) return;

  if (feat.layer && typeof feat.layer.closeTooltip === 'function') feat.layer.closeTooltip();
  ctx.state.selectedFeatureId = featureId;
  ctx._hooks.refreshFeatureStyles(ctx);

  const props = feat.feature && feat.feature.properties ? feat.feature.properties : {};
  const slots = feat.meta.slots || [];
  const metrics = computeFeatureMetrics(feat.feature);
  const highlights = pickHighlightProperties(props, ctx.state.analysis.groupBy);

  ctx.els.info.hidden = false;
  ctx.els.infoTitle.textContent = getFeatureDisplayName(ctx, feat) || 'Detalle';

  const propertyRows = Object.keys(props)
    .slice(0, 30)
    .map(function (key) {
      const value = props[key] === null || props[key] === undefined ? '-' : String(props[key]);
      return rowMetric(key, value);
    })
    .join('');

  const slotHtml = slots.length
    ? slots.map(function (slot) {
        return '<span class="slot-chip">' + escapeHtml(formatMinute(slot[0]) + ' - ' + formatMinute(slot[1])) + '</span>';
      }).join('')
    : '<span class="muted">Sin franjas horarias</span>';

  const csvBlock = buildInfoCsvBlock(ctx, featureId);
  const highlightHtml = highlights.length
    ? '<div class="info-kpis">' + highlights.map(function (item) {
        return '<div class="info-kpi"><span class="info-kpi-label">' + escapeHtml(item.key) + '</span><strong>' + escapeHtml(item.value) + '</strong></div>';
      }).join('') + '</div>'
    : '';

  const overviewRows = [
    rowMetric('Grupo', feat.meta.groupKey),
    rowMetric('Geometría', metrics.geometryType),
    rowMetric('Horas estimadas', (feat.meta.totalOutageMin / 60).toFixed(1) + ' h'),
    rowMetric('Franjas', String(feat.meta.slotCount || 0)),
    rowMetric('Vértices', String(metrics.vertexCount || 0)),
    rowMetric('Área', Number.isFinite(metrics.areaHa) ? metrics.areaHa.toFixed(2) + ' ha' : '-'),
    rowMetric('Perímetro', Number.isFinite(metrics.perimeterKm) ? metrics.perimeterKm.toFixed(2) + ' km' : '-'),
    rowMetric('Longitud', Number.isFinite(metrics.lengthKm) ? metrics.lengthKm.toFixed(2) + ' km' : '-'),
    rowMetric('Centroide', Number.isFinite(metrics.centroidLat) ? metrics.centroidLat.toFixed(5) + ', ' + metrics.centroidLng.toFixed(5) : '-'),
    rowMetric('bbox.xmin', Number.isFinite(metrics.bboxXMin) ? metrics.bboxXMin.toFixed(6) : '-'),
    rowMetric('bbox.ymin', Number.isFinite(metrics.bboxYMin) ? metrics.bboxYMin.toFixed(6) : '-'),
    rowMetric('bbox.xmax', Number.isFinite(metrics.bboxXMax) ? metrics.bboxXMax.toFixed(6) : '-'),
    rowMetric('bbox.ymax', Number.isFinite(metrics.bboxYMax) ? metrics.bboxYMax.toFixed(6) : '-'),
  ].join('');

  ctx.els.infoContent.innerHTML =
    '<div class="info-actions">' +
      '<button class="btn-mini" type="button" data-info-action="zoom">Zoom</button>' +
      '<button class="btn-mini" type="button" data-info-action="export-row">Exportar fila</button>' +
      '<button class="btn-mini" type="button" data-info-action="toggle-group">Aislar grupo</button>' +
    '</div>' +
    highlightHtml +
    '<div class="info-grid">' + overviewRows + '</div>' +
    '<div class="info-block"><div class="panel-title">Cortes</div><div class="slot-list">' + slotHtml + '</div></div>' +
    csvBlock +
    '<div class="info-block"><div class="panel-title">Propiedades</div><div class="info-grid">' + propertyRows + '</div></div>';

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
    const display = col.value !== null && col.value !== undefined && col.value !== '' ? String(col.value) : '-';
    return '<div class="info-row' + (col.isActive ? ' info-row-active' : '') + '">' +
      '<span class="info-k">' + escapeHtml(col.label) + '</span>' +
      '<span class="info-v">' + escapeHtml(display) + '</span>' +
    '</div>';
  }).join('');

  return '<div class="info-block"><div class="panel-title">Datos CSV</div><div class="info-grid">' + dataRows + '</div></div>';
}

function bindInfoActions(ctx, featureId) {
  const actionEls = ctx.els.infoContent.querySelectorAll('[data-info-action]');
  for (let i = 0; i < actionEls.length; i += 1) {
    actionEls[i].addEventListener('click', function () {
      const action = this.getAttribute('data-info-action');
      if (action === 'zoom') {
        zoomToFeature(ctx, featureId);
        return;
      }
      if (action === 'export-row') {
        exportSingleRow(ctx, featureId);
        return;
      }
      if (action === 'toggle-group') {
        isolateGroup(ctx, featureId);
      }
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

function rowMetric(label, value) {
  return '<div class="info-row"><span class="info-k">' + escapeHtml(label) + '</span><span class="info-v">' + escapeHtml(value) + '</span></div>';
}
