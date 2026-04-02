import { csvCell, normalizeHeader } from './utils.js';

const LABEL_PRIORITY = [
  'subgrupo', 'grupo', 'group', 'zona', 'zone', 'sector', 'alimentador',
  'layer', 'name', 'nombre', 'codigo', 'code', 'id', 'objectid', 'fid',
];

export function getFeatureDisplayName(ctx, feat) {
  const props = feat && feat.feature && feat.feature.properties ? feat.feature.properties : {};
  const groupField = ctx && ctx.state && ctx.state.analysis ? ctx.state.analysis.groupBy : null;
  if (groupField && props[groupField] !== undefined && props[groupField] !== null && String(props[groupField]).trim()) {
    return String(props[groupField]).trim();
  }

  const keys = Object.keys(props);
  for (let i = 0; i < LABEL_PRIORITY.length; i += 1) {
    for (let j = 0; j < keys.length; j += 1) {
      if (normalizeHeader(keys[j]) !== LABEL_PRIORITY[i]) continue;
      const value = props[keys[j]];
      if (value !== null && value !== undefined && String(value).trim()) return String(value).trim();
    }
  }

  return feat && feat.meta ? String(feat.meta.groupKey || 'Polígono') : 'Polígono';
}

export function computeFeatureMetrics(feature) {
  const geometry = feature && feature.geometry ? feature.geometry : null;
  const type = geometry && geometry.type ? geometry.type : 'Sin geometría';
  const metrics = {
    geometryType: type,
    areaHa: null,
    lengthKm: null,
    perimeterKm: null,
    centroidLat: null,
    centroidLng: null,
    bbox: null,
    bboxXMin: null,
    bboxYMin: null,
    bboxXMax: null,
    bboxYMax: null,
    vertexCount: countVertices(geometry),
  };

  if (!geometry || typeof turf === 'undefined') return metrics;

  try {
    const centroid = turf.centroid(feature);
    if (centroid && centroid.geometry && Array.isArray(centroid.geometry.coordinates)) {
      metrics.centroidLng = centroid.geometry.coordinates[0];
      metrics.centroidLat = centroid.geometry.coordinates[1];
    }
  } catch (_) {}

  try {
    const bbox = turf.bbox(feature);
    if (Array.isArray(bbox) && bbox.length === 4) {
      metrics.bbox = bbox;
      metrics.bboxXMin = bbox[0];
      metrics.bboxYMin = bbox[1];
      metrics.bboxXMax = bbox[2];
      metrics.bboxYMax = bbox[3];
    }
  } catch (_) {}

  try {
    if (/Polygon/i.test(type)) {
      metrics.areaHa = turf.area(feature) / 10000;
      metrics.perimeterKm = turf.length(turf.polygonToLine(feature), { units: 'kilometers' });
    } else if (/LineString/i.test(type)) {
      metrics.lengthKm = turf.length(feature, { units: 'kilometers' });
    }
  } catch (_) {}

  return metrics;
}

export function pickHighlightProperties(props, groupField) {
  const keys = Object.keys(props || {});
  const excluded = new Set(['corteshoras']);
  if (groupField) excluded.add(normalizeHeader(groupField));

  return keys
    .map(function (key) {
      const value = props[key];
      const text = value === null || value === undefined ? '' : String(value).trim();
      if (!text || excluded.has(normalizeHeader(key))) return null;
      let score = 0;
      if (/^(id|codigo|code|layer|alimentador|circuito|name|nombre|sector|zona|subgrupo|grupo)/.test(normalizeHeader(key))) score += 5;
      if (typeof value === 'number') score += 4;
      if (text.length <= 36) score += 2;
      if (text.length > 80) score -= 2;
      return { key: key, value: value, score: score };
    })
    .filter(Boolean)
    .sort(function (a, b) { return b.score - a.score; })
    .slice(0, 6);
}

export function buildFeatureExportRows(ctx, options) {
  const visibleOnly = !!(options && options.visibleOnly);
  const rows = [];
  for (let i = 0; i < ctx.state.features.length; i += 1) {
    const feat = ctx.state.features[i];
    if (!feat) continue;
    if (visibleOnly && !isFeatureVisible(ctx, feat)) continue;
    rows.push(buildFeatureExportRow(ctx, feat));
  }
  return rows;
}

export function buildFeatureExportRow(ctx, feat) {
  const props = feat.feature && feat.feature.properties ? feat.feature.properties : {};
  const metrics = computeFeatureMetrics(feat.feature);
  const row = {
    feature_index: feat.id,
    feature_name: getFeatureDisplayName(ctx, feat),
    group_key: feat.meta.groupKey || '',
    visible: isFeatureVisible(ctx, feat) ? 'si' : 'no',
    geometry_type: metrics.geometryType,
    outage_slot_count: feat.meta.slotCount || 0,
    outage_minutes: feat.meta.totalOutageMin || 0,
    outage_hours: roundMetric((feat.meta.totalOutageMin || 0) / 60, 2),
    outage_ranges: (feat.meta.slots || []).map(function (slot) {
      return formatMinutes(slot[0]) + ' - ' + formatMinutes(slot[1]);
    }).join(' | '),
    area_ha: roundMetric(metrics.areaHa, 3),
    length_km: roundMetric(metrics.lengthKm, 3),
    perimeter_km: roundMetric(metrics.perimeterKm, 3),
    vertex_count: metrics.vertexCount,
    centroid_lat: roundMetric(metrics.centroidLat, 6),
    centroid_lng: roundMetric(metrics.centroidLng, 6),
  };

  if (metrics.bbox) {
    row.bbox_west = roundMetric(metrics.bbox[0], 6);
    row.bbox_south = roundMetric(metrics.bbox[1], 6);
    row.bbox_east = roundMetric(metrics.bbox[2], 6);
    row.bbox_north = roundMetric(metrics.bbox[3], 6);
    row['bbox.xmin'] = roundMetric(metrics.bboxXMin, 6);
    row['bbox.ymin'] = roundMetric(metrics.bboxYMin, 6);
    row['bbox.xmax'] = roundMetric(metrics.bboxXMax, 6);
    row['bbox.ymax'] = roundMetric(metrics.bboxYMax, 6);
  }

  Object.keys(props).forEach(function (key) {
    row['prop_' + key] = props[key];
  });

  if (ctx.state.csvPaint.loaded && ctx.state.csvPaint.rows.has(feat.id)) {
    const csvRow = ctx.state.csvPaint.rows.get(feat.id);
    Object.keys(csvRow).forEach(function (key) {
      row['csv_' + key] = csvRow[key];
    });
  }

  return row;
}

export function buildCsvTextFromRows(rows) {
  if (!rows.length) return '';
  const headers = Array.from(rows.reduce(function (set, row) {
    Object.keys(row).forEach(function (key) { set.add(key); });
    return set;
  }, new Set()));

  const lines = [headers.map(csvCell).join(',')];
  for (let i = 0; i < rows.length; i += 1) {
    lines.push(headers.map(function (header) { return csvCell(rows[i][header]); }).join(','));
  }
  return lines.join('\n');
}

export function getCsvColumnSummary(ctx, featureId) {
  if (!ctx.state.csvPaint.loaded || !ctx.state.csvPaint.rows.has(featureId)) return [];
  const row = ctx.state.csvPaint.rows.get(featureId);
  return ctx.state.csvPaint.columns.map(function (col) {
    return {
      name: col.name,
      label: col.label,
      value: row[col.name],
      isActive: col.name === ctx.state.csvPaint.activeColumn,
    };
  });
}

function countVertices(geometry) {
  if (!geometry || !geometry.coordinates) return 0;
  return countCoordinateNodes(geometry.coordinates);
}

function countCoordinateNodes(coords) {
  if (!Array.isArray(coords)) return 0;
  if (coords.length && typeof coords[0] === 'number') return 1;
  let total = 0;
  for (let i = 0; i < coords.length; i += 1) total += countCoordinateNodes(coords[i]);
  return total;
}

function roundMetric(value, decimals) {
  return Number.isFinite(value) ? Number(value.toFixed(decimals)) : '';
}

function isFeatureVisible(ctx, feat) {
  const group = ctx.state.groups.get(feat.meta.groupKey);
  return !!(group && group.visible && feat.matchesFilter);
}

function formatMinutes(minute) {
  let m = minute;
  if (m >= 1440) m = 0;
  const hh = String(Math.floor(m / 60)).padStart(2, '0');
  const mm = String(m % 60).padStart(2, '0');
  return hh + ':' + mm;
}
