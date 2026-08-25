// db.js — Persistencia local (IndexedDB). Offline-first, sin dependencia de botón "Guardar".

const DB_NAME = 'gestion-tactica-bomberos';
const DB_VERSION = 1;
const STORE_META = 'meta';           // cuartel base, personal permanente de Pilar
const STORE_ACTIVE = 'incidente_activo'; // 1 solo registro: el incidente en curso
const STORE_ARCHIVO = 'incidentes_finalizados'; // historial de incidentes cerrados

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORE_ACTIVE)) db.createObjectStore(STORE_ACTIVE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORE_ARCHIVO)) db.createObjectStore(STORE_ARCHIVO, { keyPath: 'id' });
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
  return dbPromise;
}

function tx(storeName, mode) {
  return openDB().then((db) => db.transaction(storeName, mode).objectStore(storeName));
}

const DB = {
  async getMeta() {
    const store = await tx(STORE_META, 'readonly');
    return new Promise((resolve, reject) => {
      const req = store.get('cuartel');
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  },
  async setMeta(meta) {
    const store = await tx(STORE_META, 'readwrite');
    return new Promise((resolve, reject) => {
      const req = store.put({ id: 'cuartel', ...meta });
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  },
  async getActiveIncident() {
    const store = await tx(STORE_ACTIVE, 'readonly');
    return new Promise((resolve, reject) => {
      const req = store.get('activo');
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  },
  async saveActiveIncident(state) {
    const store = await tx(STORE_ACTIVE, 'readwrite');
    return new Promise((resolve, reject) => {
      const req = store.put({ id: 'activo', ...state });
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  },
  async clearActiveIncident() {
    const store = await tx(STORE_ACTIVE, 'readwrite');
    return new Promise((resolve, reject) => {
      const req = store.delete('activo');
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  },
  async archiveIncident(state) {
    const store = await tx(STORE_ARCHIVO, 'readwrite');
    return new Promise((resolve, reject) => {
      const req = store.put({ ...state, id: state.incidente.id });
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  },
  async listArchivedIncidents() {
    const store = await tx(STORE_ARCHIVO, 'readonly');
    return new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  },
  async getArchivedIncident(id) {
    const store = await tx(STORE_ARCHIVO, 'readonly');
    return new Promise((resolve, reject) => {
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }
};
