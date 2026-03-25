import { downloadText, csvCell } from './utils.js';
import { shouldFeatureBeVisible } from './layers.js';
import { dissolvePolygons } from './fused.js';
import { isGroupAffectedAt } from './timeline.js';
import { countVisibleFeaturesInGroup } from './groups.js';

export function fileBaseName(ctx) {
  const name = ctx.state.datasetRecord && ctx.state.datasetRecord.name ? ctx.state.datasetRecord.name : 'dataset';
  return name.replace(/[^a-z0-9_\-]+/gi, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '') || 'dataset';
}

export function exportVisibleGeoJSON(ctx) {
  const visibleFeatures = [];
  for (let i = 0; i < ctx.state.features.length; i += 1) {
    const feat = ctx.state.features[i];
    if (shouldFeatureBeVisible(ctx, feat)) visibleFeatures.push(feat.feature);
  }

  const payload = {
    type: 'FeatureCollection',
    name: (ctx.state.datasetRecord && ctx.state.datasetRecord.name ? ctx.state.datasetRecord.name : 'dataset') + ' (filtrado)',
    features: visibleFeatures,
  };

  const text = JSON.stringify(payload, null, 2);
  downloadText(fileBaseName(ctx) + '_filtrado.geojson', text, 'application/geo+json;charset=utf-8');
  ctx.els.statusPill.textContent = 'GeoJSON exportado (' + visibleFeatures.length + ' features).';
  ctx.els.statusPill.classList.remove('ok', 'warn', 'err');
  ctx.els.statusPill.classList.add('ok');
}

export function exportFusedGeoJSON(ctx) {
  const features = [];

  ctx.state.groups.forEach(function (group) {
    const groupVisible = group.featureIds.some(function (id) {
      return ctx.state.features[id] && shouldFeatureBeVisible(ctx, ctx.state.features[id]);
    });
    if (!groupVisible) return;

    const feats = group.featureIds
      .map(function (id) { return ctx.state.features[id] ? ctx.state.features[id].feature : null; })
      .filter(Boolean);

    const polys = feats.filter(function (f) {
      return /Polygon/i.test((f.geometry && f.geometry.type) || '');
    });
    const points = feats.filter(function (f) {
      return /Point/i.test((f.geometry && f.geometry.type) || '');
    });

    const firstProps = (feats[0] && feats[0].properties) || {};

    if (polys.length) {
      const dissolved = dissolvePolygons(ctx, polys);
      if (dissolved) {
        features.push({
          type: 'Feature',
          properties: firstProps,
          geometry: dissolved.geometry || dissolved,
        });
      }
    }

    points.forEach(function (f) { features.push(f); });
  });

  const baseName = ctx.state.datasetRecord && ctx.state.datasetRecord.name ? ctx.state.datasetRecord.name : 'dataset';
  const payload = {
    type: 'FeatureCollection',
    name: baseName + ' (fusionado)',
    features: features,
  };

  const text = JSON.stringify(payload, null, 2);
  downloadText(fileBaseName(ctx) + '_fusionado.geojson', text, 'application/geo+json;charset=utf-8');
  ctx.els.statusPill.textContent = 'GeoJSON fusionado exportado (' + features.length + ' features).';
  ctx.els.statusPill.classList.remove('ok', 'warn', 'err');
  ctx.els.statusPill.classList.add('ok');
}

export function exportSummaryCsv(ctx) {
  const header = ['grupo', 'features_totales', 'features_visibles', 'franjas', 'horas_estimadas', 'activo_en_timeline'];
  const rows = [header.join(',')];

  ctx.state.groups.forEach(function (g) {
    const visible = countVisibleFeaturesInGroup(ctx, g.key);
    const active = ctx.state.minute >= 0 ? (isGroupAffectedAt(ctx, g.key, ctx.state.minute) ? 'si' : 'no') : '-';
    const line = [csvCell(g.key), g.featureCount, visible, g.slotCount, (g.totalOutageMin / 60).toFixed(2), active];
    rows.push(line.join(','));
  });

  downloadText(fileBaseName(ctx) + '_resumen.csv', rows.join('\n'), 'text/csv;charset=utf-8');
  ctx.els.statusPill.textContent = 'Resumen CSV exportado.';
  ctx.els.statusPill.classList.remove('ok', 'warn', 'err');
  ctx.els.statusPill.classList.add('ok');
}
