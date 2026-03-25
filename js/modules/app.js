import { createState, createEls, GROUP_COLORS, GAP_FILL } from './state.js';
import { setStatus, debounce } from './utils.js';
import { analyzeGeojsonInWorker, analyzeGeojsonFallback } from './geo-analysis.js';
import { applyTheme, toggleTheme, loadThemePreference } from './theme.js';
import { readHashState, applyPendingHashState, syncHashState } from './hash-state.js';
import { buildFeatureLayers, refreshFeatureVisibility, refreshFeatureStyles, fitInitialView } from './layers.js';
import {
  updateGeomToggleButton, ensureFusedLayersBuilt,
  refreshFusedStyles, refreshFusedVisibility, toggleGeometryMode,
} from './fused.js';
import {
  prepareGroups, renderGroupList, refreshAfterVisibilityChange,
  setAllGroupsVisibility, invertGroupsVisibility, showAffectedOnly, setGroupVisibility,
} from './groups.js';
import {
  setMinute, togglePlayback, setPlaybackSpeed,
  buildTimelineTrack, countAffectedGroups, countOutageGroups,
} from './timeline.js';
import { updateRanking } from './ranking.js';
import { openInfoPanel, closeInfoPanel } from './info-panel.js';
import { parseIncidenceFile, renderIncidences, toggleIncidenceLayer, toggleIncidenceCluster, clearIncidences } from './incidents.js';
import { loadCsvPolygonData, clearCsvPaint } from './csv-paint.js';
import { runOverlapResolver, setCompareMode, exportResolvedGeoJSON } from './overlap.js';
import { exportVisibleGeoJSON, exportFusedGeoJSON, exportSummaryCsv } from './export.js';
import { shouldFeatureBeVisible } from './layers.js';

const ctx = {
  state: createState(),
  els: null,
  GROUP_COLORS,
  GAP_FILL,
  _hooks: {},
};

document.addEventListener('DOMContentLoaded', function () {
  ctx.els = createEls();

  ctx._hooks = {
    updateHeader:        function (c) { updateHeader(c); },
    refreshAll:          function (c) { refreshAll(c); },
    setMode:             function (c, mode) { setMode(c, mode); },
    toggleGeomMode:      function (c) { toggleGeometryMode(c); },
    openInfoPanel:       function (c, id) { openInfoPanel(c, id); },
    refreshFusedStyles:  function (c) { refreshFusedStyles(c); },
    refreshFusedVisibility: function (c) { refreshFusedVisibility(c); },
    refreshFeatureStyles: function (c) { refreshFeatureStyles(c); },
    updateRanking:       function (c) { updateRanking(c); },
    syncHashState:       function (c) { syncHashState(c); },
    applyTheme:          function (c, theme) { applyTheme(c, theme); },
    setMinute:           function (c, minute) { setMinute(c, minute); },
  };

  boot().catch(function onBootError(error) {
    setStatus(ctx, 'Error inicializando el mapa: ' + (error && error.message ? error.message : 'desconocido'), 'err');
  });
});

async function boot() {
  bindUI();
  updateGeomToggleButton(ctx);
  applyTheme(ctx, loadThemePreference());
  setStatus(ctx, 'Cargando dataset...', 'warn');

  ctx.state.pendingHashState = readHashState();
  ctx.state.datasetId = getDatasetIdFromQuery();

  const record = await resolveDatasetRecord();
  if (!record) {
    window.location.replace('index.html');
    return;
  }

  ctx.state.datasetRecord = record;
  ctx.state.geojson = safeParseJson(record.text);

  if (!ctx.state.geojson || ctx.state.geojson.type !== 'FeatureCollection' || !Array.isArray(ctx.state.geojson.features)) {
    throw new Error('El dataset guardado no es un FeatureCollection válido.');
  }

  const datasetName = record.name || 'Dataset';
  document.title = datasetName + ' | Visor GeoJSON';
  ctx.els.title.textContent = datasetName;

  ctx.state.map = createMap();

  setStatus(ctx, 'Analizando capas y propiedades...', 'warn');
  try {
    ctx.state.analysis = await analyzeGeojsonInWorker(ctx.state.geojson);
  } catch (_) {
    ctx.state.analysis = analyzeGeojsonFallback(ctx.state.geojson);
    setStatus(ctx, 'Worker no disponible, usando análisis local.', 'warn');
  }

  prepareGroups(ctx);
  buildFeatureLayers(ctx);
  buildTimelineTrack(ctx);
  applyPendingHashState(ctx);

  updateHeader(ctx);
  renderGroupList(ctx);
  refreshAll(ctx);
  fitInitialView(ctx);

  const by = ctx.state.analysis.groupByLabel || null;
  if (by) {
    const lbl = by.charAt(0).toUpperCase() + by.slice(1);
    ctx.els.groupsTitle.textContent = lbl + 's';
    ctx.els.groupSearch.placeholder = 'Buscar ' + lbl.toLowerCase() + '...';
  } else {
    ctx.els.groupsTitle.textContent = 'Grupos';
    ctx.els.groupSearch.placeholder = 'Buscar grupo...';
  }
  ctx.els.subtitle.textContent =
    (by || 'sin agrupación') + ' · ' +
    ctx.state.analysis.counts.features.toLocaleString('es-EC') + ' zonas · ' +
    ctx.state.analysis.counts.groups + ' grupos';

  if (!ctx.state.analysis.outageAvailable) {
    if (ctx.els.btnModeOutage) ctx.els.btnModeOutage.disabled = true;
    ctx.els.timelineBadge.textContent = 'dataset sin cortes_horas';
  }

  ctx.els.btnResolveOverlaps.hidden = false;
  setStatus(ctx, 'Listo', 'ok');
}

function bindUI() {
  ctx.els.btnTheme.addEventListener('click', function () { toggleTheme(ctx); });
  document.getElementById('btn-export-fused').addEventListener('click', function () { exportFusedGeoJSON(ctx); });
  ctx.els.btnResolveOverlaps.addEventListener('click', function () { runOverlapResolver(ctx); });
  ctx.els.btnExportResolved.addEventListener('click', function () { exportResolvedGeoJSON(ctx); });
  ctx.els.btnCmpBefore.addEventListener('click', function () { setCompareMode(ctx, 'before'); });
  ctx.els.btnCmpBoth.addEventListener('click', function () { setCompareMode(ctx, 'both'); });
  ctx.els.btnCmpAfter.addEventListener('click', function () { setCompareMode(ctx, 'after'); });
  ctx.els.btnFit.addEventListener('click', function () {
    if (ctx.state.mapBounds && ctx.state.mapBounds.isValid()) ctx.state.map.fitBounds(ctx.state.mapBounds.pad(0.06));
  });
  ctx.els.btnPrint.addEventListener('click', function () { window.print(); });
  ctx.els.btnBack.addEventListener('click', function () { window.location.href = 'index.html'; });

  ctx.els.btnSidebar.addEventListener('click', function () {
    ctx.els.sidebar.classList.toggle('open');
  });

  ctx.els.groupSearch.addEventListener('input', function () { renderGroupList(ctx); });
  ctx.els.btnAll.addEventListener('click', function () { setAllGroupsVisibility(ctx, true); });
  ctx.els.btnNone.addEventListener('click', function () { setAllGroupsVisibility(ctx, false); });
  ctx.els.btnInvert.addEventListener('click', function () { invertGroupsVisibility(ctx); });
  ctx.els.btnAffectedOnly.addEventListener('click', function () { showAffectedOnly(ctx); });

  if (ctx.els.btnModeGroup) {
    ctx.els.btnModeGroup.addEventListener('click', function () { setMode(ctx, 'group'); });
  }
  if (ctx.els.btnModeOutage) {
    ctx.els.btnModeOutage.addEventListener('click', function () { setMode(ctx, 'outage'); });
  }
  if (ctx.els.btnGeomToggle) {
    ctx.els.btnGeomToggle.addEventListener('click', function () { toggleGeometryMode(ctx); });
  }

  ctx.els.btnIncLoad.addEventListener('click', function () { ctx.els.incFileInput.click(); });
  ctx.els.incFileInput.addEventListener('change', onIncFileChange);
  ctx.els.btnIncToggle.addEventListener('click', function () { toggleIncidenceLayer(ctx); });
  ctx.els.btnIncCluster.addEventListener('click', function () { toggleIncidenceCluster(ctx); });
  ctx.els.btnIncClear.addEventListener('click', function () { clearIncidences(ctx); });

  ctx.els.timelineSlider.addEventListener('input', function () {
    setMinute(ctx, Number(ctx.els.timelineSlider.value));
  });
  ctx.els.btnPlay.addEventListener('click', function () { togglePlayback(ctx); });
  ctx.els.btnSpd1.addEventListener('click', function () { setPlaybackSpeed(ctx, 1); });
  ctx.els.btnSpd4.addEventListener('click', function () { setPlaybackSpeed(ctx, 4); });
  ctx.els.btnSpd8.addEventListener('click', function () { setPlaybackSpeed(ctx, 8); });
  ctx.els.btnTimeClear.addEventListener('click', function () { setMinute(ctx, -1); });
  ctx.els.btnTlToggle.addEventListener('click', function () {
    const collapsed = ctx.els.timeline.classList.toggle('collapsed');
    ctx.els.btnTlToggle.textContent = collapsed ? '+' : '−';
    ctx.els.btnTlToggle.title = collapsed ? 'Expandir timeline' : 'Colapsar timeline';
  });

  ctx.els.btnInfoClose.addEventListener('click', function () { closeInfoPanel(ctx); });

  ctx.els.btnCsvLoad.addEventListener('click', function () { ctx.els.csvFileInput.click(); });
  ctx.els.csvFileInput.addEventListener('change', onCsvFileChange);
  ctx.els.btnCsvClear.addEventListener('click', function () { clearCsvPaint(ctx); });
}

function updateHeader(c) {
  const visibleFeatures = c.state.features.filter(function (feat) {
    return shouldFeatureBeVisible(c, feat);
  }).length;

  const visibleGroups = Array.from(c.state.groups.values()).filter(function (g) {
    return g.visible;
  }).length;

  const affected = c.state.minute >= 0 ? countAffectedGroups(c, c.state.minute) : countOutageGroups(c);

  c.els.statFeatures.textContent = visibleFeatures.toLocaleString('es-EC');
  c.els.statGroups.textContent = String(visibleGroups);
  c.els.statAffected.textContent = String(affected);
}

function refreshAll(c) {
  refreshFeatureVisibility(c);
  refreshFeatureStyles(c);
  renderGroupList(c);
  updateHeader(c);
  updateRanking(c);
  syncHashState(c);
}

function setMode(c, mode) {
  c.state.mode = mode;
  if (c.els.btnModeGroup && c.els.btnModeOutage) {
    c.els.btnModeGroup.classList.toggle('btn-mini-primary', mode === 'group');
    c.els.btnModeOutage.classList.toggle('btn-mini-primary', mode === 'outage');
  }
  refreshFeatureStyles(c);
  updateRanking(c);
  syncHashState(c);
}

function createMap() {
  const map = L.map('map', { preferCanvas: true, zoomControl: false });
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

  map.on('moveend', debounce(function () { syncHashState(ctx); }, 320));
  map.on('zoomend', debounce(function () { syncHashState(ctx); }, 320));
  map.on('click', function () { closeInfoPanel(ctx); });

  return map;
}

async function onIncFileChange(event) {
  const file = event.target.files && event.target.files[0];
  event.target.value = '';
  if (!file) return;
  try {
    setStatus(ctx, 'Procesando incidencias...', 'warn');
    const points = await parseIncidenceFile(file);
    renderIncidences(ctx, points, file.name);
    setStatus(ctx, 'Incidencias cargadas: ' + points.length, 'ok');
  } catch (error) {
    setStatus(ctx, 'No se pudo cargar incidencias: ' + (error && error.message ? error.message : ''), 'err');
  }
}

async function onCsvFileChange(event) {
  const file = event.target.files && event.target.files[0];
  event.target.value = '';
  if (!file) return;
  try {
    setStatus(ctx, 'Procesando CSV de polígonos...', 'warn');
    await loadCsvPolygonData(ctx, file);
    setStatus(ctx, 'CSV cargado: ' + ctx.state.csvPaint.rows.size + ' polígonos enlazados.', 'ok');
  } catch (err) {
    setStatus(ctx, 'Error: ' + (err && err.message ? err.message : 'No se pudo cargar el CSV.'), 'err');
  }
}

function getDatasetIdFromQuery() {
  const params = new URLSearchParams(window.location.search);
  return params.get('dataset');
}

async function resolveDatasetRecord() {
  if (ctx.state.datasetId) {
    return window.GeoStore.getDataset(ctx.state.datasetId);
  }
  const latest = await window.GeoStore.getLatestDataset();
  if (latest) {
    ctx.state.datasetId = latest.id;
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
