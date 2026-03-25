import { toNumber } from './utils.js';

export function isMetaActiveAt(meta, minute) {
  const slots = meta.slots || [];
  for (let i = 0; i < slots.length; i += 1) {
    const start = slots[i][0];
    const end = slots[i][1];
    if (end > start) {
      if (minute >= start && minute < end) return true;
    } else {
      if (minute >= start || minute < end) return true;
    }
  }
  return false;
}

export function getColorForMeta(ctx, meta) {
  if (ctx.state.csvPaint.loaded && ctx.state.csvPaint.activeColumn) {
    return getCsvPaintColor(ctx, meta);
  }
  if (ctx.state.mode === 'outage' && ctx.state.analysis.outageAvailable) {
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
  if (!row || row[col] === undefined || row[col] === null || String(row[col]).trim() === '') {
    return '#c8ced7';
  }
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
    const r = Math.round(58 + (245 - 58) * t);
    const g = Math.round(175 + (158 - 175) * t);
    const b = Math.round(129 + (11 - 129) * t);
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }
  const t = (ratio - 0.5) * 2;
  const r = Math.round(245 + (192 - 245) * t);
  const g = Math.round(158 + (57 - 158) * t);
  const b = Math.round(11 + (43 - 11) * t);
  return 'rgb(' + r + ',' + g + ',' + b + ')';
}

export const CSV_PALETTES = {
  heat:     { label: 'Calor',    stops: [[41,98,255],[0,200,200],[16,185,129],[245,200,11],[249,115,22],[192,38,61]] },
  semaforo: { label: 'Semáforo', stops: [[34,197,94],[132,204,22],[250,204,21],[251,146,60],[239,68,68],[185,28,28]] },
  frio:     { label: 'Frío',     stops: [[220,235,255],[147,197,253],[59,130,246],[29,78,216],[30,27,153],[15,10,90]] },
  magma:    { label: 'Magma',    stops: [[10,10,10],[70,10,100],[160,30,100],[250,120,60],[255,200,100],[255,255,180]] },
};

export function csvHeatColor(ratio, palette) {
  const key = (palette && CSV_PALETTES[palette]) ? palette : 'heat';
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

export function getPathStyle(ctx, meta, hover) {
  const isLine = /LineString/i.test(meta.geometryType || '');
  const activeNow = ctx.state.minute >= 0 && isMetaActiveAt(meta, ctx.state.minute);

  let color = getColorForMeta(ctx, meta);
  let fill = color;
  let weight = isLine ? 3 : 1.2;
  let fillOpacity = isLine ? 0 : 0.42;
  let opacity = 0.95;

  if (ctx.state.minute >= 0 && ctx.state.analysis.outageAvailable) {
    if (activeNow) {
      color = '#c0392b';
      fill = '#c0392b';
      weight = isLine ? 4 : 2;
      fillOpacity = isLine ? 0 : 0.62;
    } else if (meta.hasOutage) {
      color = '#8f9aa8';
      fill = '#8f9aa8';
      weight = isLine ? 2 : 1;
      fillOpacity = isLine ? 0 : 0.1;
      opacity = 0.6;
    }
  }

  if (hover) {
    weight += 1;
    fillOpacity = Math.min(0.8, fillOpacity + 0.15);
  }

  return { color: color, weight: weight, opacity: opacity, fillColor: fill, fillOpacity: fillOpacity };
}

export function getPointStyle(ctx, meta, hover) {
  const activeNow = ctx.state.minute >= 0 && isMetaActiveAt(meta, ctx.state.minute);
  let color = getColorForMeta(ctx, meta);
  let fill = color;
  let radius = hover ? 7 : 5;
  let fillOpacity = 0.8;

  if (ctx.state.minute >= 0 && ctx.state.analysis.outageAvailable) {
    if (activeNow) {
      color = '#c0392b';
      fill = '#c0392b';
      radius = hover ? 8 : 6;
    } else if (meta.hasOutage) {
      color = '#8f9aa8';
      fill = '#8f9aa8';
      fillOpacity = 0.35;
    }
  }

  return { color: color, fillColor: fill, weight: 1, radius: radius, fillOpacity: fillOpacity, opacity: 0.95 };
}

export function applyStyleToFeature(ctx, feat) {
  if (!feat || !feat.layer || typeof feat.layer.eachLayer !== 'function') return;
  const pathStyle = getPathStyle(ctx, feat.meta, feat.hovered);
  const pointStyle = getPointStyle(ctx, feat.meta, feat.hovered);

  feat.layer.eachLayer(function (sub) {
    if (sub instanceof L.CircleMarker) {
      sub.setStyle(pointStyle);
      if (typeof sub.setRadius === 'function') sub.setRadius(pointStyle.radius);
      return;
    }
    if (sub && typeof sub.setStyle === 'function') sub.setStyle(pathStyle);
  });
}
