import { escapeHtml, downloadText } from './utils.js';
import { shouldFeatureBeVisible } from './layers.js';

export function runOverlapResolver(ctx) {
  if (typeof turf === 'undefined') {
    ctx.els.statusPill.textContent = 'Turf.js es necesario para esta función.';
    ctx.els.statusPill.classList.remove('ok', 'warn', 'err');
    ctx.els.statusPill.classList.add('err');
    return;
  }

  const polygons = ctx.state.features
    .filter(function (f) {
      const geomType = (f.feature.geometry && f.feature.geometry.type) || '';
      return /Polygon/i.test(geomType);
    })
    .map(function (f) { return f.feature; });

  if (!polygons.length) {
    ctx.els.statusPill.textContent = 'El dataset no contiene polígonos.';
    ctx.els.statusPill.classList.remove('ok', 'warn', 'err');
    ctx.els.statusPill.classList.add('err');
    return;
  }

  if (ctx.state.resolved.previewLayer) {
    ctx.state.map.removeLayer(ctx.state.resolved.previewLayer);
    ctx.state.resolved.previewLayer = null;
  }
  ctx.state.resolved.done = false;
  ctx.state.resolved.features = [];
  ctx.els.btnExportResolved.hidden = true;
  ctx.els.btnResolveOverlaps.disabled = true;

  ctx.els.statusPill.textContent = 'Analizando ' + polygons.length + ' polígonos...';
  ctx.els.statusPill.classList.remove('ok', 'warn', 'err');
  ctx.els.statusPill.classList.add('warn');

  resolveOverlapsAsync(
    polygons,
    function onProgress(current, total) {
      ctx.els.statusPill.textContent = 'Procesando ' + current + ' / ' + total + '...';
      ctx.els.statusPill.classList.remove('ok', 'warn', 'err');
      ctx.els.statusPill.classList.add('warn');
    },
    function onDone(result) {
      ctx.state.resolved.features = result;
      ctx.state.resolved.done = true;
      ctx.state.resolved.previewLayer = buildResolvedPreviewLayer(ctx, result);

      ctx.els.btnExportResolved.hidden = false;
      ctx.els.btnResolveOverlaps.disabled = false;
      ctx.els.comparePanel.hidden = false;
      setCompareMode(ctx, 'both');

      const removed = polygons.length - result.length;
      const msg = 'Listo: ' + result.length + ' polígonos resultantes' +
        (removed > 0 ? ' (' + removed + ' absorbidos completamente)' : '') + '.';
      ctx.els.statusPill.textContent = msg;
      ctx.els.statusPill.classList.remove('ok', 'warn', 'err');
      ctx.els.statusPill.classList.add('ok');
    }
  );
}

export function resolveOverlapsAsync(features, onProgress, onDone) {
  const sorted = features.slice().sort(function (a, b) {
    let areaA = 0;
    let areaB = 0;
    try { areaA = turf.area(a); } catch (_) {}
    try { areaB = turf.area(b); } catch (_) {}
    return areaA - areaB;
  });

  const result = [];
  const resultBBoxes = [];
  let idx = 0;

  function processNext() {
    if (idx >= sorted.length) {
      onDone(result);
      return;
    }

    let current = sorted[idx];

    if (current && current.geometry) {
      let currentBbox = null;
      try { currentBbox = turf.bbox(current); } catch (_) {}

      for (let j = 0; j < result.length; j++) {
        if (currentBbox && resultBBoxes[j] && !bboxesOverlap(currentBbox, resultBBoxes[j])) {
          continue;
        }

        let diff = null;
        try {
          diff = turf.difference(current, result[j]);
        } catch (_) {
          diff = current;
        }

        if (!diff) {
          current = null;
          break;
        }

        current = diff;
        try { currentBbox = turf.bbox(current); } catch (_) {}
      }
    }

    if (current) {
      result.push(current);
      try {
        resultBBoxes.push(turf.bbox(current));
      } catch (_) {
        resultBBoxes.push([-180, -90, 180, 90]);
      }
    }

    idx++;
    onProgress(idx, sorted.length);
    setTimeout(processNext, 0);
  }

  setTimeout(processNext, 0);
}

export function bboxesOverlap(a, b) {
  return !(a[2] < b[0] || b[2] < a[0] || a[3] < b[1] || b[3] < a[1]);
}

export function setCompareMode(ctx, mode) {
  ctx.state.compareMode = mode;

  const showOriginal = (mode === 'before' || mode === 'both');
  const showResolved  = (mode === 'after'  || mode === 'both');
  const dimOriginal   = (mode === 'both');

  if (!showOriginal) {
    for (let i = 0; i < ctx.state.features.length; i += 1) {
      const feat = ctx.state.features[i];
      if (ctx.state.map.hasLayer(feat.layer)) ctx.state.map.removeLayer(feat.layer);
    }
    if (ctx.state.fused.built) {
      ctx.state.fused.groupLayers.forEach(function (layer) {
        if (ctx.state.map.hasLayer(layer)) ctx.state.map.removeLayer(layer);
      });
    }
  } else {
    ctx._hooks.refreshAll(ctx);
    if (dimOriginal) {
      for (let i = 0; i < ctx.state.features.length; i += 1) {
        const feat = ctx.state.features[i];
        if (ctx.state.map.hasLayer(feat.layer)) {
          feat.layer.setStyle({ fillOpacity: 0.12, opacity: 0.35, weight: 1 });
        }
      }
    }
  }

  if (ctx.state.resolved.previewLayer) {
    const onMap = ctx.state.map.hasLayer(ctx.state.resolved.previewLayer);
    if (showResolved && !onMap) ctx.state.resolved.previewLayer.addTo(ctx.state.map);
    if (!showResolved && onMap) ctx.state.map.removeLayer(ctx.state.resolved.previewLayer);
  }

  ctx.els.btnCmpBefore.classList.toggle('btn-mini-primary', mode === 'before');
  ctx.els.btnCmpBoth.classList.toggle('btn-mini-primary', mode === 'both');
  ctx.els.btnCmpAfter.classList.toggle('btn-mini-primary', mode === 'after');
}

export function buildResolvedPreviewLayer(ctx, features) {
  const renderer = L.canvas({ padding: 0.5 });
  const groupField = ctx.state.analysis && ctx.state.analysis.groupBy;

  return L.geoJSON(
    { type: 'FeatureCollection', features: features },
    {
      renderer: renderer,
      style: function (feature) {
        const props = feature.properties || {};
        const rawKey = groupField ? props[groupField] : null;
        const groupKey = (rawKey != null && String(rawKey).trim()) ? String(rawKey).trim() : 'N/A';
        const group = ctx.state.groups.get(groupKey);
        const color = group ? group.color : '#3b82f6';
        return { color: color, weight: 2.5, opacity: 1, fillColor: color, fillOpacity: 0.52 };
      },
      onEachFeature: function (feature, layer) {
        const props = feature.properties || {};
        const rawKey = groupField ? props[groupField] : null;
        const label = rawKey || props.subgrupo || props.layer || props.nombre || 'Polígono';
        layer.bindTooltip(escapeHtml(String(label)), { sticky: true, direction: 'top', opacity: 0.95 });
      },
    }
  );
}

export function exportResolvedGeoJSON(ctx) {
  if (!ctx.state.resolved.done || !ctx.state.resolved.features.length) {
    ctx.els.statusPill.textContent = 'Primero ejecuta "Resolver solapamientos".';
    ctx.els.statusPill.classList.remove('ok', 'warn', 'err');
    ctx.els.statusPill.classList.add('err');
    return;
  }

  const baseName = (ctx.state.datasetRecord && ctx.state.datasetRecord.name)
    ? ctx.state.datasetRecord.name
    : 'dataset';

  const payload = {
    type: 'FeatureCollection',
    name: baseName + ' (sin solapamientos)',
    features: ctx.state.resolved.features,
  };

  const name = baseName.replace(/[^a-z0-9_\-]+/gi, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '') || 'dataset';
  const text = JSON.stringify(payload, null, 2);
  downloadText(name + '_sin_solapamientos.geojson', text, 'application/geo+json;charset=utf-8');
  ctx.els.statusPill.textContent = 'Exportados ' + ctx.state.resolved.features.length + ' polígonos sin solapamientos.';
  ctx.els.statusPill.classList.remove('ok', 'warn', 'err');
  ctx.els.statusPill.classList.add('ok');
}
