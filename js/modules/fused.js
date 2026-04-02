import { getPathStyle, getPointStyle } from './styling.js';

export function ensureFusedLayersBuilt(ctx) {
  if (ctx.state.fused.built) return;
  buildFusedLayers(ctx);
  ctx.state.fused.built = true;
}

export function buildFusedLayers(ctx) {
  ctx.state.fused.groupLayers = new Map();
  const renderer = L.canvas({ padding: 0.5 });

  ctx.state.groups.forEach(function (group) {
    const feats = group.featureIds
      .map(function (id) { return ctx.state.features[id] ? ctx.state.features[id].feature : null; })
      .filter(Boolean);

    const polys = feats.filter(function (f) {
      return /Polygon/i.test((f.geometry && f.geometry.type) || '');
    });
    const points = feats.filter(function (f) {
      return /Point/i.test((f.geometry && f.geometry.type) || '');
    });

    const fg = L.featureGroup();
    const gMeta = getGroupMeta(ctx, group.key);

    if (polys.length) {
      const dissolved = dissolvePolygons(ctx, polys);
      const polyLayer = L.geoJSON(dissolved, {
        renderer: renderer,
        style: function () { return getPathStyle(ctx, gMeta, false); },
      });
      polyLayer.on('mouseover', function () { applyStyleToFusedGroup(ctx, group.key, true); });
      polyLayer.on('mouseout', function () { applyStyleToFusedGroup(ctx, group.key, false); });
      polyLayer.on('click', function (evt) {
        L.DomEvent.stopPropagation(evt);
        const firstId = group.featureIds[0];
        if (Number.isFinite(firstId)) ctx._hooks.openInfoPanel(ctx, firstId);
      });
      polyLayer.addTo(fg);
    }

    if (points.length) {
      const pLayer = L.geoJSON({ type: 'FeatureCollection', features: points }, {
        renderer: renderer,
        pointToLayer: function (_, latlng) { return L.circleMarker(latlng, getPointStyle(ctx, gMeta, false)); },
      });
      pLayer.on('mouseover', function () { applyStyleToFusedGroup(ctx, group.key, true); });
      pLayer.on('mouseout', function () { applyStyleToFusedGroup(ctx, group.key, false); });
      pLayer.on('click', function (evt) {
        L.DomEvent.stopPropagation(evt);
        const firstId = group.featureIds[0];
        if (Number.isFinite(firstId)) ctx._hooks.openInfoPanel(ctx, firstId);
      });
      pLayer.addTo(fg);
    }

    ctx.state.fused.groupLayers.set(group.key, fg);
  });
}

export function getGroupMeta(ctx, groupKey) {
  const g = ctx.state.groups.get(groupKey);
  if (!g) {
    return { groupKey: groupKey, slots: [], hasOutage: false, totalOutageMin: 0, geometryType: 'Polygon' };
  }
  return {
    groupKey: g.key,
    slots: g.slots || [],
    hasOutage: g.hasOutage,
    totalOutageMin: g.totalOutageMin,
    geometryType: 'Polygon',
  };
}

export function applyStyleToFusedGroup(ctx, groupKey, hover) {
  const fg = ctx.state.fused.groupLayers.get(groupKey);
  if (!fg) return;
  const meta = getGroupMeta(ctx, groupKey);
  const pathStyle = getPathStyle(ctx, meta, hover);
  const pointStyle = getPointStyle(ctx, meta, hover);

  fg.eachLayer(function (sub) {
    if (typeof sub.eachLayer === 'function') {
      sub.eachLayer(function (inner) {
        if (inner instanceof L.CircleMarker) {
          inner.setStyle(pointStyle);
          if (typeof inner.setRadius === 'function') inner.setRadius(pointStyle.radius);
        } else if (inner && typeof inner.setStyle === 'function') {
          inner.setStyle(pathStyle);
        }
      });
    } else if (sub instanceof L.CircleMarker) {
      sub.setStyle(pointStyle);
    } else if (sub && typeof sub.setStyle === 'function') {
      sub.setStyle(pathStyle);
    }
  });
}

export function refreshFusedStyles(ctx) {
  if (!ctx.state.fused.built) return;
  ctx.state.fused.groupLayers.forEach(function (_, key) {
    applyStyleToFusedGroup(ctx, key, false);
  });
}

export function refreshFusedVisibility(ctx) {
  ensureFusedLayersBuilt(ctx);

  for (let i = 0; i < ctx.state.features.length; i += 1) {
    const feat = ctx.state.features[i];
    if (ctx.state.map.hasLayer(feat.layer)) ctx.state.map.removeLayer(feat.layer);
  }

  ctx.state.groups.forEach(function (group) {
    const fg = ctx.state.fused.groupLayers.get(group.key);
    if (!fg) return;
    const onMap = ctx.state.map.hasLayer(fg);
    if (group.visible && !onMap) fg.addTo(ctx.state.map);
    if (!group.visible && onMap) ctx.state.map.removeLayer(fg);
  });
}

export function updateGeomToggleButton(ctx) {
  if (!ctx.els.btnGeomToggle) return;
  const isFused = ctx.state.geomMode === 'fused';
  ctx.els.btnGeomToggle.textContent = isFused ? 'Vista integrada' : 'Vista analítica';
  ctx.els.btnGeomToggle.classList.toggle('btn-mini-primary', isFused);
  ctx.els.btnExportFused.hidden = !isFused;
}

export function toggleGeometryMode(ctx) {
  ctx.state.geomMode = ctx.state.geomMode === 'detail' ? 'fused' : 'detail';
  if (ctx.state.geomMode === 'fused') ensureFusedLayersBuilt(ctx);
  updateGeomToggleButton(ctx);
  ctx._hooks.refreshAll(ctx);
  const msg = ctx.state.geomMode === 'fused' ? 'Vista fusionada v4 activada.' : 'Vista detallada activada.';
  ctx.els.statusPill.textContent = msg;
  ctx.els.statusPill.classList.remove('ok', 'warn', 'err');
  ctx.els.statusPill.classList.add('ok');
}

export function dissolvePolygons(ctx, polys) {
  if (!polys || !polys.length) return null;
  if (typeof turf === 'undefined') return fillHoles(polys[0]);

  let diss = null;
  try {
    const cleaned = polys.map(function (f) {
      const nh = fillHoles(f);
      try {
        return turf.buffer(nh, ctx.GAP_FILL, { units: 'meters' }) || nh;
      } catch (_) {
        return nh;
      }
    });
    diss = cleaned.reduce(function (acc, f) {
      return turf.union(acc, f);
    });
    diss = fillHoles(diss);
  } catch (_) {
    diss = fillHoles(polys[0]);
  }

  return diss || fillHoles(polys[0]);
}

export function fillHoles(feature) {
  if (!feature || !feature.geometry) return feature;
  const g = feature.geometry;
  if (g.type === 'Polygon') {
    return {
      type: feature.type || 'Feature',
      properties: feature.properties || {},
      geometry: { type: 'Polygon', coordinates: [g.coordinates[0]] },
    };
  }
  if (g.type === 'MultiPolygon') {
    return {
      type: feature.type || 'Feature',
      properties: feature.properties || {},
      geometry: {
        type: 'MultiPolygon',
        coordinates: g.coordinates.map(function (p) { return [p[0]]; }),
      },
    };
  }
  return feature;
}
