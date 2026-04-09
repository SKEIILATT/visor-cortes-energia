/**
 * editor.js — Módulo de edición geométrica con Leaflet-Geoman
 *
 * Gestiona: edición de vértices, dibujo, corte, borrado,
 * seguimiento de cambios y exportación de GeoJSON editado.
 */

// Mapeo subCapa → featureId para rastrear qué polígono fue editado
const layerFeatureMap = new Map();

/* ── Init ────────────────────────────────────────────────────────────── */

export function initEditor(ctx) {
  if (!ctx.state.map.pm) {
    console.warn('[editor] Leaflet-Geoman no está disponible.');
    return;
  }

  ctx.state.editor = {
    editedIds:      new Set(),   // IDs de features modificados
    drawnFeatures:  [],          // {layer, feature} de polígonos nuevos
    activeMode:     null,        // 'vertices'|'drag'|'cut'|'delete'|'draw-Polygon'|'draw-Line'
  };

  ctx.state.map.pm.setGlobalOptions({
    allowSelfIntersection: false,
    snappable: true,
    snapDistance: 10,
    preventMarkerRemoval: false,
  });

  // Cuando Geoman termina de dibujar un nuevo elemento
  ctx.state.map.on('pm:create', function (e) {
    _onLayerCreated(ctx, e);
  });

  // Cuando Geoman elimina un elemento en modo borrado
  ctx.state.map.on('pm:remove', function () {
    _refreshStatus(ctx);
  });
}

/** Debe llamarse DESPUÉS de buildFeatureLayers para construir el mapa inverso */
export function buildLayerMap(ctx) {
  layerFeatureMap.clear();
  ctx.state.features.forEach(function (feat) {
    if (!feat.layer) return;
    feat.layer.eachLayer(function (sub) {
      layerFeatureMap.set(sub, feat.id);
    });
  });
}

/* ── Modos de edición ────────────────────────────────────────────────── */

export function activateVertexEdit(ctx) {
  _disableAll(ctx);
  _setActive(ctx, 'vertices');

  ctx.state.features.forEach(function (feat) {
    if (!feat.layer) return;
    feat.layer.eachLayer(function (sub) {
      if (!sub.pm) return;
      sub.pm.enable({ allowSelfIntersection: false });
      sub.on('pm:edit', function () {
        ctx.state.editor.editedIds.add(feat.id);
        _refreshStatus(ctx);
      });
    });
  });

  // También los recién dibujados
  ctx.state.editor.drawnFeatures.forEach(function (item) {
    if (item.layer.pm) item.layer.pm.enable({ allowSelfIntersection: false });
  });

  _setStatus('Edición activa — arrastra los vértices para moldear las geometrías.');
}

export function activateDragMode(ctx) {
  _disableAll(ctx);
  _setActive(ctx, 'drag');
  ctx.state.map.pm.enableGlobalDragMode();
  _setStatus('Modo mover — arrastra un polígono completo para reubicarlo.');
}

export function activateDeleteMode(ctx) {
  _disableAll(ctx);
  _setActive(ctx, 'delete');
  ctx.state.map.pm.enableGlobalRemovalMode();
  _setStatus('Modo eliminar — haz clic en un polígono para borrarlo del mapa.');
}

export function activateCutMode(ctx) {
  _disableAll(ctx);
  _setActive(ctx, 'cut');
  ctx.state.map.pm.enableGlobalCutMode();
  _setStatus('Modo cortar — dibuja una forma encima del polígono para recortarlo.');
}

export function startDraw(ctx, shape) {
  _disableAll(ctx);
  _setActive(ctx, 'draw-' + shape);
  ctx.state.map.pm.enableDraw(shape, {
    snappable: true,
    allowSelfIntersection: false,
    finishOn: 'dblclick',
  });
  const labels = { Polygon: 'polígono', Line: 'línea', Marker: 'punto' };
  _setStatus('Dibujando ' + (labels[shape] || shape.toLowerCase()) +
    ' — haz clic para añadir puntos, doble clic para cerrar.');
}

export function finishEditing(ctx) {
  _disableAll(ctx);
  _refreshStatus(ctx);
}

/** Llamado al salir del modo herramientas */
export function exitEditorMode(ctx) {
  _disableAll(ctx);
}

/* ── Exportar GeoJSON ────────────────────────────────────────────────── */

export function exportOriginalGeoJSON(ctx) {
  _downloadJson(ctx.state.geojson, _baseName(ctx) + '_original.geojson');
}

export function exportModifiedGeoJSON(ctx) {
  const features = [];

  // Features existentes (con ediciones aplicadas)
  ctx.state.features.forEach(function (feat) {
    if (!feat.layer) { features.push(feat.feature); return; }
    try {
      const fc = feat.layer.toGeoJSON();            // LayerGroup → FeatureCollection
      if (fc && fc.features && fc.features.length) {
        features.push({
          type: 'Feature',
          properties: feat.feature.properties || {},
          geometry: fc.features[0].geometry,        // geometría actual (editada)
        });
        return;
      }
    } catch (_) {}
    features.push(feat.feature);
  });

  // Features nuevos dibujados por el usuario
  ctx.state.editor.drawnFeatures.forEach(function (item) {
    try { features.push(item.layer.toGeoJSON()); } catch (_) {}
  });

  const geojson = { type: 'FeatureCollection', features: features };
  _downloadJson(geojson, _baseName(ctx) + '_editado.geojson');
}

/* ── Internos ────────────────────────────────────────────────────────── */

function _onLayerCreated(ctx, e) {
  const layer = e.layer;
  if (!layer) return;
  const feature = layer.toGeoJSON();
  feature.properties = feature.properties || {};
  ctx.state.editor.drawnFeatures.push({ layer, feature });
  // Habilitar edición inmediata del recién creado
  if (layer.pm) {
    layer.pm.enable({ allowSelfIntersection: false });
    layer.on('pm:edit', function () { _refreshStatus(ctx); });
  }
  _refreshStatus(ctx);
}

function _disableAll(ctx) {
  if (!ctx.state.map.pm) return;

  // Desactivar draw
  try { ctx.state.map.pm.disableDraw(); } catch (_) {}

  // Desactivar edición de vértices en features existentes
  ctx.state.features.forEach(function (feat) {
    if (!feat.layer) return;
    feat.layer.eachLayer(function (sub) {
      try { if (sub.pm && sub.pm.enabled()) sub.pm.disable(); } catch (_) {}
    });
  });

  // Desactivar edición en features nuevos
  if (ctx.state.editor) {
    ctx.state.editor.drawnFeatures.forEach(function (item) {
      try { if (item.layer.pm && item.layer.pm.enabled()) item.layer.pm.disable(); } catch (_) {}
    });
  }

  // Desactivar modos globales
  try { if (ctx.state.map.pm.globalDragModeEnabled())    ctx.state.map.pm.disableGlobalDragMode(); } catch (_) {}
  try { if (ctx.state.map.pm.globalRemovalModeEnabled()) ctx.state.map.pm.disableGlobalRemovalMode(); } catch (_) {}
  try { if (ctx.state.map.pm.globalCutModeEnabled())     ctx.state.map.pm.disableGlobalCutMode(); } catch (_) {}

  // Reset visual de botones
  ['btn-edit-vertices', 'btn-edit-drag', 'btn-edit-cut', 'btn-edit-delete',
   'btn-draw-Polygon', 'btn-draw-Line'].forEach(function (id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('btn-mini-primary');
  });

  if (ctx.state.editor) ctx.state.editor.activeMode = null;
}

function _setActive(ctx, mode) {
  if (ctx.state.editor) ctx.state.editor.activeMode = mode;
  const modeToBtn = {
    vertices:       'btn-edit-vertices',
    drag:           'btn-edit-drag',
    cut:            'btn-edit-cut',
    delete:         'btn-edit-delete',
    'draw-Polygon': 'btn-draw-Polygon',
    'draw-Line':    'btn-draw-Line',
  };
  const btnId = modeToBtn[mode];
  if (btnId) {
    const el = document.getElementById(btnId);
    if (el) el.classList.add('btn-mini-primary');
  }
}

function _setStatus(text) {
  const el = document.getElementById('editor-status');
  if (el) el.textContent = text;
}

function _refreshStatus(ctx) {
  if (!ctx.state.editor) return;
  const edited = ctx.state.editor.editedIds.size;
  const drawn  = ctx.state.editor.drawnFeatures.length;
  const parts  = [];
  if (edited > 0) parts.push(edited + (edited === 1 ? ' polígono editado' : ' polígonos editados'));
  if (drawn  > 0) parts.push(drawn  + (drawn  === 1 ? ' polígono nuevo'   : ' polígonos nuevos'));
  _setStatus(parts.length ? parts.join(' · ') + '.' : 'Sin cambios.');
}

function _baseName(ctx) {
  const rec = ctx.state.datasetRecord;
  return rec && rec.name
    ? rec.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_\-]/g, '_')
    : 'dataset';
}

function _downloadJson(obj, fileName) {
  const text = JSON.stringify(obj, null, 2);
  const blob = new Blob([text], { type: 'application/geo+json;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function () { URL.revokeObjectURL(url); }, 1200);
}
