const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const fileInfo = document.getElementById('file-info');
const fiName = document.getElementById('fi-name');
const fiMeta = document.getElementById('fi-meta');
const fiStatus = document.getElementById('fi-status');
const errorMsg = document.getElementById('error-msg');
const sizeWarn = document.getElementById('size-warn');
const btnOpen = document.getElementById('btn-open');

let loaded = null;

dropZone.addEventListener('dragover', onDragOver);
dropZone.addEventListener('dragleave', onDragLeave);
dropZone.addEventListener('drop', onDrop);
fileInput.addEventListener('change', onInputChange);
btnOpen.addEventListener('click', onOpen);

function onDragOver(event) {
  event.preventDefault();
  dropZone.classList.add('drag-over');
}

function onDragLeave() {
  dropZone.classList.remove('drag-over');
}

function onDrop(event) {
  event.preventDefault();
  dropZone.classList.remove('drag-over');
  const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
  if (file) processFile(file);
}

function onInputChange() {
  const file = fileInput.files && fileInput.files[0];
  if (file) processFile(file);
}

async function onOpen() {
  if (!loaded) return;

  btnOpen.disabled = true;
  btnOpen.textContent = 'Guardando dataset...';

  try {
    const id = await window.GeoStore.saveDataset({
      name: loaded.datasetName,
      text: loaded.text,
      size: loaded.file.size,
      sourceFileName: loaded.file.name,
    });

    try {
      await window.GeoStore.cleanupOld(10);
    } catch (_) {}

    window.location.href = 'mapa.html?dataset=' + encodeURIComponent(id);
  } catch (error) {
    showError('No se pudo guardar el archivo localmente. ' + (error && error.message ? error.message : ''));
    btnOpen.disabled = false;
    btnOpen.textContent = 'Abrir mapa';
  }
}

function processFile(file) {
  const extension = getExtension(file.name);
  if (!extension || (extension !== 'geojson' && extension !== 'json')) {
    setFileInfo(file.name, formatBytes(file.size), 'ERR');
    showError('Formato no soportado. Usa .geojson o .json.');
    return;
  }

  clearError();
  sizeWarn.hidden = file.size <= 5 * 1024 * 1024;

  setFileInfo(file.name, formatBytes(file.size) + ' - leyendo...', '...');
  btnOpen.disabled = true;

  const reader = new FileReader();

  reader.onload = function onLoad(event) {
    const text = event.target && typeof event.target.result === 'string' ? event.target.result : '';
    let parsed;

    try {
      parsed = JSON.parse(text);
    } catch (_) {
      setFileInfo(file.name, formatBytes(file.size), 'ERR');
      showError('El archivo no es un JSON válido.');
      return;
    }

    if (!parsed || parsed.type !== 'FeatureCollection' || !Array.isArray(parsed.features)) {
      setFileInfo(file.name, formatBytes(file.size), 'ERR');
      showError('El archivo debe ser un GeoJSON tipo FeatureCollection.');
      return;
    }

    if (parsed.features.length === 0) {
      setFileInfo(file.name, formatBytes(file.size), 'ERR');
      showError('El GeoJSON no contiene features.');
      return;
    }

    const geomSummary = summarizeGeomTypes(parsed.features);
    const datasetName = extractDatasetName(parsed, file.name);

    loaded = { text, geojson: parsed, datasetName, file };

    setFileInfo(
      file.name,
      formatBytes(file.size) + ' - ' + parsed.features.length.toLocaleString('es-EC') + ' features - ' + geomSummary,
      'OK'
    );

    fiStatus.classList.remove('err');
    fiStatus.classList.add('ok');

    btnOpen.disabled = false;
    btnOpen.textContent = 'Abrir mapa: ' + datasetName;
  };

  reader.onerror = function onError() {
    setFileInfo(file.name, formatBytes(file.size), 'ERR');
    showError('No se pudo leer el archivo.');
  };

  reader.readAsText(file, 'utf-8');
}

function summarizeGeomTypes(features) {
  const counts = {};
  for (let i = 0; i < features.length; i += 1) {
    const t = features[i] && features[i].geometry && features[i].geometry.type ? features[i].geometry.type : 'Sin geometría';
    counts[t] = (counts[t] || 0) + 1;
  }
  return Object.keys(counts)
    .slice(0, 3)
    .map(function (k) { return k + ': ' + counts[k]; })
    .join(' | ');
}

function extractDatasetName(geojson, fileName) {
  if (geojson && typeof geojson.name === 'string' && geojson.name.trim()) {
    return geojson.name.trim();
  }
  return fileName.replace(/\.[^.]+$/, '');
}

function setFileInfo(name, meta, statusText) {
  fileInfo.hidden = false;
  fiName.textContent = name;
  fiMeta.textContent = meta;
  fiStatus.textContent = statusText;
  fiStatus.classList.remove('ok', 'err');
  if (statusText === 'OK') fiStatus.classList.add('ok');
  if (statusText === 'ERR') fiStatus.classList.add('err');
}

function showError(msg) {
  errorMsg.hidden = false;
  errorMsg.textContent = msg;
  loaded = null;
  btnOpen.disabled = true;
}

function clearError() {
  errorMsg.hidden = true;
  errorMsg.textContent = '';
}

function getExtension(fileName) {
  const i = fileName.lastIndexOf('.');
  if (i < 0) return '';
  return fileName.slice(i + 1).toLowerCase();
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}
