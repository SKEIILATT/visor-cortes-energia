import { escapeHtml, formatMinute } from './utils.js';

export function openInfoPanel(ctx, featureId) {
  const feat = ctx.state.features[featureId];
  if (!feat) return;

  const props = feat.feature && feat.feature.properties ? feat.feature.properties : {};
  const slots = feat.meta.slots || [];

  ctx.els.info.hidden = false;
  ctx.els.infoTitle.textContent = feat.meta.groupKey || 'Detalle';

  const rows = Object.keys(props)
    .slice(0, 30)
    .map(function (k) {
      const value = props[k] === null || props[k] === undefined ? '-' : String(props[k]);
      return '<div class="info-row"><span class="info-k">' + escapeHtml(k) + '</span><span class="info-v">' + escapeHtml(value) + '</span></div>';
    })
    .join('');

  const slotHtml = slots.length
    ? slots.map(function (s) {
        return '<span class="slot-chip">' + escapeHtml(formatMinute(s[0]) + ' - ' + formatMinute(s[1])) + '</span>';
      }).join('')
    : '<span class="muted">Sin franjas horarias</span>';

  const csvBlock = buildInfoCsvBlock(ctx, featureId);

  const html =
    '<div class="info-grid">' +
      '<div class="info-row"><span class="info-k">Grupo</span><span class="info-v">' + escapeHtml(feat.meta.groupKey) + '</span></div>' +
      '<div class="info-row"><span class="info-k">Geometría</span><span class="info-v">' + escapeHtml(feat.meta.geometryType) + '</span></div>' +
      '<div class="info-row"><span class="info-k">Horas estimadas</span><span class="info-v">' + (feat.meta.totalOutageMin / 60).toFixed(1) + 'h</span></div>' +
    '</div>' +
    '<div class="info-block"><div class="panel-title">Cortes</div><div class="slot-list">' + slotHtml + '</div></div>' +
    csvBlock +
    '<div class="info-block"><div class="panel-title">Propiedades</div><div class="info-grid">' + rows + '</div></div>';

  ctx.els.infoContent.innerHTML = html;
}

export function closeInfoPanel(ctx) {
  ctx.els.info.hidden = true;
}

export function buildInfoCsvBlock(ctx, featureId) {
  if (!ctx.state.csvPaint.loaded || !ctx.state.csvPaint.rows.has(featureId)) return '';
  const row = ctx.state.csvPaint.rows.get(featureId);
  const cols = ctx.state.csvPaint.columns;
  if (!cols.length) return '';

  const dataRows = cols.map(function (c) {
    const val = row[c.name];
    const display = (val !== null && val !== undefined && val !== '') ? Number(val).toFixed(2) : '-';
    const isActive = c.name === ctx.state.csvPaint.activeColumn;
    return '<div class="info-row' + (isActive ? ' info-row-active' : '') + '">' +
      '<span class="info-k">' + escapeHtml(c.label) + '</span>' +
      '<span class="info-v">' + escapeHtml(display) + '</span>' +
    '</div>';
  }).join('');

  return '<div class="info-block"><div class="panel-title">Datos CSV</div><div class="info-grid">' + dataRows + '</div></div>';
}
