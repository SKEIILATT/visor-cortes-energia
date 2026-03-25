import { escapeHtml } from './utils.js';
import { getPathStyle, getPointStyle, applyStyleToFeature } from './styling.js';

export function buildFeatureLayers(ctx) {
  const feats = ctx.state.geojson.features || [];
  const metaList = ctx.state.analysis.featureMeta || [];
  const renderer = L.canvas({ padding: 0.5 });

  ctx.state.mapBounds = null;
  ctx.state.features = [];

  for (let i = 0; i < feats.length; i += 1) {
    const feature = feats[i];
    const meta = metaList[i] || {
      id: i,
      groupKey: 'N/A',
      slots: [],
      slotCount: 0,
      hasOutage: false,
      totalOutageMin: 0,
      geometryType: feature && feature.geometry && feature.geometry.type ? feature.geometry.type : 'Sin geometría',
    };

    const layer = L.geoJSON(feature, {
      renderer: renderer,
      style: function () { return getPathStyle(ctx, meta, false); },
      pointToLayer: function (_, latlng) { return L.circleMarker(latlng, getPointStyle(ctx, meta, false)); },
    });

    layer.on('mouseover', makeHoverHandler(ctx, i, true));
    layer.on('mouseout', makeHoverHandler(ctx, i, false));
    layer.on('click', makeClickHandler(ctx, i));
    layer.bindTooltip(buildFeatureTooltip(meta), { sticky: true, direction: 'top', opacity: 0.96 });
    layer.addTo(ctx.state.map);

    ctx.state.features.push({
      id: i,
      feature: feature,
      meta: meta,
      layer: layer,
      matchesFilter: true,
      hovered: false,
    });

    extendGlobalBounds(ctx, layer);
  }
}

function makeHoverHandler(ctx, featureId, hovering) {
  return function () {
    const feat = ctx.state.features[featureId];
    if (!feat) return;
    feat.hovered = hovering;
    applyStyleToFeature(ctx, feat);
  };
}

function makeClickHandler(ctx, featureId) {
  return function (evt) {
    L.DomEvent.stopPropagation(evt);
    ctx._hooks.openInfoPanel(ctx, featureId);
  };
}

export function buildFeatureTooltip(meta) {
  const label = escapeHtml(meta.groupKey || 'N/A');
  const pieces = ['<strong>' + label + '</strong>'];
  if (meta.hasOutage) pieces.push('Franjas: ' + meta.slotCount);
  return pieces.join('<br>');
}

export function shouldFeatureBeVisible(ctx, feat) {
  const group = ctx.state.groups.get(feat.meta.groupKey);
  return !!(group && group.visible && feat.matchesFilter);
}

export function refreshFeatureVisibility(ctx) {
  if (ctx.state.geomMode === 'fused') {
    refreshFusedVisibilityLocal(ctx);
    return;
  }

  for (let i = 0; i < ctx.state.features.length; i += 1) {
    const feat = ctx.state.features[i];
    const visible = shouldFeatureBeVisible(ctx, feat);
    const onMap = ctx.state.map.hasLayer(feat.layer);
    if (visible && !onMap) feat.layer.addTo(ctx.state.map);
    if (!visible && onMap) ctx.state.map.removeLayer(feat.layer);
  }

  if (ctx.state.fused.built) {
    ctx.state.fused.groupLayers.forEach(function (layer) {
      if (ctx.state.map.hasLayer(layer)) ctx.state.map.removeLayer(layer);
    });
  }
}

function refreshFusedVisibilityLocal(ctx) {
  // Delegate to fused module via hook to avoid circular import
  if (ctx._hooks && ctx._hooks.refreshFusedVisibility) {
    ctx._hooks.refreshFusedVisibility(ctx);
  }
}

export function refreshFeatureStyles(ctx) {
  if (ctx.state.geomMode === 'fused') {
    ctx._hooks.refreshFusedStyles(ctx);
    return;
  }
  for (let i = 0; i < ctx.state.features.length; i += 1) {
    applyStyleToFeature(ctx, ctx.state.features[i]);
  }
}

export function fitInitialView(ctx) {
  if (ctx.state.pendingHashState && ctx.state.pendingHashState.view) {
    const v = ctx.state.pendingHashState.view;
    ctx.state.map.setView([v.lat, v.lng], v.z);
    return;
  }
  if (ctx.state.mapBounds && ctx.state.mapBounds.isValid()) {
    ctx.state.map.fitBounds(ctx.state.mapBounds.pad(0.06));
    return;
  }
  ctx.state.map.setView([-2.16, -79.9], 11);
}

export function extendGlobalBounds(ctx, layer) {
  if (!layer || typeof layer.getBounds !== 'function') return;
  const bounds = layer.getBounds();
  if (!bounds || !bounds.isValid()) return;
  if (!ctx.state.mapBounds) {
    ctx.state.mapBounds = bounds;
  } else {
    ctx.state.mapBounds.extend(bounds);
  }
}
