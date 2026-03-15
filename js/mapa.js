(function initMapPage() {
  'use strict';

  const GROUP_COLORS = [
    '#3b82f6', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6',
    '#06b6d4', '#22c55e', '#f97316', '#14b8a6', '#e11d48',
    '#0ea5e9', '#65a30d', '#a855f7', '#0284c7', '#d97706'
  ];
  const GAP_FILL = 50;

  const state = {
    datasetId: null,
    datasetRecord: null,
    geojson: null,
    analysis: null,
    map: null,
    mapBounds: null,
    groups: new Map(),
    features: [],
    minute: -1,
    mode: 'group',
    geomMode: 'detail',
    playTimer: null,
    speed: 1,
    theme: 'light',
    hashSyncBlocked: false,
    pendingHashState: null,
    incidences: {
      points: [],
      layer: null,
      visible: true,
      clustered: true,
      fileName: null,
    },
    fused: {
      built: false,
      groupLayers: new Map(),
    },
    resolved: {
      done: false,
      features: [],
      previewLayer: null,
    },
    compareMode: 'both',   // 'before' | 'both' | 'after'
  };

  const els = {
    title: document.getElementById('hdr-title'),
    subtitle: document.getElementById('hdr-sub'),
    statFeatures: document.getElementById('s-features'),
    statGroups: document.getElementById('s-groups'),
    statAffected: document.getElementById('s-affected'),

    btnTheme: document.getElementById('btn-theme'),
    btnExportFused: document.getElementById('btn-export-fused'),
    btnResolveOverlaps: document.getElementById('btn-resolve-overlaps'),
    btnExportResolved: document.getElementById('btn-export-resolved'),
    comparePanel: document.getElementById('compare-panel'),
    btnCmpBefore: document.getElementById('btn-cmp-before'),
    btnCmpBoth: document.getElementById('btn-cmp-both'),
    btnCmpAfter: document.getElementById('btn-cmp-after'),
    btnFit: document.getElementById('btn-fit'),
    btnPrint: document.getElementById('btn-print'),
    btnBack: document.getElementById('btn-back'),

    sidebar: document.getElementById('sidebar'),
    btnSidebar: document.getElementById('btn-sidebar'),

    groupSearch: document.getElementById('group-search'),
    btnAll: document.getElementById('btn-all'),
    btnNone: document.getElementById('btn-none'),
    btnInvert: document.getElementById('btn-invert'),
    btnAffectedOnly: document.getElementById('btn-affected-only'),

    btnModeGroup: document.getElementById('btn-mode-group'),
    btnModeOutage: document.getElementById('btn-mode-outage'),
    btnGeomToggle: document.getElementById('btn-geom-toggle'),

    groupsTitle: document.getElementById('groups-title'),
    groupsVisible: document.getElementById('groups-visible'),
    groupsList: document.getElementById('groups-list'),

    btnIncLoad: document.getElementById('btn-inc-load'),
    incFileInput: document.getElementById('inc-file-input'),
    btnIncToggle: document.getElementById('btn-inc-toggle'),
    btnIncCluster: document.getElementById('btn-inc-cluster'),
    btnIncClear: document.getElementById('btn-inc-clear'),
    incMeta: document.getElementById('inc-meta'),

    timeline: document.getElementById('timeline'),
    timelineTime: document.getElementById('timeline-time'),
    timelineBadge: document.getElementById('timeline-badge'),
    timelineSlider: document.getElementById('timeline-slider'),
    timelineTrack: document.getElementById('timeline-track'),
    btnTlToggle: document.getElementById('btn-tl-toggle'),
    btnPlay: document.getElementById('btn-play'),
    btnSpd1: document.getElementById('btn-spd-1'),
    btnSpd4: document.getElementById('btn-spd-4'),
    btnSpd8: document.getElementById('btn-spd-8'),
    btnTimeClear: document.getElementById('btn-time-clear'),

    rankTitle: document.getElementById('rank-title'),
    rankSub: document.getElementById('rank-sub'),
    rankList: document.getElementById('rank-list'),

    info: document.getElementById('info'),
    infoTitle: document.getElementById('info-title'),
    infoContent: document.getElementById('info-content'),
    btnInfoClose: document.getElementById('btn-info-close'),

    statusPill: document.getElementById('status-pill'),
  };

  boot().catch(function onBootError(error) {
    setStatus('Error inicializando el mapa: ' + (error && error.message ? error.message : 'desconocido'), 'err');
  });

  async function boot() {
    bindUI();
    updateGeomToggleButton();
    applyTheme(loadThemePreference());
    setStatus('Cargando dataset...', 'warn');

    state.pendingHashState = readHashState();
    state.datasetId = getDatasetIdFromQuery();

    const record = await resolveDatasetRecord();
    if (!record) {
      window.location.replace('index.html');
      return;
    }

    state.datasetRecord = record;
    state.geojson = safeParseJson(record.text);

    if (!state.geojson || state.geojson.type !== 'FeatureCollection' || !Array.isArray(state.geojson.features)) {
      throw new Error('El dataset guardado no es un FeatureCollection válido.');
    }

    const datasetName = record.name || 'Dataset';
    document.title = datasetName + ' | Visor GeoJSON';
    els.title.textContent = datasetName;

    state.map = createMap();

    setStatus('Analizando capas y propiedades...', 'warn');
    try {
      state.analysis = await analyzeGeojsonInWorker(state.geojson);
    } catch (_) {
      // Fallback para contextos donde Worker no está permitido (por ejemplo file://).
      state.analysis = analyzeGeojsonFallback(state.geojson);
      setStatus('Worker no disponible, usando análisis local.', 'warn');
    }

    prepareGroups();
    buildFeatureLayers();
    buildTimelineTrack();
    applyPendingHashState();

    updateHeader();
    renderGroupList();
    refreshAll();
    fitInitialView();

    const by = state.analysis.groupByLabel || null;
    if (by) {
      const lbl = by.charAt(0).toUpperCase() + by.slice(1);
      els.groupsTitle.textContent = lbl + 's';
      els.groupSearch.placeholder = 'Buscar ' + lbl.toLowerCase() + '...';
    } else {
      els.groupsTitle.textContent = 'Grupos';
      els.groupSearch.placeholder = 'Buscar grupo...';
    }
    els.subtitle.textContent =
      (by || 'sin agrupación') + ' · ' +
      state.analysis.counts.features.toLocaleString('es-EC') + ' zonas · ' +
      state.analysis.counts.groups + ' grupos';

    if (!state.analysis.outageAvailable) {
      if (els.btnModeOutage) els.btnModeOutage.disabled = true;
      els.timelineBadge.textContent = 'dataset sin cortes_horas';
    }

    els.btnResolveOverlaps.hidden = false;
    setStatus('Listo', 'ok');
  }

  function bindUI() {
    els.btnTheme.addEventListener('click', toggleTheme);
    document.getElementById('btn-export-fused').addEventListener('click', exportFusedGeoJSON);
    els.btnResolveOverlaps.addEventListener('click', runOverlapResolver);
    els.btnExportResolved.addEventListener('click', exportResolvedGeoJSON);
    els.btnCmpBefore.addEventListener('click', function () { setCompareMode('before'); });
    els.btnCmpBoth.addEventListener('click', function () { setCompareMode('both'); });
    els.btnCmpAfter.addEventListener('click', function () { setCompareMode('after'); });
    els.btnFit.addEventListener('click', function () {
      if (state.mapBounds && state.mapBounds.isValid()) state.map.fitBounds(state.mapBounds.pad(0.06));
    });
    els.btnPrint.addEventListener('click', function () { window.print(); });
    els.btnBack.addEventListener('click', function () { window.location.href = 'index.html'; });

    els.btnSidebar.addEventListener('click', function () {
      els.sidebar.classList.toggle('open');
    });

    els.groupSearch.addEventListener('input', renderGroupList);
    els.btnAll.addEventListener('click', function () { setAllGroupsVisibility(true); });
    els.btnNone.addEventListener('click', function () { setAllGroupsVisibility(false); });
    els.btnInvert.addEventListener('click', invertGroupsVisibility);
    els.btnAffectedOnly.addEventListener('click', showAffectedOnly);

    if (els.btnModeGroup) {
      els.btnModeGroup.addEventListener('click', function () { setMode('group'); });
    }
    if (els.btnModeOutage) {
      els.btnModeOutage.addEventListener('click', function () { setMode('outage'); });
    }
    if (els.btnGeomToggle) {
      els.btnGeomToggle.addEventListener('click', toggleGeometryMode);
    }

    els.btnIncLoad.addEventListener('click', function () {
      els.incFileInput.click();
    });
    els.incFileInput.addEventListener('change', onIncFileChange);
    els.btnIncToggle.addEventListener('click', toggleIncidenceLayer);
    els.btnIncCluster.addEventListener('click', toggleIncidenceCluster);
    els.btnIncClear.addEventListener('click', clearIncidences);

    els.timelineSlider.addEventListener('input', function () {
      setMinute(Number(els.timelineSlider.value));
    });
    els.btnPlay.addEventListener('click', togglePlayback);
    els.btnSpd1.addEventListener('click', function () { setPlaybackSpeed(1); });
    els.btnSpd4.addEventListener('click', function () { setPlaybackSpeed(4); });
    els.btnSpd8.addEventListener('click', function () { setPlaybackSpeed(8); });
    els.btnTimeClear.addEventListener('click', function () { setMinute(-1); });
    els.btnTlToggle.addEventListener('click', function () {
      const collapsed = els.timeline.classList.toggle('collapsed');
      els.btnTlToggle.textContent = collapsed ? '+' : '−';
      els.btnTlToggle.title = collapsed ? 'Expandir timeline' : 'Colapsar timeline';
    });

    els.btnInfoClose.addEventListener('click', closeInfoPanel);
  }

  function getDatasetIdFromQuery() {
    const params = new URLSearchParams(window.location.search);
    return params.get('dataset');
  }

  async function resolveDatasetRecord() {
    if (state.datasetId) {
      return window.GeoStore.getDataset(state.datasetId);
    }

    const latest = await window.GeoStore.getLatestDataset();
    if (latest) {
      state.datasetId = latest.id;
    }
    return latest;
  }

  function safeParseJson(raw) {
    try {
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }

  function createMap() {
    const map = L.map('map', { preferCanvas: true, zoomControl: false });
    // Leaflet requiere una vista inicial antes de agregar capas vectoriales.
    map.setView([-2.16, -79.9], 11);
    L.control.zoom({ position: 'bottomright' }).addTo(map);

    const layers = {
      'Carto Dark': L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '© Carto',
        maxZoom: 19,
      }),
      'Carto Light': L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '© Carto',
        maxZoom: 19,
      }),
      'OpenStreetMap': L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap',
        maxZoom: 19,
      }),
      'Satélite': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: '© Esri',
        maxZoom: 18,
      }),
    };

    layers['Carto Dark'].addTo(map);
    L.control.layers(layers, {}, { position: 'topleft' }).addTo(map);
    L.control.scale({ imperial: false, position: 'bottomright' }).addTo(map);

    L.Control.geocoder({
      defaultMarkGeocode: false,
      position: 'topleft',
      placeholder: 'Buscar lugar',
      geocoder: L.Control.Geocoder.nominatim(),
    }).on('markgeocode', function (e) {
      map.fitBounds(e.geocode.bbox);
    }).addTo(map);

    map.on('moveend', debounce(syncHashState, 320));
    map.on('zoomend', debounce(syncHashState, 320));
    map.on('click', closeInfoPanel);

    return map;
  }

  function analyzeGeojsonInWorker(geojson) {
    return new Promise(function (resolve, reject) {
      const worker = new Worker('js/workers/geo.worker.js');
      const timeout = setTimeout(function () {
        worker.terminate();
        reject(new Error('El análisis tardó demasiado.'));
      }, 30000);

      worker.onmessage = function (event) {
        const msg = event && event.data ? event.data : null;
        if (!msg) {
          return;
        }

        if (msg.type === 'ok') {
          clearTimeout(timeout);
          worker.terminate();
          resolve(msg.result);
        } else if (msg.type === 'error') {
          clearTimeout(timeout);
          worker.terminate();
          reject(new Error(msg.error || 'Error analizando GeoJSON'));
        }
      };

      worker.onerror = function (err) {
        clearTimeout(timeout);
        worker.terminate();
        reject(err.error || new Error('Fallo del worker'));
      };

      worker.postMessage({ type: 'analyze', geojson: geojson });
    });
  }

  function prepareGroups() {
    const groups = state.analysis.groups || [];
    for (let i = 0; i < groups.length; i += 1) {
      const g = groups[i];
      const slotRanges = [];
      const slotSeen = new Set();

      for (let j = 0; j < g.featureIds.length; j += 1) {
        const fid = g.featureIds[j];
        const meta = state.analysis.featureMeta && state.analysis.featureMeta[fid];
        if (!meta || !Array.isArray(meta.slots)) continue;
        for (let k = 0; k < meta.slots.length; k += 1) {
          const s = meta.slots[k];
          const key = s[0] + '_' + s[1];
          if (slotSeen.has(key)) continue;
          slotSeen.add(key);
          slotRanges.push([s[0], s[1]]);
        }
      }

      state.groups.set(g.key, {
        key: g.key,
        visible: true,
        color: GROUP_COLORS[i % GROUP_COLORS.length],
        featureIds: g.featureIds.slice(),
        featureCount: g.featureCount,
        slots: slotRanges,
        slotCount: g.slotCount,
        totalOutageMin: g.totalOutageMin,
        hasOutage: g.hasOutage,
      });
    }
  }

  function buildFeatureLayers() {
    const feats = state.geojson.features || [];
    const metaList = state.analysis.featureMeta || [];
    const renderer = L.canvas({ padding: 0.5 });

    state.mapBounds = null;
    state.features = [];

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
        style: function () { return getPathStyle(meta, false); },
        pointToLayer: function (_, latlng) { return L.circleMarker(latlng, getPointStyle(meta, false)); },
      });

      layer.on('mouseover', handleFeatureHover(i, true));
      layer.on('mouseout', handleFeatureHover(i, false));
      layer.on('click', handleFeatureClick(i));
      layer.bindTooltip(buildFeatureTooltip(meta), { sticky: true, direction: 'top', opacity: 0.96 });
      layer.addTo(state.map);

      state.features.push({
        id: i,
        feature: feature,
        meta: meta,
        layer: layer,
        matchesFilter: true,
        hovered: false,
      });

      extendGlobalBounds(layer);
    }
  }

  function buildFeatureTooltip(meta) {
    const label = escapeHtml(meta.groupKey || 'N/A');
    const pieces = ['<strong>' + label + '</strong>'];
    if (meta.hasOutage) pieces.push('Franjas: ' + meta.slotCount);
    return pieces.join('<br>');
  }

  function handleFeatureHover(featureId, hovering) {
    return function () {
      const feat = state.features[featureId];
      if (!feat) return;
      feat.hovered = hovering;
      applyStyleToFeature(feat);
    };
  }

  function handleFeatureClick(featureId) {
    return function (evt) {
      L.DomEvent.stopPropagation(evt);
      openInfoPanel(featureId);
    };
  }

  function extendGlobalBounds(layer) {
    if (!layer || typeof layer.getBounds !== 'function') return;
    const bounds = layer.getBounds();
    if (!bounds || !bounds.isValid()) return;
    if (!state.mapBounds) {
      state.mapBounds = bounds;
    } else {
      state.mapBounds.extend(bounds);
    }
  }
  function fitInitialView() {
    if (state.pendingHashState && state.pendingHashState.view) {
      const v = state.pendingHashState.view;
      state.map.setView([v.lat, v.lng], v.z);
      return;
    }

    if (state.mapBounds && state.mapBounds.isValid()) {
      state.map.fitBounds(state.mapBounds.pad(0.06));
      return;
    }

    state.map.setView([-2.16, -79.9], 11);
  }

  function getPathStyle(meta, hover) {
    const isLine = /LineString/i.test(meta.geometryType || '');
    const activeNow = state.minute >= 0 && isMetaActiveAt(meta, state.minute);

    let color = getColorForMeta(meta);
    let fill = color;
    let weight = isLine ? 3 : 1.2;
    let fillOpacity = isLine ? 0 : 0.42;
    let opacity = 0.95;

    if (state.minute >= 0 && state.analysis.outageAvailable) {
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

    return {
      color: color,
      weight: weight,
      opacity: opacity,
      fillColor: fill,
      fillOpacity: fillOpacity,
    };
  }

  function getPointStyle(meta, hover) {
    const activeNow = state.minute >= 0 && isMetaActiveAt(meta, state.minute);

    let color = getColorForMeta(meta);
    let fill = color;
    let radius = hover ? 7 : 5;
    let fillOpacity = 0.8;

    if (state.minute >= 0 && state.analysis.outageAvailable) {
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

    return {
      color: color,
      fillColor: fill,
      weight: 1,
      radius: radius,
      fillOpacity: fillOpacity,
      opacity: 0.95,
    };
  }

  function getColorForMeta(meta) {
    if (state.mode === 'outage' && state.analysis.outageAvailable) {
      if (!meta.hasOutage) {
        return '#a8b0bc';
      }
      return outageHeatColor(meta.totalOutageMin);
    }

    const group = state.groups.get(meta.groupKey);
    return group ? group.color : '#3b82f6';
  }

  function outageHeatColor(totalMin) {
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

  function applyStyleToFeature(feat) {
    if (!feat || !feat.layer || typeof feat.layer.eachLayer !== 'function') return;

    const pathStyle = getPathStyle(feat.meta, feat.hovered);
    const pointStyle = getPointStyle(feat.meta, feat.hovered);

    feat.layer.eachLayer(function (sub) {
      if (sub instanceof L.CircleMarker) {
        sub.setStyle(pointStyle);
        if (typeof sub.setRadius === 'function') {
          sub.setRadius(pointStyle.radius);
        }
        return;
      }

      if (sub && typeof sub.setStyle === 'function') {
        sub.setStyle(pathStyle);
      }
    });
  }

  function refreshFeatureStyles() {
    if (state.geomMode === 'fused') {
      refreshFusedStyles();
      return;
    }
    for (let i = 0; i < state.features.length; i += 1) {
      applyStyleToFeature(state.features[i]);
    }
  }

  function shouldFeatureBeVisible(feat) {
    const group = state.groups.get(feat.meta.groupKey);
    return !!(group && group.visible && feat.matchesFilter);
  }

  function refreshFeatureVisibility() {
    if (state.geomMode === 'fused') {
      refreshFusedVisibility();
      return;
    }

    for (let i = 0; i < state.features.length; i += 1) {
      const feat = state.features[i];
      const visible = shouldFeatureBeVisible(feat);
      const onMap = state.map.hasLayer(feat.layer);

      if (visible && !onMap) feat.layer.addTo(state.map);
      if (!visible && onMap) state.map.removeLayer(feat.layer);
    }

    if (state.fused.built) {
      state.fused.groupLayers.forEach(function (layer) {
        if (state.map.hasLayer(layer)) state.map.removeLayer(layer);
      });
    }
  }

  function toggleGeometryMode() {
    state.geomMode = state.geomMode === 'detail' ? 'fused' : 'detail';
    if (state.geomMode === 'fused') ensureFusedLayersBuilt();
    updateGeomToggleButton();
    refreshAll();
    setStatus(state.geomMode === 'fused' ? 'Vista fusionada v4 activada.' : 'Vista detallada activada.', 'ok');
  }

  function updateGeomToggleButton() {
    if (!els.btnGeomToggle) return;
    const isFused = state.geomMode === 'fused';
    els.btnGeomToggle.textContent = 'Vista fusionada v4: ' + (isFused ? 'ON' : 'OFF');
    els.btnGeomToggle.classList.toggle('btn-mini-primary', isFused);
    els.btnExportFused.hidden = !isFused;
  }

  function ensureFusedLayersBuilt() {
    if (state.fused.built) return;
    buildFusedLayers();
    state.fused.built = true;
  }

  function buildFusedLayers() {
    state.fused.groupLayers = new Map();
    const renderer = L.canvas({ padding: 0.5 });

    state.groups.forEach(function (group) {
      const feats = group.featureIds
        .map(function (id) { return state.features[id] ? state.features[id].feature : null; })
        .filter(Boolean);

      const polys = feats.filter(function (f) {
        return /Polygon/i.test((f.geometry && f.geometry.type) || '');
      });
      const points = feats.filter(function (f) {
        return /Point/i.test((f.geometry && f.geometry.type) || '');
      });

      const fg = L.featureGroup();
      const gMeta = getGroupMeta(group.key);

      if (polys.length) {
        const dissolved = dissolvePolygons(polys);
        const polyLayer = L.geoJSON(dissolved, {
          renderer: renderer,
          style: function () { return getPathStyle(gMeta, false); },
        });
        polyLayer.on('mouseover', function () { applyStyleToFusedGroup(group.key, true); });
        polyLayer.on('mouseout', function () { applyStyleToFusedGroup(group.key, false); });
        polyLayer.on('click', function (evt) {
          L.DomEvent.stopPropagation(evt);
          const firstId = group.featureIds[0];
          if (Number.isFinite(firstId)) openInfoPanel(firstId);
        });
        polyLayer.addTo(fg);
      }

      if (points.length) {
        const pLayer = L.geoJSON({ type: 'FeatureCollection', features: points }, {
          renderer: renderer,
          pointToLayer: function (_, latlng) { return L.circleMarker(latlng, getPointStyle(gMeta, false)); },
        });
        pLayer.on('mouseover', function () { applyStyleToFusedGroup(group.key, true); });
        pLayer.on('mouseout', function () { applyStyleToFusedGroup(group.key, false); });
        pLayer.on('click', function (evt) {
          L.DomEvent.stopPropagation(evt);
          const firstId = group.featureIds[0];
          if (Number.isFinite(firstId)) openInfoPanel(firstId);
        });
        pLayer.addTo(fg);
      }

      state.fused.groupLayers.set(group.key, fg);
    });
  }

  function getGroupMeta(groupKey) {
    const g = state.groups.get(groupKey);
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

  function applyStyleToFusedGroup(groupKey, hover) {
    const fg = state.fused.groupLayers.get(groupKey);
    if (!fg) return;
    const meta = getGroupMeta(groupKey);
    const pathStyle = getPathStyle(meta, hover);
    const pointStyle = getPointStyle(meta, hover);

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

  function refreshFusedStyles() {
    if (!state.fused.built) return;
    state.fused.groupLayers.forEach(function (_, key) {
      applyStyleToFusedGroup(key, false);
    });
  }

  function refreshFusedVisibility() {
    ensureFusedLayersBuilt();

    for (let i = 0; i < state.features.length; i += 1) {
      const feat = state.features[i];
      if (state.map.hasLayer(feat.layer)) state.map.removeLayer(feat.layer);
    }

    state.groups.forEach(function (group) {
      const fg = state.fused.groupLayers.get(group.key);
      if (!fg) return;
      const onMap = state.map.hasLayer(fg);
      if (group.visible && !onMap) fg.addTo(state.map);
      if (!group.visible && onMap) state.map.removeLayer(fg);
    });
  }

  function dissolvePolygons(polys) {
    if (!polys || !polys.length) return null;
    if (typeof turf === 'undefined') return fillHoles(polys[0]);

    let diss = null;
    try {
      const cleaned = polys.map(function (f) {
        const nh = fillHoles(f);
        try {
          return turf.buffer(nh, GAP_FILL, { units: 'meters' }) || nh;
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

  function fillHoles(feature) {
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

  function setAllGroupsVisibility(visible) {
    state.groups.forEach(function (g) { g.visible = visible; });
    refreshAfterVisibilityChange();
  }

  function invertGroupsVisibility() {
    state.groups.forEach(function (g) { g.visible = !g.visible; });
    refreshAfterVisibilityChange();
  }

  function showAffectedOnly() {
    if (state.minute < 0) {
      setStatus('Activa el timeline para usar "Solo afectadas".', 'warn');
      return;
    }

    state.groups.forEach(function (group) {
      group.visible = isGroupAffectedAt(group.key, state.minute);
    });

    refreshAfterVisibilityChange();
  }

  function setGroupVisibility(groupKey, visible) {
    const g = state.groups.get(groupKey);
    if (!g) return;
    g.visible = visible;
    refreshAfterVisibilityChange();
  }

  function refreshAfterVisibilityChange() {
    refreshFeatureVisibility();
    renderGroupList();
    updateHeader();
    updateRanking();
    syncHashState();
  }

  function renderGroupList() {
    const q = (els.groupSearch.value || '').trim().toLowerCase();
    const rows = Array.from(state.groups.values())
      .filter(function (g) { return q ? g.key.toLowerCase().includes(q) : true; })
      .sort(function (a, b) { return a.key.localeCompare(b.key, 'es', { sensitivity: 'base' }); });

    const html = [];
    for (let i = 0; i < rows.length; i += 1) {
      const g = rows[i];
      const visibleFeatures = countVisibleFeaturesInGroup(g.key);
      const outageH = (g.totalOutageMin / 60).toFixed(1);
      html.push(
        '<div class="group-item ' + (g.visible ? '' : 'off') + '" data-key="' + escapeHtml(g.key) + '">' +
          '<input class="group-check" type="checkbox" ' + (g.visible ? 'checked' : '') + '>' +
          '<span class="group-color" style="background:' + escapeHtml(g.color) + '"></span>' +
          '<span class="group-name" title="' + escapeHtml(g.key) + '">' + escapeHtml(g.key) + '</span>' +
          '<span class="group-meta">' + visibleFeatures + '/' + g.featureCount + ' · ' + outageH + 'h</span>' +
        '</div>'
      );
    }

    els.groupsList.innerHTML = html.join('');

    const items = els.groupsList.querySelectorAll('.group-item');
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      const key = item.getAttribute('data-key') || '';
      const check = item.querySelector('.group-check');

      check.addEventListener('click', function (event) { event.stopPropagation(); });
      check.addEventListener('change', function () { setGroupVisibility(key, check.checked); });

      item.addEventListener('click', function () {
        check.checked = !check.checked;
        setGroupVisibility(key, check.checked);
      });
    }

    const total = state.groups.size;
    const visible = Array.from(state.groups.values()).filter(function (g) { return g.visible; }).length;
    els.groupsVisible.textContent = visible + '/' + total;
  }

  function countVisibleFeaturesInGroup(groupKey) {
    const g = state.groups.get(groupKey);
    if (!g) return 0;

    let count = 0;
    for (let i = 0; i < g.featureIds.length; i += 1) {
      const feat = state.features[g.featureIds[i]];
      if (feat && feat.matchesFilter) count += 1;
    }

    return count;
  }

  function setMinute(minute) {
    if (minute < 0) {
      state.minute = -1;
      els.timelineTime.textContent = '--:--';
      els.timelineBadge.textContent = 'sin filtro horario';
      els.timelineSlider.value = '0';
      stopPlayback();
    } else {
      state.minute = Math.max(0, Math.min(1440, minute));
      els.timelineTime.textContent = formatMinute(state.minute);
      els.timelineSlider.value = String(state.minute);

      const affected = countAffectedGroups(state.minute);
      els.timelineBadge.textContent = affected > 0
        ? affected + ' grupos afectados en este momento'
        : 'sin grupos afectados en este momento';
    }

    refreshFeatureStyles();
    updateHeader();
    updateRanking();
    syncHashState();
  }

  function togglePlayback() {
    if (state.playTimer) {
      stopPlayback();
      return;
    }

    if (state.minute < 0) setMinute(0);

    state.playTimer = window.setInterval(function () {
      let next = state.minute + (15 * state.speed);
      if (next > 1440) next = 0;
      setMinute(next);
    }, 320);

    els.btnPlay.textContent = 'Pausar';
  }

  function stopPlayback() {
    if (state.playTimer) {
      clearInterval(state.playTimer);
      state.playTimer = null;
    }
    els.btnPlay.textContent = 'Play';
  }

  function setPlaybackSpeed(speed) {
    state.speed = speed;
    els.btnSpd1.classList.toggle('btn-mini-primary', speed === 1);
    els.btnSpd4.classList.toggle('btn-mini-primary', speed === 4);
    els.btnSpd8.classList.toggle('btn-mini-primary', speed === 8);
  }

  function setMode(mode) {
    state.mode = mode;

    if (els.btnModeGroup && els.btnModeOutage) {
      els.btnModeGroup.classList.toggle('btn-mini-primary', mode === 'group');
      els.btnModeOutage.classList.toggle('btn-mini-primary', mode === 'outage');
    }

    refreshFeatureStyles();
    updateRanking();
    syncHashState();
  }

  function buildTimelineTrack() {
    const buckets = state.analysis.buckets || [];
    const max = Math.max.apply(null, buckets.concat([1]));

    const bars = [];
    for (let i = 0; i < buckets.length; i += 1) {
      const val = buckets[i];
      const opacity = Math.max(0.08, val / max);
      const x = ((i / 96) * 100).toFixed(3);
      const w = (100 / 96).toFixed(3);
      bars.push('<rect x="' + x + '" y="0" width="' + w + '" height="10" fill="#c0392b" opacity="' + opacity.toFixed(3) + '"></rect>');
    }

    els.timelineTrack.innerHTML = bars.join('');
  }

  function updateHeader() {
    const visibleFeatures = state.features.filter(function (feat) {
      return shouldFeatureBeVisible(feat);
    }).length;

    const visibleGroups = Array.from(state.groups.values()).filter(function (g) {
      return g.visible;
    }).length;

    const affected = state.minute >= 0 ? countAffectedGroups(state.minute) : countOutageGroups();

    els.statFeatures.textContent = visibleFeatures.toLocaleString('es-EC');
    els.statGroups.textContent = String(visibleGroups);
    els.statAffected.textContent = String(affected);
  }
  function countOutageGroups() {
    let c = 0;
    state.groups.forEach(function (g) { if (g.hasOutage) c += 1; });
    return c;
  }

  function countAffectedGroups(minute) {
    let c = 0;
    state.groups.forEach(function (g) {
      if (isGroupAffectedAt(g.key, minute)) c += 1;
    });
    return c;
  }

  function isGroupAffectedAt(groupKey, minute) {
    const group = state.groups.get(groupKey);
    if (!group) return false;

    for (let i = 0; i < group.featureIds.length; i += 1) {
      const feat = state.features[group.featureIds[i]];
      if (!feat || !feat.matchesFilter) continue;
      if (isMetaActiveAt(feat.meta, minute)) return true;
    }

    return false;
  }

  function isMetaActiveAt(meta, minute) {
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

  function updateRanking() {
    const rows = [];

    state.groups.forEach(function (group) {
      if (!group.visible) return;

      let metric;
      let label;

      if (state.minute >= 0) {
        const active = isGroupAffectedAt(group.key, state.minute);
        if (!active) return;
        metric = group.totalOutageMin;
        label = 'Activa en ' + formatMinute(state.minute);
      } else {
        if (!group.hasOutage) return;
        metric = group.totalOutageMin;
        label = (metric / 60).toFixed(1) + 'h acumuladas';
      }

      rows.push({ key: group.key, metric: metric, label: label });
    });

    rows.sort(function (a, b) { return b.metric - a.metric; });

    const top = rows.slice(0, 8);
    const max = top.length ? top[0].metric : 1;

    els.rankTitle.textContent = state.minute >= 0 ? 'Afectadas ahora' : 'Top zonas por cortes';
    els.rankSub.textContent = state.mode === 'outage' ? 'por horas' : 'por grupo';

    if (!top.length) {
      els.rankList.innerHTML = '<p class="muted">No hay datos para este estado.</p>';
      return;
    }

    const parts = [];
    for (let i = 0; i < top.length; i += 1) {
      const row = top[i];
      const pct = Math.max(8, Math.round((row.metric / max) * 100));
      parts.push(
        '<div class="rank-item" data-key="' + escapeHtml(row.key) + '">' +
          '<div class="rank-name">' + (i + 1) + '. ' + escapeHtml(row.key) + '</div>' +
          '<div class="rank-bar-wrap"><div class="rank-bar" style="width:' + pct + '%"></div></div>' +
          '<div class="rank-sub">' + escapeHtml(row.label) + '</div>' +
        '</div>'
      );
    }

    els.rankList.innerHTML = parts.join('');

    const items = els.rankList.querySelectorAll('.rank-item');
    for (let i = 0; i < items.length; i += 1) {
      items[i].addEventListener('click', function () {
        const key = items[i].getAttribute('data-key');
        focusGroup(key);
      });
    }
  }

  function focusGroup(groupKey) {
    const group = state.groups.get(groupKey);
    if (!group || !group.featureIds.length) return;

    let firstVisibleId = group.featureIds[0];
    for (let i = 0; i < group.featureIds.length; i += 1) {
      const id = group.featureIds[i];
      const feat = state.features[id];
      if (feat && feat.matchesFilter) {
        firstVisibleId = id;
        break;
      }
    }

    const feat = state.features[firstVisibleId];
    if (!feat) return;

    openInfoPanel(firstVisibleId);

    if (feat.layer && typeof feat.layer.getBounds === 'function') {
      const b = feat.layer.getBounds();
      if (b && b.isValid()) state.map.fitBounds(b.pad(0.25));
    }
  }

  function openInfoPanel(featureId) {
    const feat = state.features[featureId];
    if (!feat) return;

    const props = feat.feature && feat.feature.properties ? feat.feature.properties : {};
    const slots = feat.meta.slots || [];

    els.info.hidden = false;
    els.infoTitle.textContent = feat.meta.groupKey || 'Detalle';

    const rows = Object.keys(props)
      .slice(0, 30)
      .map(function (k) {
        const value = props[k] === null || props[k] === undefined ? '-' : String(props[k]);
        return '<div class="info-row"><span class="info-k">' + escapeHtml(k) + '</span><span class="info-v">' + escapeHtml(value) + '</span></div>';
      })
      .join('');

    const slotHtml = slots.length
      ? slots.map(function (s) {
          return '<span class="slot-chip">' + escapeHtml(formatMinute(s[0]) + ' - ' + formatMinute(s[1])) + '</span>';
        }).join('')
      : '<span class="muted">Sin franjas horarias</span>';

    const html =
      '<div class="info-grid">' +
        '<div class="info-row"><span class="info-k">Grupo</span><span class="info-v">' + escapeHtml(feat.meta.groupKey) + '</span></div>' +
        '<div class="info-row"><span class="info-k">Geometría</span><span class="info-v">' + escapeHtml(feat.meta.geometryType) + '</span></div>' +
        '<div class="info-row"><span class="info-k">Horas estimadas</span><span class="info-v">' + (feat.meta.totalOutageMin / 60).toFixed(1) + 'h</span></div>' +
      '</div>' +
      '<div class="info-block"><div class="panel-title">Cortes</div><div class="slot-list">' + slotHtml + '</div></div>' +
      '<div class="info-block"><div class="panel-title">Propiedades</div><div class="info-grid">' + rows + '</div></div>';

    els.infoContent.innerHTML = html;
  }

  function closeInfoPanel() {
    els.info.hidden = true;
  }

  function refreshAll() {
    refreshFeatureVisibility();
    refreshFeatureStyles();
    renderGroupList();
    updateHeader();
    updateRanking();
    syncHashState();
  }

  function onShareClick() {
    syncHashState();
    const url = window.location.href;

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url)
        .then(function () { setStatus('Enlace copiado al portapapeles.', 'ok'); })
        .catch(function () { fallbackShare(url); });
      return;
    }

    fallbackShare(url);
  }

  function fallbackShare(url) {
    window.prompt('Copia este enlace:', url);
  }

  function syncHashState() {
    if (!state.map || state.hashSyncBlocked) return;

    const center = state.map.getCenter();
    const zoom = state.map.getZoom();

    const hashParams = new URLSearchParams();
    hashParams.set('lat', center.lat.toFixed(6));
    hashParams.set('lng', center.lng.toFixed(6));
    hashParams.set('z', String(zoom));
    hashParams.set('m', String(state.minute));
    hashParams.set('mode', state.mode);
    hashParams.set('theme', state.theme);
    hashParams.set('geom', state.geomMode);

    const hidden = Array.from(state.groups.values())
      .filter(function (g) { return !g.visible; })
      .map(function (g) { return encodeURIComponent(g.key); });

    if (hidden.length) hashParams.set('off', hidden.join('~'));

    const base = state.datasetId ? ('?dataset=' + encodeURIComponent(state.datasetId)) : '';
    const newUrl = window.location.pathname + base + '#' + hashParams.toString();
    history.replaceState(null, '', newUrl);
  }

  function readHashState() {
    const raw = window.location.hash ? window.location.hash.slice(1) : '';
    if (!raw) return null;

    const p = new URLSearchParams(raw);
    const parsed = { view: null, minute: null, mode: null, theme: null, geomMode: null, hiddenGroups: [] };

    const lat = Number(p.get('lat'));
    const lng = Number(p.get('lng'));
    const z = Number(p.get('z'));
    if (Number.isFinite(lat) && Number.isFinite(lng) && Number.isFinite(z)) {
      parsed.view = { lat: lat, lng: lng, z: z };
    }

    const m = Number(p.get('m'));
    if (Number.isFinite(m)) parsed.minute = m;

    const mode = p.get('mode');
    if (mode === 'group' || mode === 'outage') parsed.mode = mode;

    const theme = p.get('theme');
    if (theme === 'light' || theme === 'dark') parsed.theme = theme;

    const geom = p.get('geom');
    if (geom === 'detail' || geom === 'fused') parsed.geomMode = geom;

    const off = p.get('off');
    if (off) parsed.hiddenGroups = off.split('~').map(function (v) { return decodeURIComponent(v); });

    return parsed;
  }

  function applyPendingHashState() {
    if (!state.pendingHashState) return;

    state.hashSyncBlocked = true;
    const hs = state.pendingHashState;

    if (hs.mode) setMode(hs.mode);
    if (hs.theme) applyTheme(hs.theme);
    if (hs.geomMode === 'fused' && state.geomMode !== 'fused') {
      toggleGeometryMode();
    }

    if (Array.isArray(hs.hiddenGroups) && hs.hiddenGroups.length) {
      for (let i = 0; i < hs.hiddenGroups.length; i += 1) {
        const g = state.groups.get(hs.hiddenGroups[i]);
        if (g) g.visible = false;
      }
    }

    if (Number.isFinite(hs.minute) && hs.minute >= 0) setMinute(hs.minute);

    state.hashSyncBlocked = false;
  }

  function exportVisibleGeoJSON() {
    const visibleFeatures = [];
    for (let i = 0; i < state.features.length; i += 1) {
      const feat = state.features[i];
      if (shouldFeatureBeVisible(feat)) visibleFeatures.push(feat.feature);
    }

    const payload = {
      type: 'FeatureCollection',
      name: (state.datasetRecord && state.datasetRecord.name ? state.datasetRecord.name : 'dataset') + ' (filtrado)',
      features: visibleFeatures,
    };

    const text = JSON.stringify(payload, null, 2);
    downloadText(fileBaseName() + '_filtrado.geojson', text, 'application/geo+json;charset=utf-8');
    setStatus('GeoJSON exportado (' + visibleFeatures.length + ' features).', 'ok');
  }

  function exportFusedGeoJSON() {
    const features = [];

    state.groups.forEach(function (group) {
      const groupVisible = group.featureIds.some(function (id) {
        return state.features[id] && shouldFeatureBeVisible(state.features[id]);
      });
      if (!groupVisible) return;

      const feats = group.featureIds
        .map(function (id) { return state.features[id] ? state.features[id].feature : null; })
        .filter(Boolean);

      const polys = feats.filter(function (f) {
        return /Polygon/i.test((f.geometry && f.geometry.type) || '');
      });
      const points = feats.filter(function (f) {
        return /Point/i.test((f.geometry && f.geometry.type) || '');
      });

      const firstProps = (feats[0] && feats[0].properties) || {};

      if (polys.length) {
        const dissolved = dissolvePolygons(polys);
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

    const baseName = state.datasetRecord && state.datasetRecord.name ? state.datasetRecord.name : 'dataset';
    const payload = {
      type: 'FeatureCollection',
      name: baseName + ' (fusionado)',
      features: features,
    };

    const text = JSON.stringify(payload, null, 2);
    downloadText(fileBaseName() + '_fusionado.geojson', text, 'application/geo+json;charset=utf-8');
    setStatus('GeoJSON fusionado exportado (' + features.length + ' features).', 'ok');
  }

  // ─── Resolución de solapamientos entre polígonos ──────────────────────────

  // Punto de entrada: el usuario hace clic en "Resolver solapamientos".
  // Recoge todos los polígonos del dataset, lanza el proceso asíncrono y,
  // al terminar, muestra una capa de previsualización sobre el mapa.
  function runOverlapResolver() {
    if (typeof turf === 'undefined') {
      setStatus('Turf.js es necesario para esta función.', 'err');
      return;
    }

    const polygons = state.features
      .filter(function (f) {
        const geomType = (f.feature.geometry && f.feature.geometry.type) || '';
        return /Polygon/i.test(geomType);
      })
      .map(function (f) { return f.feature; });

    if (!polygons.length) {
      setStatus('El dataset no contiene polígonos.', 'err');
      return;
    }

    // Limpiar resultado de una ejecución previa
    if (state.resolved.previewLayer) {
      state.map.removeLayer(state.resolved.previewLayer);
      state.resolved.previewLayer = null;
    }
    state.resolved.done = false;
    state.resolved.features = [];
    els.btnExportResolved.hidden = true;
    els.btnResolveOverlaps.disabled = true;

    setStatus('Analizando ' + polygons.length + ' polígonos...', 'warn');

    resolveOverlapsAsync(
      polygons,
      function onProgress(current, total) {
        setStatus('Procesando ' + current + ' / ' + total + '...', 'warn');
      },
      function onDone(result) {
        state.resolved.features = result;
        state.resolved.done = true;

        state.resolved.previewLayer = buildResolvedPreviewLayer(result);

        els.btnExportResolved.hidden = false;
        els.btnResolveOverlaps.disabled = false;

        // Abrir el panel de comparación en modo "ambos" para ver el antes y después
        els.comparePanel.hidden = false;
        setCompareMode('both');

        const removed = polygons.length - result.length;
        const msg = 'Listo: ' + result.length + ' polígonos resultantes' +
          (removed > 0 ? ' (' + removed + ' absorbidos completamente)' : '') + '.';
        setStatus(msg, 'ok');
      }
    );
  }

  // Procesa los polígonos de forma asíncrona (un polígono por tick de event loop)
  // para no bloquear la interfaz durante datasets grandes.
  //
  // Estrategia de prioridad — orden ASCENDENTE por área:
  //   Las zonas más pequeñas se procesan primero y conservan su forma exacta.
  //   Las zonas más grandes se procesan después y pierden el área que ya fue
  //   reclamada por las pequeñas (turf.difference). Esto resuelve correctamente
  //   el caso de subestaciones anidadas: la interior mantiene su geometría y la
  //   exterior queda con el hueco correspondiente, sin perder ninguna subestación.
  function resolveOverlapsAsync(features, onProgress, onDone) {
    const sorted = features.slice().sort(function (a, b) {
      let areaA = 0;
      let areaB = 0;
      try { areaA = turf.area(a); } catch (_) {}
      try { areaB = turf.area(b); } catch (_) {}
      return areaA - areaB;   // ascendente: la más pequeña va primero
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
          // Descarte rápido: si los bounding boxes no se superponen,
          // no puede haber intersección real entre estos dos polígonos.
          if (currentBbox && resultBBoxes[j] && !bboxesOverlap(currentBbox, resultBBoxes[j])) {
            continue;
          }

          let diff = null;
          try {
            diff = turf.difference(current, result[j]);
          } catch (_) {
            // Si turf falla (e.g. geometría degenerada), conservar el actual
            diff = current;
          }

          if (!diff) {
            // El polígono quedó completamente cubierto por uno anterior
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

  // Devuelve true si dos bounding boxes [minX, minY, maxX, maxY] se solapan.
  function bboxesOverlap(a, b) {
    return !(a[2] < b[0] || b[2] < a[0] || a[3] < b[1] || b[3] < a[1]);
  }

  // Alterna qué capas se muestran en el mapa:
  //   'before' → solo los polígonos originales (como estaban antes del proceso)
  //   'both'   → originales atenuados + resueltos con color completo (para comparar)
  //   'after'  → solo los polígonos ya sin solapamientos, con sus colores de grupo
  function setCompareMode(mode) {
    state.compareMode = mode;

    const showOriginal = (mode === 'before' || mode === 'both');
    const showResolved  = (mode === 'after'  || mode === 'both');
    const dimOriginal   = (mode === 'both');

    // Capas originales
    if (!showOriginal) {
      for (let i = 0; i < state.features.length; i += 1) {
        const feat = state.features[i];
        if (state.map.hasLayer(feat.layer)) state.map.removeLayer(feat.layer);
      }
      if (state.fused.built) {
        state.fused.groupLayers.forEach(function (layer) {
          if (state.map.hasLayer(layer)) state.map.removeLayer(layer);
        });
      }
    } else {
      // Restaurar visibilidad normal y luego atenuar si hace falta
      refreshAll();
      if (dimOriginal) {
        for (let i = 0; i < state.features.length; i += 1) {
          const feat = state.features[i];
          if (state.map.hasLayer(feat.layer)) {
            // Atenuar los originales para que los resueltos resalten encima
            feat.layer.setStyle({ fillOpacity: 0.12, opacity: 0.35, weight: 1 });
          }
        }
      }
    }

    // Capa resuelta (mismos colores de grupo, encima)
    if (state.resolved.previewLayer) {
      const onMap = state.map.hasLayer(state.resolved.previewLayer);
      if (showResolved && !onMap) state.resolved.previewLayer.addTo(state.map);
      if (!showResolved && onMap) state.map.removeLayer(state.resolved.previewLayer);
    }

    // Resaltar el botón activo
    els.btnCmpBefore.classList.toggle('btn-mini-primary', mode === 'before');
    els.btnCmpBoth.classList.toggle('btn-mini-primary', mode === 'both');
    els.btnCmpAfter.classList.toggle('btn-mini-primary', mode === 'after');
  }

  // Construye una capa Leaflet para mostrar los polígonos resueltos.
  // Cada polígono usa el mismo color de su grupo original, igual que la vista normal,
  // para que la comparación sea directa (mismos colores, formas distintas).
  function buildResolvedPreviewLayer(features) {
    const renderer = L.canvas({ padding: 0.5 });
    const groupField = state.analysis && state.analysis.groupBy;

    return L.geoJSON(
      { type: 'FeatureCollection', features: features },
      {
        renderer: renderer,
        style: function (feature) {
          const props = feature.properties || {};
          const rawKey = groupField ? props[groupField] : null;
          const groupKey = (rawKey != null && String(rawKey).trim()) ? String(rawKey).trim() : 'N/A';
          const group = state.groups.get(groupKey);
          const color = group ? group.color : '#3b82f6';

          return {
            color: color,
            weight: 2.5,
            opacity: 1,
            fillColor: color,
            fillOpacity: 0.52,
          };
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

  // Descarga el GeoJSON con los polígonos ya sin solapamientos.
  function exportResolvedGeoJSON() {
    if (!state.resolved.done || !state.resolved.features.length) {
      setStatus('Primero ejecuta "Resolver solapamientos".', 'err');
      return;
    }

    const baseName = (state.datasetRecord && state.datasetRecord.name)
      ? state.datasetRecord.name
      : 'dataset';

    const payload = {
      type: 'FeatureCollection',
      name: baseName + ' (sin solapamientos)',
      features: state.resolved.features,
    };

    const text = JSON.stringify(payload, null, 2);
    downloadText(fileBaseName() + '_sin_solapamientos.geojson', text, 'application/geo+json;charset=utf-8');
    setStatus('Exportados ' + state.resolved.features.length + ' polígonos sin solapamientos.', 'ok');
  }

  // ──────────────────────────────────────────────────────────────────────────

  function exportSummaryCsv() {
    const header = ['grupo', 'features_totales', 'features_visibles', 'franjas', 'horas_estimadas', 'activo_en_timeline'];
    const rows = [header.join(',')];

    state.groups.forEach(function (g) {
      const visible = countVisibleFeaturesInGroup(g.key);
      const active = state.minute >= 0 ? (isGroupAffectedAt(g.key, state.minute) ? 'si' : 'no') : '-';
      const line = [csvCell(g.key), g.featureCount, visible, g.slotCount, (g.totalOutageMin / 60).toFixed(2), active];
      rows.push(line.join(','));
    });

    downloadText(fileBaseName() + '_resumen.csv', rows.join('\n'), 'text/csv;charset=utf-8');
    setStatus('Resumen CSV exportado.', 'ok');
  }

  function fileBaseName() {
    const name = state.datasetRecord && state.datasetRecord.name ? state.datasetRecord.name : 'dataset';
    return name.replace(/[^a-z0-9_\-]+/gi, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '') || 'dataset';
  }

  function csvCell(value) {
    const txt = String(value === null || value === undefined ? '' : value);
    return '"' + txt.replace(/"/g, '""') + '"';
  }

  function downloadText(fileName, text, mime) {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    setTimeout(function () { URL.revokeObjectURL(url); }, 1200);
  }

  async function onIncFileChange(event) {
    const file = event.target.files && event.target.files[0];
    event.target.value = '';
    if (!file) return;

    try {
      setStatus('Procesando incidencias...', 'warn');
      const points = await parseIncidenceFile(file);
      renderIncidences(points, file.name);
      setStatus('Incidencias cargadas: ' + points.length, 'ok');
    } catch (error) {
      setStatus('No se pudo cargar incidencias: ' + (error && error.message ? error.message : ''), 'err');
    }
  }

  async function parseIncidenceFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();

    if (ext === 'csv') {
      const text = await readFileAsText(file);
      const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
      if (parsed.errors && parsed.errors.length) {
        throw new Error('CSV con formato inválido. Revisa separadores y comillas.');
      }
      return normalizeIncidenceRows(parsed.data);
    }

    if (ext === 'xlsx' || ext === 'xls') {
      const buffer = await readFileAsArrayBuffer(file);
      const wb = XLSX.read(buffer, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      return normalizeIncidenceRows(rows);
    }

    throw new Error('Formato no soportado. Usa CSV o Excel.');
  }
  function normalizeIncidenceRows(rows) {
    if (!rows || !rows.length) {
      throw new Error('No hay filas con datos.');
    }

    const headers = Object.keys(rows[0]);
    const col = detectLatLonColumns(headers);

    if (!col.lat || !col.lon) {
      throw new Error('No se detectaron columnas de latitud/longitud.');
    }

    const idCol = detectIdColumn(headers);
    const points = [];

    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i];
      const lat = toNumber(row[col.lat]);
      const lon = toNumber(row[col.lon]);

      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;

      points.push({ id: idCol ? row[idCol] : i + 1, lat: lat, lon: lon, props: row });
    }

    if (!points.length) {
      throw new Error('No se encontraron coordenadas válidas.');
    }

    return points;
  }

  function detectLatLonColumns(headers) {
    const normalized = headers.map(function (h) {
      return { raw: h, norm: normalizeHeader(h) };
    });

    function findByCandidates(candidates) {
      for (let i = 0; i < candidates.length; i += 1) {
        const c = candidates[i];
        for (let j = 0; j < normalized.length; j += 1) {
          if (normalized[j].norm === c) return normalized[j].raw;
        }
      }

      for (let i = 0; i < candidates.length; i += 1) {
        const c = candidates[i];
        for (let j = 0; j < normalized.length; j += 1) {
          if (normalized[j].norm.includes(c)) return normalized[j].raw;
        }
      }

      return null;
    }

    return {
      lat: findByCandidates(['latitud', 'lat', 'latitude', 'y']),
      lon: findByCandidates(['longitud', 'lon', 'lng', 'longitude', 'x']),
    };
  }

  function detectIdColumn(headers) {
    const candidates = ['id', 'codigo', 'code', 'ticket'];
    const normalized = headers.map(function (h) {
      return { raw: h, norm: normalizeHeader(h) };
    });

    for (let i = 0; i < candidates.length; i += 1) {
      for (let j = 0; j < normalized.length; j += 1) {
        if (normalized[j].norm === candidates[i]) return normalized[j].raw;
      }
    }

    return null;
  }

  function normalizeHeader(text) {
    return String(text || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '');
  }

  function toNumber(value) {
    if (typeof value === 'number') return value;
    const txt = String(value || '').trim().replace(',', '.');
    return Number(txt);
  }

  function readFileAsText(file) {
    return new Promise(function (resolve, reject) {
      const r = new FileReader();
      r.onload = function (ev) { resolve(ev.target.result); };
      r.onerror = function () { reject(new Error('No se pudo leer archivo de texto.')); };
      r.readAsText(file, 'utf-8');
    });
  }

  function readFileAsArrayBuffer(file) {
    return new Promise(function (resolve, reject) {
      const r = new FileReader();
      r.onload = function (ev) { resolve(ev.target.result); };
      r.onerror = function () { reject(new Error('No se pudo leer archivo binario.')); };
      r.readAsArrayBuffer(file);
    });
  }

  function renderIncidences(points, fileName) {
    state.incidences.points = points.slice();
    state.incidences.fileName = fileName;
    state.incidences.visible = true;

    removeIncidenceLayer();
    state.incidences.layer = buildIncidenceLayer();

    if (state.incidences.layer) state.incidences.layer.addTo(state.map);

    els.btnIncToggle.disabled = false;
    els.btnIncCluster.disabled = false;
    els.btnIncClear.disabled = false;

    els.btnIncToggle.textContent = 'Ocultar';
    els.btnIncCluster.textContent = state.incidences.clustered ? 'Cluster ON' : 'Cluster OFF';
    els.incMeta.textContent = fileName + ' · ' + points.length + ' puntos';
  }

  function buildIncidenceLayer() {
    const useCluster = state.incidences.clustered && typeof L.markerClusterGroup === 'function';
    const layer = useCluster
      ? L.markerClusterGroup({ showCoverageOnHover: false, disableClusteringAtZoom: 16 })
      : L.layerGroup();

    const pts = state.incidences.points;

    for (let i = 0; i < pts.length; i += 1) {
      const p = pts[i];
      const marker = L.marker([p.lat, p.lon], {
        icon: L.divIcon({
          className: '',
          html: '<div class="inc-marker"></div>',
          iconSize: [14, 14],
          iconAnchor: [7, 7],
        }),
      });

      const popupRows = [];
      const props = p.props || {};
      const keys = Object.keys(props).slice(0, 14);

      for (let j = 0; j < keys.length; j += 1) {
        const k = keys[j];
        const nk = normalizeHeader(k);
        if (nk === 'lat' || nk === 'latitud' || nk === 'latitude' || nk === 'y') continue;
        if (nk === 'lon' || nk === 'lng' || nk === 'longitud' || nk === 'longitude' || nk === 'x') continue;
        popupRows.push('<div><strong>' + escapeHtml(k) + ':</strong> ' + escapeHtml(props[k]) + '</div>');
      }

      marker.bindPopup(
        '<div style="font-size:12px;line-height:1.4">' +
          '<div><strong>Incidencia:</strong> ' + escapeHtml(p.id) + '</div>' +
          popupRows.join('') +
          '<div><strong>Lat:</strong> ' + p.lat.toFixed(6) + '</div>' +
          '<div><strong>Lon:</strong> ' + p.lon.toFixed(6) + '</div>' +
        '</div>'
      );

      layer.addLayer(marker);
    }

    return layer;
  }

  function removeIncidenceLayer() {
    if (state.incidences.layer && state.map.hasLayer(state.incidences.layer)) {
      state.map.removeLayer(state.incidences.layer);
    }
    state.incidences.layer = null;
  }

  function toggleIncidenceLayer() {
    if (!state.incidences.layer) return;

    state.incidences.visible = !state.incidences.visible;

    if (state.incidences.visible) {
      state.incidences.layer.addTo(state.map);
      els.btnIncToggle.textContent = 'Ocultar';
    } else {
      state.map.removeLayer(state.incidences.layer);
      els.btnIncToggle.textContent = 'Mostrar';
    }
  }

  function toggleIncidenceCluster() {
    if (!state.incidences.points.length) return;

    state.incidences.clustered = !state.incidences.clustered;
    const wasVisible = state.incidences.visible;

    removeIncidenceLayer();
    state.incidences.layer = buildIncidenceLayer();

    if (wasVisible && state.incidences.layer) {
      state.incidences.layer.addTo(state.map);
    }

    els.btnIncCluster.textContent = state.incidences.clustered ? 'Cluster ON' : 'Cluster OFF';
  }

  function clearIncidences() {
    removeIncidenceLayer();
    state.incidences.points = [];
    state.incidences.visible = true;
    state.incidences.fileName = null;

    els.btnIncToggle.disabled = true;
    els.btnIncCluster.disabled = true;
    els.btnIncClear.disabled = true;
    els.btnIncToggle.textContent = 'Ocultar';
    els.incMeta.textContent = 'Sin incidencias cargadas';
  }

  function formatMinute(minute) {
    let m = minute;
    if (m >= 1440) m = 0;
    const hh = String(Math.floor(m / 60)).padStart(2, '0');
    const mm = String(m % 60).padStart(2, '0');
    return hh + ':' + mm;
  }

  function truncate(value, maxLen) {
    const txt = String(value || '');
    if (txt.length <= maxLen) return txt;
    return txt.slice(0, maxLen - 1) + '...';
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function setStatus(text, kind) {
    els.statusPill.textContent = text;
    els.statusPill.classList.remove('ok', 'warn', 'err');
    if (kind) els.statusPill.classList.add(kind);
  }

  function loadThemePreference() {
    const stored = localStorage.getItem('geo_viewer_theme');
    if (stored === 'light' || stored === 'dark') {
      return stored;
    }
    return 'light';
  }

  function applyTheme(theme) {
    const next = theme === 'dark' ? 'dark' : 'light';
    state.theme = next;
    document.body.setAttribute('data-theme', next);
    localStorage.setItem('geo_viewer_theme', next);
    if (els.btnTheme) {
      els.btnTheme.textContent = next === 'dark' ? 'Modo claro' : 'Modo oscuro';
    }
  }

  function toggleTheme() {
    applyTheme(state.theme === 'dark' ? 'light' : 'dark');
    setStatus('Tema cambiado a ' + (state.theme === 'dark' ? 'oscuro' : 'claro') + '.', 'ok');
    syncHashState();
  }

  function analyzeGeojsonFallback(geojson) {
    const features = Array.isArray(geojson.features) ? geojson.features : [];
    const grouping = fallbackDetectGroupBy(features);
    const groupBy = grouping ? grouping.field : null;
    const groupByLabel = grouping ? grouping.label : null;
    const featureMeta = [];
    const groupMap = new Map();
    const buckets = new Array(96).fill(0);
    const schemaMap = new Map();

    for (let i = 0; i < features.length; i += 1) {
      const f = features[i] || {};
      const props = f.properties || {};
      const groupKey = groupBy
        ? normalizeGroupValue(props[groupBy])
        : 'Todas las zonas';
      const slots = normalizeFallbackSlots(props.cortes_horas);
      const totalOutageMin = fallbackTotalMinutes(slots);

      const meta = {
        id: i,
        groupKey: groupKey,
        slots: slots,
        slotCount: slots.length,
        hasOutage: slots.length > 0,
        totalOutageMin: totalOutageMin,
        geometryType: f.geometry && f.geometry.type ? f.geometry.type : 'Sin geometría',
      };
      featureMeta.push(meta);

      if (!groupMap.has(groupKey)) {
        groupMap.set(groupKey, {
          key: groupKey,
          featureIds: [],
          featureCount: 0,
          slotCount: 0,
          totalOutageMin: 0,
          hasOutage: false,
        });
      }

      const g = groupMap.get(groupKey);
      g.featureIds.push(i);
      g.featureCount += 1;
      g.slotCount += slots.length;
      g.totalOutageMin += totalOutageMin;
      if (slots.length > 0) g.hasOutage = true;

      fallbackCountBuckets(buckets, slots);
      if (i < 500) collectFallbackSchema(schemaMap, props);
    }

    const groups = Array.from(groupMap.values()).sort(function (a, b) {
      return a.key.localeCompare(b.key, 'es', { sensitivity: 'base' });
    });

    return {
      groupBy: groupBy,
      groupByLabel: groupByLabel,
      featureMeta: featureMeta,
      groups: groups,
      buckets: buckets,
      propertySchema: buildFallbackSchema(schemaMap),
      outageAvailable: groups.some(function (g) { return g.hasOutage; }),
      counts: {
        features: features.length,
        groups: groups.length,
        affectedGroups: groups.filter(function (g) { return g.hasOutage; }).length,
      },
    };
  }

  function fallbackDetectGroupBy(features) {
    const sample = features.slice(0, 10).map(function (f) {
      return f && f.properties ? f.properties : {};
    });
    if (!sample.length) return null;

    const priority = [
      'subgrupo', 'grupo', 'group', 'sector', 'zona', 'zone',
      'district', 'barrio', 'parroquia', 'name', 'nombre'
    ];

    const keys = new Set();
    for (let i = 0; i < sample.length; i += 1) {
      Object.keys(sample[i]).forEach(function (k) { keys.add(k); });
    }
    const list = Array.from(keys);

    for (let i = 0; i < priority.length; i += 1) {
      for (let j = 0; j < list.length; j += 1) {
        if (list[j].toLowerCase() === priority[i]) return { field: list[j], label: list[j] };
      }
    }

    const firstProps = sample[0] || {};
    const entries = Object.entries(firstProps);
    for (let i = 0; i < entries.length; i += 1) {
      const key = entries[i][0];
      const value = entries[i][1];
      if (typeof value === 'string' && key.toLowerCase() !== 'cortes_horas') {
        return { field: key, label: key };
      }
    }

    return null;
  }

  function normalizeGroupValue(value) {
    if (value === null || value === undefined) return 'N/A';
    const txt = String(value).trim();
    return txt || 'N/A';
  }

  function normalizeFallbackSlots(rawValue) {
    const list = Array.isArray(rawValue)
      ? rawValue
      : (typeof rawValue === 'string' ? rawValue.split(/[|;,]/g) : []);

    const slots = [];
    const seen = new Set();
    for (let i = 0; i < list.length; i += 1) {
      const parsed = parseFallbackSlot(list[i]);
      if (!parsed) continue;
      const key = parsed[0] + '_' + parsed[1];
      if (seen.has(key)) continue;
      seen.add(key);
      slots.push(parsed);
    }
    return slots;
  }

  function parseFallbackSlot(raw) {
    const clean = String(raw || '')
      .replace(/[–—]/g, '-')
      .trim();
    const m = clean.match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/);
    if (!m) return null;
    const start = parseClockMinute(m[1]);
    const end = parseClockMinute(m[2]);
    if (start === null || end === null || start === end) return null;
    return [start, end];
  }

  function parseClockMinute(raw) {
    const p = String(raw).split(':');
    if (p.length !== 2) return null;
    const h = Number(p[0]);
    const m = Number(p[1]);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    if (h < 0 || h > 24 || m < 0 || m > 59) return null;
    if (h === 24 && m !== 0) return null;
    return h * 60 + m;
  }

  function fallbackTotalMinutes(slots) {
    let total = 0;
    for (let i = 0; i < slots.length; i += 1) {
      const s = slots[i][0];
      const e = slots[i][1];
      total += e > s ? (e - s) : ((1440 - s) + e);
    }
    return total;
  }

  function fallbackCountBuckets(buckets, slots) {
    for (let i = 0; i < slots.length; i += 1) {
      const start = slots[i][0];
      const end = slots[i][1];
      if (end > start) {
        fillBucketRange(buckets, start, end);
      } else {
        fillBucketRange(buckets, start, 1440);
        fillBucketRange(buckets, 0, end);
      }
    }
  }

  function fillBucketRange(buckets, start, end) {
    for (let m = start; m < end; m += 15) {
      const bucket = Math.floor(m / 15);
      if (bucket >= 0 && bucket < 96) buckets[bucket] += 1;
    }
  }

  function collectFallbackSchema(map, props) {
    const keys = Object.keys(props || {});
    for (let i = 0; i < keys.length; i += 1) {
      const k = keys[i];
      const v = props[k];
      if (!map.has(k)) {
        map.set(k, { key: k, nonNull: 0, count: 0, types: new Map(), sample: null });
      }
      const row = map.get(k);
      row.count += 1;
      if (v !== null && v !== undefined && v !== '') {
        row.nonNull += 1;
        if (row.sample === null) row.sample = String(v);
      }
      const t = typeof v;
      const normalizedType = (t === 'number' || t === 'boolean' || t === 'string') ? t : 'other';
      row.types.set(normalizedType, (row.types.get(normalizedType) || 0) + 1);
    }
  }

  function buildFallbackSchema(map) {
    const out = [];
    map.forEach(function (row) {
      let mainType = 'string';
      let max = -1;
      row.types.forEach(function (count, t) {
        if (count > max) {
          max = count;
          mainType = t;
        }
      });
      out.push({
        key: row.key,
        nonNull: row.nonNull,
        count: row.count,
        mainType: mainType,
        sample: row.sample,
      });
    });
    out.sort(function (a, b) {
      if (b.nonNull !== a.nonNull) return b.nonNull - a.nonNull;
      return a.key.localeCompare(b.key, 'es', { sensitivity: 'base' });
    });
    return out.slice(0, 80);
  }

  function debounce(fn, wait) {
    let timer = null;

    return function () {
      const args = arguments;
      clearTimeout(timer);
      timer = setTimeout(function () {
        fn.apply(null, args);
      }, wait);
    };
  }
}());
