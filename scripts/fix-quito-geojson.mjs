import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const dataDir = path.join(root, 'data');
const sourcePath = path.join(dataDir, 'zonas_interrupcion_quito_merged.geojson');
const detailedPath = path.join(dataDir, 'zonas_interrupcion_quito_merged_detailed.geojson');

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));

const R = 6378137;
const toRad = (deg) => (deg * Math.PI) / 180;

function ringAreaM2(ring) {
  if (!Array.isArray(ring) || ring.length < 3) return 0;
  const lat0 = ring.reduce((sum, point) => sum + point[1], 0) / ring.length;
  const cos0 = Math.cos(toRad(lat0));
  let area = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const [lon1, lat1] = ring[i];
    const [lon2, lat2] = ring[(i + 1) % ring.length];
    const x1 = R * toRad(lon1) * cos0;
    const y1 = R * toRad(lat1);
    const x2 = R * toRad(lon2) * cos0;
    const y2 = R * toRad(lat2);
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area) / 2;
}

function polygonAreaM2(polygon) {
  if (!Array.isArray(polygon) || !polygon.length) return 0;
  let area = ringAreaM2(polygon[0]);
  for (let i = 1; i < polygon.length; i += 1) {
    area -= ringAreaM2(polygon[i]);
  }
  return Math.max(0, area);
}

function geometryAreaM2(geometry) {
  if (!geometry) return 0;
  if (geometry.type === 'Polygon') return polygonAreaM2(geometry.coordinates);
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.reduce((sum, polygon) => sum + polygonAreaM2(polygon), 0);
  }
  if (geometry.type === 'GeometryCollection') {
    return (geometry.geometries || []).reduce((sum, item) => sum + geometryAreaM2(item), 0);
  }
  return 0;
}

function normalizeDetailedFeature(feature) {
  const areaM2 = Number(geometryAreaM2(feature.geometry).toFixed(1));
  return {
    ...feature,
    properties: {
      ...feature.properties,
      area_m2: areaM2,
    },
  };
}

function buildPresentationFeature(feature) {
  const props = feature.properties || {};
  const areaM2 = Number(geometryAreaM2(feature.geometry).toFixed(1));
  const nNodos = Number(props.n_nodos ?? props.n_pts ?? 0);
  const nZonas = Number(props.n_zonas_alimentador ?? 1);
  const nDisp = Number(props.n_disp_corte ?? Math.max(1, nZonas));
  const cantidad = Number(props.cantidad_cortes ?? 0);

  return {
    type: 'Feature',
    geometry: feature.geometry,
    properties: {
      seccion_id: String(props.seccion_id ?? props.subgrupo ?? ''),
      alimentador_id: String(props.alimentador_id ?? props.subgrupo ?? ''),
      n_nodos: nNodos,
      n_disp_corte: nDisp,
      n_zonas_alimentador: nZonas,
      area_m2: areaM2,
      cantidad_cortes: cantidad,
      merged_from: props.subgrupo ? [String(props.subgrupo)] : null,
    },
  };
}

const source = readJson(sourcePath);
const detailed = {
  ...source,
  features: source.features.map(normalizeDetailedFeature),
};
const presentation = {
  type: 'FeatureCollection',
  crs: source.crs,
  name: source.name ?? 'zonas_interrupcion_quito_merged',
  features: detailed.features.map(buildPresentationFeature),
};

fs.writeFileSync(detailedPath, `${JSON.stringify(detailed, null, 2)}\n`);
fs.writeFileSync(sourcePath, `${JSON.stringify(presentation, null, 2)}\n`);

const stats = {
  features: presentation.features.length,
  zeroArea: presentation.features.filter((f) => Number(f.properties.area_m2 || 0) === 0).length,
  withCuts: presentation.features.filter((f) => Number(f.properties.cantidad_cortes || 0) > 0).length,
  withoutCuts: presentation.features.filter((f) => Number(f.properties.cantidad_cortes || 0) === 0).length,
};

console.log(JSON.stringify(stats, null, 2));
