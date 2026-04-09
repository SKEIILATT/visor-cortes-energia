import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const BASE_URL = 'https://geoportal.eeq.com.ec/arcgis/rest/services/WEBGIS/WebgisElectrico/MapServer';
const LAYER_IDS = [15, 16];
const OUT_DIR = path.resolve('data');
const FEEDER_OUT = path.join(OUT_DIR, 'zonas_interrupcion_quito.geojson');
const SUBSTATION_OUT = path.join(OUT_DIR, 'GeoUIO_reconstruido.geojson');
const CHUNK_SIZE = 1000;
const POINT_PRECISION = 5;
const REQUEST_TIMEOUT_MS = 60000;
const MAX_RETRIES = 6;
const EARTH_RADIUS_M = 6378137;

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function asciiUpper(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function titleCase(value) {
  return asciiUpper(value)
    .toLowerCase()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function roundCoord(num) {
  return Number(num.toFixed(POINT_PRECISION));
}

function formatSubgrupo(name) {
  const clean = asciiUpper(name).replace(/\s+/g, ' ').trim();
  return clean ? `SUB-${clean}` : 'SUB-SIN NOMBRE';
}

function inferSubstationName(label, feederId) {
  const raw = String(label || '').trim();
  if (!raw) {
    return feederId ? feederId.slice(0, 6) : 'SIN NOMBRE';
  }
  const stripped = raw.replace(/\s+\d{2,3}[A-Z0-9_].*$/i, '').trim();
  return stripped || raw;
}

function makeSubstationLayerLabel(name, feederLabel, feederId) {
  const title = titleCase(name);
  const tail = feederLabel || feederId || 'SIN ALIMENTADOR';
  return `S - E ${title} - ${tail}`;
}

function extractLineSets(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'LineString') return [geometry.coordinates];
  if (geometry.type === 'MultiLineString') return geometry.coordinates;
  return [];
}

function samplePoints(points, limit) {
  if (points.length <= limit) return points;
  const step = Math.ceil(points.length / limit);
  const out = [];
  for (let i = 0; i < points.length; i += step) out.push(points[i]);
  return out;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function countZones(geometry) {
  if (!geometry) return 0;
  if (geometry.type === 'Polygon') return 1;
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.length;
  return 0;
}

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

function ringAreaM2(ring) {
  if (!Array.isArray(ring) || ring.length < 3) return 0;
  const lat0 = ring.reduce((sum, point) => sum + point[1], 0) / ring.length;
  const cos0 = Math.cos(toRad(lat0));
  let area = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const [lon1, lat1] = ring[i];
    const [lon2, lat2] = ring[(i + 1) % ring.length];
    const x1 = EARTH_RADIUS_M * toRad(lon1) * cos0;
    const y1 = EARTH_RADIUS_M * toRad(lat1);
    const x2 = EARTH_RADIUS_M * toRad(lon2) * cos0;
    const y2 = EARTH_RADIUS_M * toRad(lat2);
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area) / 2;
}

function geometryAreaM2(geometry) {
  if (!geometry) return 0;
  if (geometry.type === 'Polygon') return ringAreaM2(geometry.coordinates[0] || []);
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.reduce((sum, polygon) => sum + ringAreaM2(polygon[0] || []), 0);
  }
  return 0;
}

function buildFeatureCollection(name, features) {
  return {
    type: 'FeatureCollection',
    name,
    features: features.sort((a, b) => {
      const ak = a.properties.alimentador_id || a.properties.subgrupo || '';
      const bk = b.properties.alimentador_id || b.properties.subgrupo || '';
      return ak.localeCompare(bk);
    }),
  };
}

function shouldRetry(error) {
  if (!error) return false;
  const message = String(error.message || error);
  const code = String(error.code || error?.cause?.code || '');
  return /timeout|timed out|reset|socket|network|fetch failed/i.test(message)
    || /UND_ERR|ECONN|ETIMEDOUT|ENOTFOUND/i.test(code);
}

async function fetchText(url, options = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const res = await fetch(url, {
        ...options,
        headers: {
          Accept: '*/*',
          ...(options.headers || {}),
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} for ${url}`);
      }
      return await res.text();
    } catch (error) {
      lastError = error;
      if (attempt >= MAX_RETRIES || !shouldRetry(error)) {
        throw error;
      }
      const waitMs = attempt * 2000;
      console.warn(`Retry ${attempt}/${MAX_RETRIES} for ${url}: ${error.message}. Waiting ${waitMs}ms...`);
      await delay(waitMs);
    }
  }
  throw lastError;
}

async function fetchJson(url, options = {}) {
  const text = await fetchText(url, options);
  return JSON.parse(text);
}

async function postJson(url, params, format = 'json') {
  let lastError = null;
  const body = new URLSearchParams({ ...params, f: format }).toString();
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: format === 'geojson' ? 'application/geo+json,application/json' : 'application/json',
        },
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} for ${url}`);
      }
      const text = await res.text();
      return JSON.parse(text);
    } catch (error) {
      lastError = error;
      if (attempt >= MAX_RETRIES || !shouldRetry(error)) {
        throw error;
      }
      const waitMs = attempt * 2000;
      console.warn(`Retry ${attempt}/${MAX_RETRIES} for ${url}: ${error.message}. Waiting ${waitMs}ms...`);
      await delay(waitMs);
    }
  }
  throw lastError;
}

async function fetchLayerMeta(layerId) {
  return fetchJson(`${BASE_URL}/${layerId}?f=pjson`);
}

async function fetchObjectIds(layerId) {
  const json = await fetchJson(`${BASE_URL}/${layerId}/query?where=1%3D1&returnIdsOnly=true&f=pjson`);
  return Array.isArray(json.objectIds) ? json.objectIds : [];
}

async function fetchGeoJsonBatch(layerId, objectIds) {
  return postJson(
    `${BASE_URL}/${layerId}/query`,
    {
      objectIds: objectIds.join(','),
      outFields: 'OBJECTID,ALIMENTADORID,ALIMENTADOR,ALIMENTADORINFO',
      outSR: '4326',
      returnGeometry: 'true',
      returnZ: 'false',
      returnM: 'false',
      geometryPrecision: '6',
    },
    'geojson',
  );
}

function upsertGroup(map, key, seed) {
  if (!map.has(key)) {
    map.set(key, {
      ...seed,
      pointsMap: new Map(),
      n_tramos: 0,
      n_vertices: 0,
      source_layers: new Set(),
    });
  }
  return map.get(key);
}

function addPoint(group, lon, lat) {
  const x = roundCoord(lon);
  const y = roundCoord(lat);
  const k = `${x},${y}`;
  if (!group.pointsMap.has(k)) {
    group.pointsMap.set(k, [x, y]);
  }
}

function ingestFeature(group, feature, layerId) {
  const lineSets = extractLineSets(feature.geometry);
  if (!lineSets.length) return;
  group.n_tramos += lineSets.length;
  group.source_layers.add(layerId);
  for (const line of lineSets) {
    for (const point of line) {
      if (!Array.isArray(point) || point.length < 2) continue;
      group.n_vertices += 1;
      addPoint(group, point[0], point[1]);
    }
  }
}

function cross(o, a, b) {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

function bbox(points) {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const [lon, lat] of points) {
    if (lon < minLon) minLon = lon;
    if (lat < minLat) minLat = lat;
    if (lon > maxLon) maxLon = lon;
    if (lat > maxLat) maxLat = lat;
  }
  return [minLon, minLat, maxLon, maxLat];
}

function bboxDiagKm(points) {
  if (points.length < 2) return 0;
  const [minLon, minLat, maxLon, maxLat] = bbox(points);
  const lat0 = (minLat + maxLat) / 2;
  const cos0 = Math.cos(toRad(lat0));
  const dx = EARTH_RADIUS_M * toRad(maxLon - minLon) * cos0;
  const dy = EARTH_RADIUS_M * toRad(maxLat - minLat);
  return Math.sqrt((dx * dx) + (dy * dy)) / 1000;
}

function convexHull(points) {
  const sorted = [...points]
    .filter((point) => Array.isArray(point) && point.length >= 2)
    .sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
  if (sorted.length < 3) return null;

  const lower = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) {
      lower.pop();
    }
    lower.push(point);
  }

  const upper = [];
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const point = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) {
      upper.pop();
    }
    upper.push(point);
  }

  upper.pop();
  lower.pop();
  const hull = lower.concat(upper);
  if (hull.length < 3) return null;
  hull.push(hull[0]);
  return {
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [hull],
    },
  };
}

function buildHull(points, mode) {
  const sampled = samplePoints(points, mode === 'feeder' ? 2600 : 5000);
  const hull = convexHull(sampled);
  return {
    hull,
    maxEdgeKm: clamp(bboxDiagKm(sampled) / (mode === 'feeder' ? 8 : 6), mode === 'feeder' ? 0.12 : 0.25, mode === 'feeder' ? 2.2 : 4.0),
  };
}

function buildFeederFeatures(feederGroups) {
  const features = [];
  for (const group of feederGroups.values()) {
    const points = [...group.pointsMap.values()];
    const { hull, maxEdgeKm } = buildHull(points, 'feeder');
    if (!hull || !hull.geometry) continue;
    const areaM2 = Number(geometryAreaM2(hull.geometry).toFixed(1));
    features.push({
      type: 'Feature',
      geometry: hull.geometry,
      properties: {
        seccion_id: group.feederId,
        alimentador_id: group.feederId,
        subestacion: titleCase(group.substationName),
        layer: group.displayLabel,
        n_nodos: group.n_vertices,
        n_disp_corte: null,
        n_zonas_alimentador: countZones(hull.geometry),
        area_m2: areaM2,
        cantidad_cortes: null,
        n_tramos: group.n_tramos,
        source_layers: [...group.source_layers].sort().join('|'),
        max_edge_km: Number((maxEdgeKm || 0).toFixed(3)),
        method: 'convex_hull_from_mt_lines',
      },
    });
  }
  return features;
}

function buildSubstationFeatures(feederGroups) {
  const subMap = new Map();
  for (const group of feederGroups.values()) {
    const key = formatSubgrupo(group.substationName);
    if (!subMap.has(key)) {
      subMap.set(key, {
        subgrupo: key,
        substationName: group.substationName,
        label: makeSubstationLayerLabel(group.substationName, group.displayLabel, group.feederId),
        pointsMap: new Map(),
        feederSet: new Set(),
        n_vertices: 0,
        source_layers: new Set(),
      });
    }
    const bucket = subMap.get(key);
    bucket.feederSet.add(group.feederId);
    bucket.n_vertices += group.n_vertices;
    for (const [ptKey, coords] of group.pointsMap.entries()) {
      if (!bucket.pointsMap.has(ptKey)) bucket.pointsMap.set(ptKey, coords);
    }
    for (const layer of group.source_layers) bucket.source_layers.add(layer);
  }

  const features = [];
  for (const group of subMap.values()) {
    const points = [...group.pointsMap.values()];
    const { hull, maxEdgeKm } = buildHull(points, 'substation');
    if (!hull || !hull.geometry) continue;
    features.push({
      type: 'Feature',
      geometry: hull.geometry,
      properties: {
        subgrupo: group.subgrupo,
        layer: group.label,
        n_pts: group.n_vertices,
        feeder_count: group.feederSet.size,
        area_m2: Number(geometryAreaM2(hull.geometry).toFixed(1)),
        source_layers: [...group.source_layers].sort().join('|'),
        max_edge_km: Number((maxEdgeKm || 0).toFixed(3)),
        method: 'convex_hull_from_mt_lines',
      },
    });
  }
  return features;
}

async function main() {
  console.log('Loading renderer metadata...');
  const metas = await Promise.all(LAYER_IDS.map(fetchLayerMeta));
  const feederLabelMap = new Map();
  for (const meta of metas) {
    const infos = meta?.drawingInfo?.renderer?.uniqueValueInfos || [];
    for (const info of infos) {
      if (!info?.value) continue;
      const current = feederLabelMap.get(info.value);
      if (!current || (info.label && info.label.length > current.label.length)) {
        feederLabelMap.set(info.value, {
          label: String(info.label || info.value).trim(),
          layerId: meta.id,
        });
      }
    }
  }

  const feederGroups = new Map();

  for (const layerId of LAYER_IDS) {
    console.log(`Fetching OBJECTIDs for layer ${layerId}...`);
    const objectIds = await fetchObjectIds(layerId);
    const batches = chunk(objectIds, CHUNK_SIZE);
    console.log(`Layer ${layerId}: ${objectIds.length} ids in ${batches.length} batches.`);

    for (let i = 0; i < batches.length; i += 1) {
      const batch = batches[i];
      const geojson = await fetchGeoJsonBatch(layerId, batch);
      const features = Array.isArray(geojson.features) ? geojson.features : [];
      for (const feature of features) {
        const feederId = String(feature?.properties?.ALIMENTADORID || '').trim();
        if (!feederId) continue;
        const rendererInfo = feederLabelMap.get(feederId) || { label: feederId };
        const substationName = inferSubstationName(rendererInfo.label, feederId);
        const displayLabel = rendererInfo.label || feederId;
        const group = upsertGroup(feederGroups, feederId, {
          feederId,
          substationName,
          displayLabel,
        });
        ingestFeature(group, feature, layerId);
      }

      if ((i + 1) % 10 === 0 || i === batches.length - 1) {
        console.log(`Layer ${layerId}: processed batch ${i + 1}/${batches.length}`);
      }
    }
  }

  console.log(`Building polygons for ${feederGroups.size} feeders...`);
  const feederFeatures = buildFeederFeatures(feederGroups);
  const substationFeatures = buildSubstationFeatures(feederGroups);

  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(FEEDER_OUT, JSON.stringify(buildFeatureCollection('zonas_interrupcion_quito', feederFeatures)));
  await fs.writeFile(SUBSTATION_OUT, JSON.stringify(buildFeatureCollection('GeoUIO_reconstruido', substationFeatures)));

  console.log(`Wrote ${feederFeatures.length} feeder polygons to ${FEEDER_OUT}`);
  console.log(`Wrote ${substationFeatures.length} substation polygons to ${SUBSTATION_OUT}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
