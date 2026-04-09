import { createState, createEls, GROUP_COLORS, GAP_FILL } from './state.js';
import { setStatus, debounce } from './utils.js';
import { analyzeGeojsonInWorker, analyzeGeojsonFallback } from './geo-analysis.js';
import { applyTheme, toggleTheme, loadThemePreference } from './theme.js';
import { readHashState, applyPendingHashState, syncHashState } from './hash-state.js';
import { buildFeatureLayers, refreshFeatureVisibility, refreshFeatureStyles, fitInitialView, hideAllFeatureTooltips } from './layers.js';
import {
  updateGeomToggleButton,
  refreshFusedStyles, refreshFusedVisibility, toggleGeometryMode,
} from './fused.js';
import {
  prepareGroups, renderGroupList,
  setAllGroupsVisibility, invertGroupsVisibility, showAffectedOnly,
} from './groups.js';
import {
  setMinute, togglePlayback, setPlaybackSpeed,
  buildTimelineTrack, countAffectedGroups, countOutageGroups,
} from './timeline.js';
import { updateRanking } from './ranking.js';
import { renderInsights } from './insights.js';
import { openInfoPanel, closeInfoPanel } from './info-panel.js';
import { parseIncidenceFile, renderIncidences, toggleIncidenceLayer, toggleIncidenceCluster, clearIncidences } from './incidents.js';
import { loadCsvPolygonData, clearCsvPaint } from './csv-paint.js';
import { runOverlapResolver, setCompareMode, exportResolvedGeoJSON } from './overlap.js';
import { exportFeatureTableCsv, exportFusedGeoJSON } from './export.js';
import { shouldFeatureBeVisible } from './layers.js';
import {
  initEditor, buildLayerMap,
  activateVertexEdit, activateDragMode, activateDeleteMode, activateCutMode,
  startDraw, finishEditing, exitEditorMode,
  exportOriginalGeoJSON, exportModifiedGeoJSON,
} from './editor.js';

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
    renderInsights:      function (c) { renderInsights(c); },
    setColorMode:        function (c, mode) { setColorMode(c, mode); },
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
  initEditor(ctx);

  setStatus(ctx, 'Analizando capas y propiedades...', 'warn');
  try {
    ctx.state.analysis = await analyzeGeojsonInWorker(ctx.state.geojson);
  } catch (_) {
    ctx.state.analysis = analyzeGeojsonFallback(ctx.state.geojson);
    setStatus(ctx, 'Worker no disponible, usando análisis local.', 'warn');
  }

  prepareGroups(ctx);
  buildFeatureLayers(ctx);
  buildLayerMap(ctx);
  buildTimelineTrack(ctx);
  applyPendingHashState(ctx);

  updateHeader(ctx);
  renderGroupList(ctx);
  renderInsights(ctx);
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
  // ── Modo dual ───────────────────────────────────────────────────────
  const btnModeView = document.getElementById('btn-mode-view');
  const btnModeEdit = document.getElementById('btn-mode-edit');
  if (btnModeView) btnModeView.addEventListener('click', function () { setAppMode('view'); });
  if (btnModeEdit) btnModeEdit.addEventListener('click', function () { setAppMode('edit'); });

  // ── Editor de polígonos ─────────────────────────────────────────────
  const btnEditV = document.getElementById('btn-edit-vertices');
  const btnEditD = document.getElementById('btn-edit-drag');
  const btnEditC = document.getElementById('btn-edit-cut');
  const btnEditX = document.getElementById('btn-edit-delete');
  const btnDrawP = document.getElementById('btn-draw-Polygon');
  const btnDrawL = document.getElementById('btn-draw-Line');
  const btnFinish = document.getElementById('btn-finish-editing');
  const btnExpOrig = document.getElementById('btn-export-original-geojson');
  const btnExpMod  = document.getElementById('btn-export-modified-geojson');

  if (btnEditV)  btnEditV.addEventListener('click',  function () { activateVertexEdit(ctx); });
  if (btnEditD)  btnEditD.addEventListener('click',  function () { activateDragMode(ctx); });
  if (btnEditC)  btnEditC.addEventListener('click',  function () { activateCutMode(ctx); });
  if (btnEditX)  btnEditX.addEventListener('click',  function () { activateDeleteMode(ctx); });
  if (btnDrawP)  btnDrawP.addEventListener('click',  function () { startDraw(ctx, 'Polygon'); });
  if (btnDrawL)  btnDrawL.addEventListener('click',  function () { startDraw(ctx, 'Line'); });
  if (btnFinish) btnFinish.addEventListener('click', function () { finishEditing(ctx); });
  if (btnExpOrig) btnExpOrig.addEventListener('click', function () { exportOriginalGeoJSON(ctx); });
  if (btnExpMod)  btnExpMod.addEventListener('click',  function () { exportModifiedGeoJSON(ctx); });

  ctx.els.btnTheme.addEventListener('click', function () { toggleTheme(ctx); });
  ctx.els.btnExportCsvAll.addEventListener('click', function () { exportFeatureTableCsv(ctx, false); });
  ctx.els.btnExportCsvVisible.addEventListener('click', function () { exportFeatureTableCsv(ctx, true); });
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
  if (ctx.els.btnRail) {
    ctx.els.btnRail.addEventListener('click', function () { toggleAnalysisRail(ctx, true); });
  }
  if (ctx.els.btnRailClose) {
    ctx.els.btnRailClose.addEventListener('click', function () { toggleAnalysisRail(ctx, false); });
  }

  ctx.els.groupSearch.addEventListener('input', function () { renderGroupList(ctx); });
  ctx.els.btnAll.addEventListener('click', function () { setAllGroupsVisibility(ctx, true); });
  ctx.els.btnNone.addEventListener('click', function () { setAllGroupsVisibility(ctx, false); });
  ctx.els.btnInvert.addEventListener('click', function () { invertGroupsVisibility(ctx); });
  ctx.els.btnAffectedOnly.addEventListener('click', function () { showAffectedOnly(ctx); });
  ctx.els.btnColorGroup.addEventListener('click', function () { setColorMode(ctx, 'group'); });
  ctx.els.btnColorOutage.addEventListener('click', function () { setColorMode(ctx, 'outage'); });
  ctx.els.btnColorVariable.addEventListener('click', function () { setColorMode(ctx, 'variable'); });

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

  document.querySelectorAll('.btn-panel-toggle').forEach(function (btn) {
    btn.addEventListener('click', function () {
      this.closest('.panel').classList.toggle('collapsed');
    });
  });

  ctx.els.btnCsvLoad.addEventListener('click', function () { ctx.els.csvFileInput.click(); });
  ctx.els.csvFileInput.addEventListener('change', onCsvFileChange);
  ctx.els.btnCsvClear.addEventListener('click', function () { clearCsvPaint(ctx); });

  document.addEventListener('keydown', function (event) {
    const tag = event.target && event.target.tagName ? event.target.tagName.toLowerCase() : '';
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      setMinute(ctx, Math.max(0, (ctx.state.minute < 0 ? 0 : ctx.state.minute) - 15));
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      setMinute(ctx, Math.min(1440, (ctx.state.minute < 0 ? 0 : ctx.state.minute) + 15));
    } else if (event.key === 'Escape') {
      closeInfoPanel(ctx);
    }
  });
}

function updateHeader(c) {
  const visibleFeatures = c.state.features.filter(function (feat) {
    return shouldFeatureBeVisible(c, feat);
  }).length;

  const visibleGroups = Array.from(c.state.groups.values()).filter(function (g) {
    return g.visible;
  }).length;

  const affected = c.state.minute >= 0 ? countAffectedGroups(c, c.state.minute) : countOutageGroups(c);
  const peakMinute = getPeakMinute(c);

  c.els.statFeatures.textContent = visibleFeatures.toLocaleString('es-EC');
  c.els.statGroups.textContent = String(visibleGroups);
  c.els.statAffected.textContent = String(affected);
  c.els.statPeak.textContent = peakMinute;
}

function refreshAll(c) {
  refreshFeatureVisibility(c);
  refreshFeatureStyles(c);
  renderGroupList(c);
  updateHeader(c);
  updateRanking(c);
  renderInsights(c);
  syncHashState(c);
}

function setMode(c, mode) {
  c.state.mode = mode;
  if (c.els.btnModeGroup && c.els.btnModeOutage) {
    c.els.btnModeGroup.classList.toggle('btn-mini-primary', mode === 'group');
    c.els.btnModeOutage.classList.toggle('btn-mini-primary', mode === 'outage');
  }
  refreshFeatureStyles(c);
  updateHeader(c);
  updateRanking(c);
  renderInsights(c);
  syncHashState(c);
}

function setColorMode(c, mode) {
  const next = (mode === 'group' || mode === 'outage' || mode === 'variable') ? mode : 'group';
  if (next === 'variable' && (!c.state.csvPaint.loaded || !c.state.csvPaint.activeColumn)) {
    setStatus(c, 'Carga una tabla con variables numéricas antes de usar color por variable.', 'warn');
    return;
  }

  c.state.colorMode = next;
  c.els.btnColorGroup.classList.toggle('btn-mini-primary', next === 'group');
  c.els.btnColorOutage.classList.toggle('btn-mini-primary', next === 'outage');
  c.els.btnColorVariable.classList.toggle('btn-mini-primary', next === 'variable');

  if (next === 'group') {
    c.els.colorModeHelp.textContent = 'El mapa usa colores por grupo.';
  } else if (next === 'outage') {
    c.els.colorModeHelp.textContent = 'El mapa usa colores por intensidad de cortes acumulados.';
  } else {
    c.els.colorModeHelp.textContent = 'El mapa usa colores por la variable tabular activa: ' + c.state.csvPaint.activeColumn + '.';
  }

  refreshFeatureStyles(c);
  updateRanking(c);
  renderInsights(c);
  syncHashState(c);
}

function toggleAnalysisRail(c, open) {
  const rail = document.querySelector('.analysis-rail');
  if (!rail) return;
  rail.classList.toggle('open', open);
  if (c.els.btnRail) c.els.btnRail.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function createMap() {
  const map = L.map('map', { preferCanvas: true, zoomControl: false });
  map.setView([-2.16, -79.9], 11);
  L.control.zoom({ position: 'bottomright' }).addTo(map);

  const layers = {
    'Positron': L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '© <a href="https://carto.com/">CARTO</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }),
    'Positron (sin etiquetas)': L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', {
      attribution: '© <a href="https://carto.com/">CARTO</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }),
    'Dark Matter': L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '© <a href="https://carto.com/">CARTO</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }),
    'OpenStreetMap': L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }),
    'Satélite (Esri)': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      attribution: '© Esri, Maxar, Earthstar Geographics',
      maxZoom: 18,
    }),
  };

  layers['Positron'].addTo(map);
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
  map.on('click', function () {
    hideAllFeatureTooltips(ctx);
    closeInfoPanel(ctx);
  });

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
    renderInsights(ctx);
    setStatus(ctx, 'CSV cargado: ' + ctx.state.csvPaint.rows.size + ' polígonos enlazados.', 'ok');
  } catch (err) {
    setStatus(ctx, 'Error: ' + (err && err.message ? err.message : 'No se pudo cargar el CSV.'), 'err');
  }
}

function getPeakMinute(c) {
  const buckets = c.state.analysis && c.state.analysis.buckets ? c.state.analysis.buckets : [];
  let bestIndex = 0;
  for (let i = 1; i < buckets.length; i += 1) {
    if (buckets[i] > buckets[bestIndex]) bestIndex = i;
  }
  const minute = bestIndex * 15;
  const hh = String(Math.floor(minute / 60)).padStart(2, '0');
  const mm = String(minute % 60).padStart(2, '0');
  return hh + ':' + mm;
}

function setAppMode(mode) {
  const shell = document.querySelector('.app-shell');
  if (!shell) return;
  shell.setAttribute('data-mode', mode);

  const btnView = document.getElementById('btn-mode-view');
  const btnEdit = document.getElementById('btn-mode-edit');
  if (btnView) btnView.classList.toggle('active', mode === 'view');
  if (btnEdit) btnEdit.classList.toggle('active', mode === 'edit');

  if (mode === 'edit') {
    // Al entrar en herramientas: cerrar info panel si estaba abierto
    closeInfoPanel(ctx);
  } else {
    // Al salir de herramientas: desactivar todos los modos de Geoman
    exitEditorMode(ctx);
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
