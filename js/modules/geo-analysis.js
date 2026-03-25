export function analyzeGeojsonInWorker(geojson) {
  return new Promise(function (resolve, reject) {
    const worker = new Worker('js/workers/geo.worker.js');
    const timeout = setTimeout(function () {
      worker.terminate();
      reject(new Error('El análisis tardó demasiado.'));
    }, 30000);

    worker.onmessage = function (event) {
      const msg = event && event.data ? event.data : null;
      if (!msg) return;
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

export function analyzeGeojsonFallback(geojson) {
  const features = Array.isArray(geojson.features) ? geojson.features : [];
  const grouping = detectGroupBy(features);
  const groupBy = grouping ? grouping.field : null;
  const groupByLabel = grouping ? grouping.label : null;
  const featureMeta = [];
  const groupMap = new Map();
  const buckets = new Array(96).fill(0);
  const schemaMap = new Map();

  for (let i = 0; i < features.length; i += 1) {
    const f = features[i] || {};
    const props = f.properties || {};
    const groupKey = groupBy ? normalizeGroupValue(props[groupBy]) : 'Todas las zonas';
    const slots = normalizeSlots(props.cortes_horas);
    const totalOutageMin = getTotalMinutes(slots);

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

    countBuckets(buckets, slots);
    if (i < 500) collectSchema(schemaMap, props);
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
    propertySchema: buildSchema(schemaMap),
    outageAvailable: groups.some(function (g) { return g.hasOutage; }),
    counts: {
      features: features.length,
      groups: groups.length,
      affectedGroups: groups.filter(function (g) { return g.hasOutage; }).length,
    },
  };
}

function detectGroupBy(features) {
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

function normalizeSlots(rawValue) {
  const list = Array.isArray(rawValue)
    ? rawValue
    : (typeof rawValue === 'string' ? rawValue.split(/[|;,]/g) : []);

  const slots = [];
  const seen = new Set();
  for (let i = 0; i < list.length; i += 1) {
    const parsed = parseSlot(list[i]);
    if (!parsed) continue;
    const key = parsed[0] + '_' + parsed[1];
    if (seen.has(key)) continue;
    seen.add(key);
    slots.push(parsed);
  }
  return slots;
}

function parseSlot(raw) {
  const clean = String(raw || '').replace(/[–—]/g, '-').trim();
  const m = clean.match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/);
  if (!m) return null;
  const start = parseClock(m[1]);
  const end = parseClock(m[2]);
  if (start === null || end === null || start === end) return null;
  return [start, end];
}

function parseClock(raw) {
  const p = String(raw).split(':');
  if (p.length !== 2) return null;
  const h = Number(p[0]);
  const m = Number(p[1]);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  if (h < 0 || h > 24 || m < 0 || m > 59) return null;
  if (h === 24 && m !== 0) return null;
  return h * 60 + m;
}

function getTotalMinutes(slots) {
  let total = 0;
  for (let i = 0; i < slots.length; i += 1) {
    const s = slots[i][0];
    const e = slots[i][1];
    total += e > s ? (e - s) : ((1440 - s) + e);
  }
  return total;
}

function countBuckets(buckets, slots) {
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

function collectSchema(map, props) {
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

function buildSchema(map) {
  const out = [];
  map.forEach(function (row) {
    let mainType = 'string';
    let max = -1;
    row.types.forEach(function (count, t) {
      if (count > max) { max = count; mainType = t; }
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
