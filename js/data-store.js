(function attachGeoStore(globalScope) {
  'use strict';

  const DB_NAME = 'geojson_viewer_db';
  const STORE_NAME = 'datasets';
  const DB_VERSION = 1;

  function hasIndexedDB() {
    return typeof indexedDB !== 'undefined';
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      if (!hasIndexedDB()) {
        reject(new Error('IndexedDB no está disponible en este navegador.'));
        return;
      }

      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = function onUpgrade(event) {
        const db = event.target.result;

        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }
      };

      req.onsuccess = function onSuccess() {
        resolve(req.result);
      };

      req.onerror = function onError() {
        reject(req.error || new Error('No se pudo abrir IndexedDB.'));
      };
    });
  }

  async function withStore(mode, handler) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode);
      const store = tx.objectStore(STORE_NAME);

      let settled = false;

      tx.oncomplete = function onComplete() {
        if (!settled) {
          resolve();
        }
      };

      tx.onerror = function onTxError() {
        reject(tx.error || new Error('Error de transacción en IndexedDB.'));
      };

      tx.onabort = function onAbort() {
        reject(tx.error || new Error('La transacción fue cancelada.'));
      };

      try {
        handler(store, resolve, reject, function markSettled() {
          settled = true;
        });
      } catch (error) {
        reject(error);
      }
    }).finally(() => {
      db.close();
    });
  }

  function createId() {
    const rand = Math.random().toString(36).slice(2, 10);
    return 'ds_' + Date.now() + '_' + rand;
  }

  async function saveDataset(payload) {
    const item = {
      id: createId(),
      name: payload.name || 'Dataset sin nombre',
      text: payload.text,
      size: payload.size || payload.text.length,
      createdAt: Date.now(),
      sourceFileName: payload.sourceFileName || null,
    };

    await withStore('readwrite', (store, resolve, reject, markSettled) => {
      const req = store.put(item);
      req.onsuccess = function onOk() {
        markSettled();
        resolve(item.id);
      };
      req.onerror = function onErr() {
        reject(req.error || new Error('No se pudo guardar el dataset.'));
      };
    });

    return item.id;
  }

  async function getDataset(id) {
    return withStore('readonly', (store, resolve, reject, markSettled) => {
      const req = store.get(id);
      req.onsuccess = function onOk() {
        markSettled();
        resolve(req.result || null);
      };
      req.onerror = function onErr() {
        reject(req.error || new Error('No se pudo leer el dataset.'));
      };
    });
  }

  async function getLatestDataset() {
    return withStore('readonly', (store, resolve, reject, markSettled) => {
      const index = store.index('createdAt');
      const req = index.openCursor(null, 'prev');
      req.onsuccess = function onOk(event) {
        const cursor = event.target.result;
        markSettled();
        resolve(cursor ? cursor.value : null);
      };
      req.onerror = function onErr() {
        reject(req.error || new Error('No se pudo obtener el último dataset.'));
      };
    });
  }

  async function listDatasets(limit) {
    const rows = [];
    const max = Number(limit) > 0 ? Number(limit) : 20;

    return withStore('readonly', (store, resolve, reject, markSettled) => {
      const index = store.index('createdAt');
      const req = index.openCursor(null, 'prev');

      req.onsuccess = function onOk(event) {
        const cursor = event.target.result;
        if (!cursor || rows.length >= max) {
          markSettled();
          resolve(rows);
          return;
        }

        rows.push({
          id: cursor.value.id,
          name: cursor.value.name,
          size: cursor.value.size,
          createdAt: cursor.value.createdAt,
        });

        cursor.continue();
      };

      req.onerror = function onErr() {
        reject(req.error || new Error('No se pudo listar datasets.'));
      };
    });
  }

  async function removeDataset(id) {
    return withStore('readwrite', (store, resolve, reject, markSettled) => {
      const req = store.delete(id);
      req.onsuccess = function onOk() {
        markSettled();
        resolve(true);
      };
      req.onerror = function onErr() {
        reject(req.error || new Error('No se pudo eliminar el dataset.'));
      };
    });
  }

  async function cleanupOld(keepLastN) {
    const keep = Math.max(1, Number(keepLastN) || 3);
    const all = await listDatasets(500);

    if (all.length <= keep) {
      return 0;
    }

    const toDelete = all.slice(keep);
    for (let i = 0; i < toDelete.length; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await removeDataset(toDelete[i].id);
    }
    return toDelete.length;
  }

  globalScope.GeoStore = {
    saveDataset,
    getDataset,
    getLatestDataset,
    listDatasets,
    removeDataset,
    cleanupOld,
  };
}(window));
