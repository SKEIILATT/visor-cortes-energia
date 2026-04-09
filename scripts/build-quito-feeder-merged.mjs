import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const dataDir = path.join(root, 'data');

const feederSourcePath = path.join(dataDir, 'zonas_interrupcion_quito.geojson');
const substationSourcePath = path.join(dataDir, 'zonas_interrupcion_quito_merged_detailed.geojson');
const detailedOutPath = path.join(dataDir, 'zonas_interrupcion_quito_alimentadores_merged_detailed.geojson');
const outPath = path.join(dataDir, 'zonas_interrupcion_quito_alimentadores_merged.geojson');

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));

function asciiUpper(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .toUpperCase();
}

function compactKey(value) {
  return asciiUpper(value).replace(/\s+/g, '');
}

function isRawFeederName(value) {
  return /^\d{6,}[A-Z0-9]*$/i.test(String(value || '').replace(/[^A-Za-z0-9]/g, ''));
}

function centroidOfGeometry(geometry) {
  const points = [];
  const stack = [geometry?.coordinates];
  while (stack.length) {
    const current = stack.pop();
    if (!Array.isArray(current)) continue;
    if (current.length >= 2 && typeof current[0] === 'number' && typeof current[1] === 'number') {
      points.push(current);
    } else {
      for (const item of current) stack.push(item);
    }
  }
  const sum = points.reduce((acc, point) => [acc[0] + point[0], acc[1] + point[1]], [0, 0]);
  return [sum[0] / points.length, sum[1] / points.length];
}

function distance(a, b) {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return Math.sqrt((dx * dx) + (dy * dy));
}

function pointInRing(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const crosses = (yi > point[1]) !== (yj > point[1]);
    const xCross = ((xj - xi) * (point[1] - yi)) / ((yj - yi) || 1e-12) + xi;
    if (crosses && point[0] < xCross) inside = !inside;
  }
  return inside;
}

function pointInGeometry(point, geometry) {
  if (!geometry) return false;
  if (geometry.type === 'Polygon') {
    const [outer, ...holes] = geometry.coordinates;
    if (!pointInRing(point, outer)) return false;
    return !holes.some((hole) => pointInRing(point, hole));
  }
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.some((polygon) => pointInGeometry(point, { type: 'Polygon', coordinates: polygon }));
  }
  return false;
}

function buildSubstationIndex(substations) {
  const byName = new Map();
  const byCompact = new Map();
  const byCode = new Map();

  for (const feature of substations) {
    const props = feature.properties || {};
    const names = [
      props.subestacion,
      props.alimentador_id,
      props.subgrupo?.replace(/^SUB-/, '').replace(/-/g, ' '),
      props.layer?.replace(/^S - E\s*/i, ''),
    ].filter(Boolean);

    for (const name of names) {
      const key = compactKey(name);
      if (key && !byCompact.has(key)) byCompact.set(key, feature);
      const upper = asciiUpper(name);
      if (upper && !byName.has(upper)) byName.set(upper, feature);
    }

    const code = String(props.alimentador_id || '').trim().toUpperCase();
    if (/^\d{6}$/.test(code) && !byCode.has(code)) byCode.set(code, feature);
  }

  return { byName, byCompact, byCode };
}

function buildPrefixNameMap(feeders) {
  const byPrefix = new Map();
  for (const feature of feeders) {
    const props = feature.properties || {};
    const feederId = String(props.alimentador_id || '');
    const prefix = feederId.slice(0, 6);
    if (!/^\d{6}$/.test(prefix)) continue;
    const current = byPrefix.get(prefix) || new Map();
    const substationName = String(props.subestacion || '').trim();
    if (substationName && !isRawFeederName(substationName)) {
      const key = compactKey(substationName);
      current.set(key, substationName);
      byPrefix.set(prefix, current);
    }
  }
  return byPrefix;
}

function resolveSubstation(feature, substations, subIndex, prefixNameMap) {
  const props = feature.properties || {};
  const centroid = centroidOfGeometry(feature.geometry);

  const compactName = compactKey(props.subestacion);
  if (compactName && subIndex.byCompact.has(compactName)) {
    return { feature: subIndex.byCompact.get(compactName), method: 'name_match' };
  }

  const prefix = String(props.alimentador_id || '').slice(0, 6);
  if (prefixNameMap.has(prefix)) {
    const siblingName = [...prefixNameMap.get(prefix).values()][0];
    const siblingKey = compactKey(siblingName);
    if (subIndex.byCompact.has(siblingKey)) {
      return { feature: subIndex.byCompact.get(siblingKey), method: 'prefix_sibling_name' };
    }
  }

  if (/^\d{6}$/.test(prefix) && subIndex.byCode.has(prefix)) {
    return { feature: subIndex.byCode.get(prefix), method: 'prefix_code' };
  }

  const spatialHit = substations.find((sub) => pointInGeometry(centroid, sub.geometry));
  if (spatialHit) {
    return { feature: spatialHit, method: 'spatial_contains' };
  }

  const nearest = substations
    .map((sub) => ({ feature: sub, d: distance(centroid, centroidOfGeometry(sub.geometry)) }))
    .sort((a, b) => a.d - b.d)[0];
  if (nearest) {
    return { feature: nearest.feature, method: 'nearest_substation' };
  }

  return { feature: null, method: 'unmatched' };
}

function allocateIntegerCounts(items, total) {
  const safeTotal = Number(total || 0);
  if (safeTotal <= 0 || !items.length) {
    return new Map(items.map((item) => [item.key, 0]));
  }

  const weights = items.map((item) => Math.max(1, Number(item.weight || 0)));
  const sumWeights = weights.reduce((sum, value) => sum + value, 0);
  const provisional = items.map((item, index) => {
    const exact = (safeTotal * weights[index]) / sumWeights;
    return {
      key: item.key,
      base: Math.floor(exact),
      frac: exact - Math.floor(exact),
    };
  });

  let assigned = provisional.reduce((sum, item) => sum + item.base, 0);
  let remaining = safeTotal - assigned;
  provisional.sort((a, b) => b.frac - a.frac);
  for (let i = 0; i < provisional.length && remaining > 0; i += 1) {
    provisional[i].base += 1;
    remaining -= 1;
  }

  return new Map(provisional.map((item) => [item.key, item.base]));
}

const feederSource = readJson(feederSourcePath);
const feederFeatures = feederSource.features || [];
const substationSource = readJson(substationSourcePath);
const substationFeatures = substationSource.features || [];

const subIndex = buildSubstationIndex(substationFeatures);
const prefixNameMap = buildPrefixNameMap(feederFeatures);

const detailedFeatures = feederFeatures.map((feature) => {
  const resolved = resolveSubstation(feature, substationFeatures, subIndex, prefixNameMap);
  const sub = resolved.feature;
  const feederProps = feature.properties || {};
  const subProps = sub?.properties || {};

  return {
    type: 'Feature',
    geometry: feature.geometry,
    properties: {
      seccion_id: String(feederProps.seccion_id || feederProps.alimentador_id || ''),
      alimentador_id: String(feederProps.alimentador_id || feederProps.seccion_id || ''),
      alimentador_label: String(feederProps.layer || feederProps.alimentador_id || ''),
      n_nodos: Number(feederProps.n_nodos || 0),
      n_disp_corte: 1,
      n_zonas_alimentador: Number(feederProps.n_zonas_alimentador || 1),
      area_m2: Number(feederProps.area_m2 || 0),
      cantidad_cortes: 0,
      subgrupo: subProps.subgrupo || null,
      subestacion: subProps.subestacion || feederProps.subestacion || null,
      cantidad_cortes_subestacion: Number(subProps.cantidad_cortes || 0),
      dias_programados: Number(subProps.dias_programados || 0),
      fecha_inicio: subProps.fecha_inicio || null,
      fecha_fin: subProps.fecha_fin || null,
      cortes_horas: subProps.cortes_horas || null,
      filas_fuente: Number(subProps.filas_fuente || 0),
      sector_ejemplo: subProps.sector_ejemplo || null,
      fuente_datos: subProps.fuente_datos || 'sin_fuente',
      match_method: resolved.method,
      source_layers: feederProps.source_layers || null,
      n_tramos: Number(feederProps.n_tramos || 0),
      max_edge_km: Number(feederProps.max_edge_km || 0),
      geometry_method: feederProps.method || null,
      merged_from: subProps.subgrupo ? [String(subProps.subgrupo)] : null,
    },
  };
});

const bySubgrupo = new Map();
for (const feature of detailedFeatures) {
  const key = feature.properties.subgrupo || '__NO_MATCH__';
  if (!bySubgrupo.has(key)) bySubgrupo.set(key, []);
  bySubgrupo.get(key).push(feature);
}

for (const [subgrupo, features] of bySubgrupo.entries()) {
  const total = Number(features[0].properties.cantidad_cortes_subestacion || 0);
  const allocations = allocateIntegerCounts(
    features.map((feature) => ({
      key: feature.properties.alimentador_id,
      weight: feature.properties.n_nodos,
    })),
    total,
  );
  for (const feature of features) {
    feature.properties.cantidad_cortes = allocations.get(feature.properties.alimentador_id) || 0;
  }
  if (subgrupo === '__NO_MATCH__') {
    for (const feature of features) {
      feature.properties.fuente_datos = 'sin_match_subestacion';
      feature.properties.cantidad_cortes = 0;
    }
  }
}

const presentation = {
  type: 'FeatureCollection',
  name: 'zonas_interrupcion_quito_alimentadores_merged',
  crs: feederSource.crs,
  features: detailedFeatures.map((feature) => ({
    type: 'Feature',
    geometry: feature.geometry,
    properties: {
      seccion_id: feature.properties.seccion_id,
      alimentador_id: feature.properties.alimentador_id,
      n_nodos: feature.properties.n_nodos,
      n_disp_corte: feature.properties.n_disp_corte,
      n_zonas_alimentador: feature.properties.n_zonas_alimentador,
      area_m2: feature.properties.area_m2,
      cantidad_cortes: feature.properties.cantidad_cortes,
      merged_from: feature.properties.merged_from,
    },
  })),
};

const detailed = {
  type: 'FeatureCollection',
  name: 'zonas_interrupcion_quito_alimentadores_merged_detailed',
  crs: feederSource.crs,
  features: detailedFeatures,
};

fs.writeFileSync(detailedOutPath, `${JSON.stringify(detailed, null, 2)}\n`);
fs.writeFileSync(outPath, `${JSON.stringify(presentation, null, 2)}\n`);

const stats = {
  feeders: presentation.features.length,
  withCuts: presentation.features.filter((feature) => Number(feature.properties.cantidad_cortes || 0) > 0).length,
  withoutCuts: presentation.features.filter((feature) => Number(feature.properties.cantidad_cortes || 0) === 0).length,
  unmatchedFeeders: detailed.features.filter((feature) => feature.properties.match_method === 'unmatched').length,
  matchMethods: [...detailed.features.reduce((acc, feature) => {
    const key = feature.properties.match_method;
    acc.set(key, (acc.get(key) || 0) + 1);
    return acc;
  }, new Map()).entries()],
};

console.log(JSON.stringify(stats, null, 2));
