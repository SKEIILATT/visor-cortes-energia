self.onmessage = function onMessage(event) {
  const payload = event && event.data ? event.data : null;
  if (!payload || payload.type !== 'analyze') {
    return;
  }

  try {
    const result = analyze(payload.geojson);
    self.postMessage({ type: 'ok', result: result });
  } catch (error) {
    self.postMessage({
      type: 'error',
      error: error && error.message ? error.message : 'Error desconocido en worker',
    });
  }
};

function analyze(geojson) {
  const features = Array.isArray(geojson && geojson.features) ? geojson.features : [];
  const grouping = detectGroupBy(features);
  const groupBy = grouping ? grouping.field : null;
  const groupByLabel = grouping ? grouping.label : null;

  const featureMeta = new Array(features.length);
  const groupMap = new Map();
  const buckets = new Array(96).fill(0);
  const propertyStats = new Map();

  for (let i = 0; i < features.length; i += 1) {
    const feature = features[i] || {};
    const props = feature.properties || {};
    const groupKey = groupBy
      ? normalizeGroupValue(props[groupBy])
      : 'Todas las zonas';
    const slots = normalizeSlots(props.cortes_horas);
    const totalOutageMin = getTotalMinutes(slots);

    const meta = {
      id: i,
      groupKey: groupKey,
      slots: slots,
      slotCount: slots.length,
      hasOutage: slots.length > 0,
      totalOutageMin: totalOutageMin,
      geometryType: feature.geometry && feature.geometry.type ? feature.geometry.type : 'Sin geometría',
    };

    featureMeta[i] = meta;

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

    const group = groupMap.get(groupKey);
    group.featureIds.push(i);
    group.featureCount += 1;
    group.slotCount += slots.length;
    group.totalOutageMin += totalOutageMin;
    if (slots.length > 0) {
      group.hasOutage = true;
    }

    incrementBuckets(buckets, slots);

    if (i < 600) {
      collectPropertyStats(propertyStats, props);
    }
  }

  const groups = Array.from(groupMap.values()).sort(function sortGroups(a, b) {
    return a.key.localeCompare(b.key, 'es', { sensitivity: 'base' });
  });

  const propertySchema = buildPropertySchema(propertyStats);
  const outageAvailable = groups.some(function someOutage(g) { return g.hasOutage; });

  return {
    groupBy: groupBy,
    groupByLabel: groupByLabel,
    featureMeta: featureMeta,
    groups: groups,
    buckets: buckets,
    propertySchema: propertySchema,
    outageAvailable: outageAvailable,
    counts: {
      features: features.length,
      groups: groups.length,
      affectedGroups: groups.filter(function onlyAffected(g) { return g.hasOutage; }).length,
    },
  };
}

function detectGroupBy(features) {
  if (!features.length) {
    return null;
  }

  const priority = [
    'subgrupo', 'grupo', 'group', 'sector', 'zona', 'zone',
    'district', 'barrio', 'parroquia', 'name', 'nombre'
  ];

  const sample = features.slice(0, 10).map(function mapFeature(f) {
    return f && f.properties ? f.properties : {};
  });

  const keys = new Set();
  for (let i = 0; i < sample.length; i += 1) {
    const obj = sample[i];
    Object.keys(obj).forEach(function addKey(k) { keys.add(k); });
  }

  const keyList = Array.from(keys);

  for (let i = 0; i < priority.length; i += 1) {
    const target = priority[i];
    for (let j = 0; j < keyList.length; j += 1) {
      const key = keyList[j];
      if (key.toLowerCase() === target) {
        return { field: key, label: key };
      }
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
  if (value === null || value === undefined) {
    return 'N/A';
  }
  const txt = String(value).trim();
  return txt || 'N/A';
}

function normalizeSlots(rawValue) {
  const values = toSlotArray(rawValue);
  if (!values.length) {
    return [];
  }

  const ranges = [];
  const seen = new Set();

  for (let i = 0; i < values.length; i += 1) {
    const parsed = parseSlot(values[i]);
    if (!parsed) {
      continue;
    }

    const key = parsed.start + '_' + parsed.end;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    ranges.push([parsed.start, parsed.end]);
  }

  return ranges;
}

function toSlotArray(rawValue) {
  if (Array.isArray(rawValue)) {
    return rawValue;
  }

  if (typeof rawValue === 'string') {
    if (!rawValue.trim()) {
      return [];
    }

    if (rawValue.includes('|')) {
      return rawValue.split('|');
    }
    if (rawValue.includes(';')) {
      return rawValue.split(';');
    }
    if (rawValue.includes(',')) {
      return rawValue.split(',');
    }

    return [rawValue];
  }

  return [];
}

function parseSlot(raw) {
  if (raw === null || raw === undefined) {
    return null;
  }

  const clean = String(raw)
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();

  const match = clean.match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/);
  if (!match) {
    return null;
  }

  const start = parseClock(match[1]);
  const end = parseClock(match[2]);

  if (start === null || end === null) {
    return null;
  }

  if (start === end) {
    return null;
  }

  return {
    start: start,
    end: end,
  };
}

function parseClock(raw) {
  const parts = String(raw).split(':');
  if (parts.length !== 2) {
    return null;
  }

  const hh = Number(parts[0]);
  const mm = Number(parts[1]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) {
    return null;
  }

  if (hh < 0 || hh > 24 || mm < 0 || mm > 59) {
    return null;
  }

  if (hh === 24 && mm !== 0) {
    return null;
  }

  return hh * 60 + mm;
}

function getTotalMinutes(slots) {
  let total = 0;

  for (let i = 0; i < slots.length; i += 1) {
    const range = slots[i];
    const start = range[0];
    const end = range[1];

    if (end > start) {
      total += (end - start);
    } else {
      total += (1440 - start) + end;
    }
  }

  return total;
}

function incrementBuckets(buckets, slots) {
  for (let i = 0; i < slots.length; i += 1) {
    const start = slots[i][0];
    const end = slots[i][1];

    if (end > start) {
      fillRangeBuckets(buckets, start, end);
    } else {
      fillRangeBuckets(buckets, start, 1440);
      fillRangeBuckets(buckets, 0, end);
    }
  }
}

function fillRangeBuckets(buckets, start, end) {
  for (let minute = start; minute < end; minute += 15) {
    const bucket = Math.floor(minute / 15);
    if (bucket >= 0 && bucket < 96) {
      buckets[bucket] += 1;
    }
  }
}

function collectPropertyStats(storage, props) {
  const keys = Object.keys(props || {});

  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    const value = props[key];

    if (!storage.has(key)) {
      storage.set(key, {
        key: key,
        count: 0,
        nonNull: 0,
        types: new Map(),
        sample: null,
      });
    }

    const row = storage.get(key);
    row.count += 1;

    if (value !== null && value !== undefined && value !== '') {
      row.nonNull += 1;
      if (row.sample === null) {
        row.sample = String(value);
      }
    }

    const t = detectType(value);
    row.types.set(t, (row.types.get(t) || 0) + 1);
  }
}

function detectType(value) {
  if (value === null || value === undefined || value === '') {
    return 'empty';
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return 'number';
  }
  if (typeof value === 'boolean') {
    return 'boolean';
  }
  if (typeof value === 'string') {
    return 'string';
  }
  return 'other';
}

function buildPropertySchema(propertyStats) {
  const out = [];

  propertyStats.forEach(function each(row) {
    let mainType = 'string';
    let max = -1;

    row.types.forEach(function countType(val, t) {
      if (t === 'empty') {
        return;
      }
      if (val > max) {
        max = val;
        mainType = t;
      }
    });

    out.push({
      key: row.key,
      count: row.count,
      nonNull: row.nonNull,
      mainType: mainType,
      sample: row.sample,
    });
  });

  out.sort(function sortSchema(a, b) {
    if (b.nonNull !== a.nonNull) {
      return b.nonNull - a.nonNull;
    }
    return a.key.localeCompare(b.key, 'es', { sensitivity: 'base' });
  });

  return out.slice(0, 80);
}
