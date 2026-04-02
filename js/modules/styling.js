import { toNumber } from './utils.js';

export function isMetaActiveAt(meta, minute) {
  const slots = meta.slots || [];
  for (let i = 0; i < slots.length; i += 1) {
    const start = slots[i][0];
    const end = slots[i][1];
    if (end > start) {
      if (minute >= start && minute < end) return true;
    } else if (minute >= start || minute < end) {
      return true;
    }
  }
  return false;
}

export function getColorForMeta(ctx, meta) {
  if (ctx.state.colorMode === 'variable') {
    if (ctx.state.csvPaint.loaded && ctx.state.csvPaint.activeColumn) return getCsvPaintColor(ctx, meta);
    return '#c8ced7';
  }
  if (ctx.state.colorMode === 'outage') {
    if (!meta.hasOutage) return '#a8b0bc';
    return outageHeatColor(meta.totalOutageMin);
  }
  const group = ctx.state.groups.get(meta.groupKey);
  return group ? group.color : '#3b82f6';
}

function getCsvPaintColor(ctx, meta) {
  const col = ctx.state.csvPaint.activeColumn;
  const colInfo = findCsvColumn(ctx, col);
  if (!colInfo) return '#a8b0bc';
  const row = ctx.state.csvPaint.rows.get(meta.id);
  if (!row || row[col] === undefined || row[col] === null || String(row[col]).trim() === '') return '#c8ced7';
  const val = toNumber(row[col]);
  if (!Number.isFinite(val)) return '#c8ced7';
  const lo = ctx.state.csvPaint.manualMin !== null ? ctx.state.csvPaint.manualMin : colInfo.min;
  const hi = ctx.state.csvPaint.manualMax !== null ? ctx.state.csvPaint.manualMax : colInfo.max;
  const range = hi - lo;
  const ratio = range > 0 ? (val - lo) / range : 0.5;
  return csvHeatColor(Math.max(0, Math.min(1, ratio)), ctx.state.csvPaint.palette);
}

export function findCsvColumn(ctx, name) {
  for (let i = 0; i < ctx.state.csvPaint.columns.length; i += 1) {
    if (ctx.state.csvPaint.columns[i].name === name) return ctx.state.csvPaint.columns[i];
  }
  return null;
}

export function outageHeatColor(totalMin) {
  const ratio = Math.max(0, Math.min(1, totalMin / 600));
  if (ratio < 0.5) {
    const t = ratio * 2;
    const r = Math.round(69 + (223 - 69) * t);
    const g = Math.round(123 + (173 - 123) * t);
    const b = Math.round(157 + (88 - 157) * t);
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }
  const t = (ratio - 0.5) * 2;
  const r = Math.round(223 + (178 - 223) * t);
  const g = Math.round(173 + (34 - 173) * t);
  const b = Math.round(88 + (34 - 88) * t);
  return 'rgb(' + r + ',' + g + ',' + b + ')';
}

export const CSV_PALETTES = {
  heat:    { label: 'Gradiente', stops: [[16,64,132],[34,94,168],[42,157,143],[233,196,106],[244,162,97],[214,40,40]] },
  cividis: { label: 'Cividis',   stops: [[0,34,77],[43,68,117],[87,107,128],[140,148,112],[192,183,78],[255,233,69]] },
  frio:    { label: 'Azules',    stops: [[232,241,255],[177,211,255],[106,162,255],[54,102,201],[33,63,138],[15,27,78]] },
  magma:   { label: 'Magma',     stops: [[15,7,35],[75,18,93],[145,34,114],[211,79,98],[251,173,80],[252,253,191]] },
};

export function csvHeatColor(ratio, palette) {
  const key = palette && CSV_PALETTES[palette] ? palette : 'heat';
  const stops = CSV_PALETTES[key].stops;
  const n = stops.length - 1;
  const t = Math.max(0, Math.min(1, ratio)) * n;
  const lo = Math.floor(t);
  const hi = Math.min(lo + 1, n);
  const f = t - lo;
  const r = Math.round(stops[lo][0] + (stops[hi][0] - stops[lo][0]) * f);
  const g = Math.round(stops[lo][1] + (stops[hi][1] - stops[lo][1]) * f);
  const b = Math.round(stops[lo][2] + (stops[hi][2] - stops[lo][2]) * f);
  return 'rgb(' + r + ',' + g + ',' + b + ')';
}

export function getPathStyle(ctx, meta, hover, selected) {
  const isLine = /LineString/i.test(meta.geometryType || '');
  const activeNow = ctx.state.minute >= 0 && isMetaActiveAt(meta, ctx.state.minute);

  let color = getColorForMeta(ctx, meta);
  let fill = color;
  let weight = isLine ? 3 : 1.15;
  let fillOpacity = isLine ? 0 : 0.45;
  let opacity = 0.94;

  if (ctx.state.colorMode === 'outage' && ctx.state.minute >= 0 && ctx.state.analysis.outageAvailable) {
    if (activeNow) {
      color = '#b22222';
      fill = '#d94841';
      weight = isLine ? 4 : 2.2;
      fillOpacity = isLine ? 0 : 0.7;
    } else if (meta.hasOutage) {
      color = '#8f9aa8';
      fill = '#9aa6b2';
      weight = isLine ? 2 : 1;
      fillOpacity = isLine ? 0 : 0.12;
      opacity = 0.52;
    }
  }

  if (hover) {
    weight += 1;
    fillOpacity = Math.min(0.82, fillOpacity + 0.14);
  }

  if (selected) {
    color = '#0f172a';
    fill = color;
    weight += 2;
    fillOpacity = Math.min(0.88, fillOpacity + 0.14);
    opacity = 1;
  }

  return { color: color, weight: weight, opacity: opacity, fillColor: fill, fillOpacity: fillOpacity };
}

export function getPointStyle(ctx, meta, hover, selected) {
  const activeNow = ctx.state.minute >= 0 && isMetaActiveAt(meta, ctx.state.minute);
  let color = getColorForMeta(ctx, meta);
  let fill = color;
  let radius = hover ? 7 : 5;
  let fillOpacity = 0.82;

  if (ctx.state.colorMode === 'outage' && ctx.state.minute >= 0 && ctx.state.analysis.outageAvailable) {
    if (activeNow) {
      color = '#b22222';
      fill = '#d94841';
      radius = hover ? 8 : 6;
    } else if (meta.hasOutage) {
      color = '#8f9aa8';
      fill = '#8f9aa8';
      fillOpacity = 0.35;
    }
  }

  if (selected) {
    color = '#0f172a';
    fill = '#0f172a';
    radius += 2;
    fillOpacity = 1;
  }

  return { color: color, fillColor: fill, weight: 1, radius: radius, fillOpacity: fillOpacity, opacity: 0.96 };
}

export function applyStyleToFeature(ctx, feat) {
  if (!feat || !feat.layer || typeof feat.layer.eachLayer !== 'function') return;
  const pathStyle = getPathStyle(ctx, feat.meta, feat.hovered, feat.selected);
  const pointStyle = getPointStyle(ctx, feat.meta, feat.hovered, feat.selected);

  feat.layer.eachLayer(function (sub) {
    if (sub instanceof L.CircleMarker) {
      sub.setStyle(pointStyle);
      if (typeof sub.setRadius === 'function') sub.setRadius(pointStyle.radius);
      return;
    }
    if (sub && typeof sub.setStyle === 'function') sub.setStyle(pathStyle);
  });
}
