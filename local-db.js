// ============================================================
// local-db.js
// IndexedDB Wrapper – alle Notizen lokal speichern
// ============================================================

const DB_NAME    = 'notizen-manager';
const DB_VERSION = 1;
const STORE_NOTES   = 'notes';
const STORE_FOLDERS = 'folders';
const STORE_QUEUE   = 'sync-queue'; // ausstehende GitHub-Syncs

// ============================================================
// DB öffnen
// ============================================================
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = e => {
      const db = e.target.result;

      // Notizen: key = Pfad (z.B. "Chemie/Notiz1.html")
      if (!db.objectStoreNames.contains(STORE_NOTES)) {
        const store = db.createObjectStore(STORE_NOTES, { keyPath: 'path' });
        store.createIndex('folder', 'folder', { unique: false });
      }

      // Ordner: key = Pfad (z.B. "Chemie")
      if (!db.objectStoreNames.contains(STORE_FOLDERS)) {
        db.createObjectStore(STORE_FOLDERS, { keyPath: 'path' });
      }

      // Sync-Queue: ausstehende Operationen
      if (!db.objectStoreNames.contains(STORE_QUEUE)) {
        db.createObjectStore(STORE_QUEUE, { keyPath: 'id', autoIncrement: true });
      }
    };

    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

// ============================================================
// Hilfsfunktionen
// ============================================================
function tx(db, stores, mode = 'readonly') {
  const t = db.transaction(stores, mode);
  return {
    t,
    store: name => t.objectStore(name),
    done: new Promise((res, rej) => {
      t.oncomplete = res;
      t.onerror    = e => rej(e.target.error);
    }),
  };
}

function req2promise(req) {
  return new Promise((res, rej) => {
    req.onsuccess = e => res(e.target.result);
    req.onerror   = e => rej(e.target.error);
  });
}

// ============================================================
// LocalDB Klasse
// ============================================================
class LocalDB {
  constructor() {
    this._db = null;
  }

  async init() {
    this._db = await openDB();
  }

  get db() {
    if (!this._db) throw new Error('DB nicht initialisiert');
    return this._db;
  }

  // ----------------------------------------------------------
  // Notizen
  // ----------------------------------------------------------

  async listNotes() {
    const { store } = tx(this.db, [STORE_NOTES]);
    const all = await req2promise(store(STORE_NOTES).getAll());
    return all.map(n => n.path).sort((a, b) => a.localeCompare(b));
  }

  async listFolders() {
    const { store } = tx(this.db, [STORE_FOLDERS]);
    const all = await req2promise(store(STORE_FOLDERS).getAll());
    return all.map(f => f.path).sort((a, b) => a.localeCompare(b));
  }

  async readNote(path) {
    const { store } = tx(this.db, [STORE_NOTES]);
    const note = await req2promise(store(STORE_NOTES).get(path));
    return note ? note.content : null;
  }

  async writeNote(path, content) {
    const folder = path.includes('/') ? path.split('/').slice(0, -1).join('/') : '';
    const { t, store, done } = tx(this.db, [STORE_NOTES, STORE_FOLDERS], 'readwrite');

    store(STORE_NOTES).put({
      path,
      content,
      folder,
      updatedAt: Date.now(),
    });

    // Ordner anlegen falls nötig
    if (folder) {
      await this._ensureFolderChain(folder, store);
    }

    await done;
  }

  async deleteNote(path) {
    const { store, done } = tx(this.db, [STORE_NOTES], 'readwrite');
    store(STORE_NOTES).delete(path);
    await done;
  }

  async renameNote(oldPath, newPath) {
    const note = await this.readNote(oldPath);
    if (note === null) throw new Error('Notiz nicht gefunden');
    await this.writeNote(newPath, note);
    await this.deleteNote(oldPath);
  }

  async renameFolder(oldFolder, newFolder) {
    const notes = await this.listNotes();
    const affected = notes.filter(n => n.startsWith(oldFolder + '/'));
    for (const path of affected) {
      const newPath = path.replace(oldFolder, newFolder);
      await this.renameNote(path, newPath);
    }
    // Ordner umbenennen
    const { store, done } = tx(this.db, [STORE_FOLDERS], 'readwrite');
    store(STORE_FOLDERS).delete(oldFolder);
    store(STORE_FOLDERS).put({ path: newFolder });
    await done;
  }

  async deleteFolder(folder) {
    const notes = await this.listNotes();
    const affected = notes.filter(n => n.startsWith(folder + '/'));
    for (const path of affected) {
      await this.deleteNote(path);
    }
    const { store, done } = tx(this.db, [STORE_FOLDERS], 'readwrite');
    store(STORE_FOLDERS).delete(folder);
    await done;
  }

  async createFolder(path) {
    const { store, done } = tx(this.db, [STORE_FOLDERS], 'readwrite');
    store(STORE_FOLDERS).put({ path });
    await done;
  }

  // Stellt sicher dass alle Elternordner existieren
  async _ensureFolderChain(folder, store) {
    const parts = folder.split('/');
    for (let i = 1; i <= parts.length; i++) {
      const p = parts.slice(0, i).join('/');
      store(STORE_FOLDERS).put({ path: p });
    }
  }

  // ----------------------------------------------------------
  // Sync-Queue
  // ----------------------------------------------------------

  async enqueue(operation) {
    // operation: { type: 'write'|'delete'|'rename', path, newPath?, content? }
    const { store, done } = tx(this.db, [STORE_QUEUE], 'readwrite');
    store(STORE_QUEUE).add({
      ...operation,
      createdAt: Date.now(),
    });
    await done;
  }

  async dequeue(id) {
    const { store, done } = tx(this.db, [STORE_QUEUE], 'readwrite');
    store(STORE_QUEUE).delete(id);
    await done;
  }

  async listQueue() {
    const { store } = tx(this.db, [STORE_QUEUE]);
    return req2promise(store(STORE_QUEUE).getAll());
  }

  // ----------------------------------------------------------
  // Bulk-Import (beim GitHub-Sync)
  // ----------------------------------------------------------

  async importFromGitHub(notes) {
    // notes: Array von { path, content }
    const { store, done } = tx(this.db, [STORE_NOTES, STORE_FOLDERS], 'readwrite');
    for (const note of notes) {
      const folder = note.path.includes('/')
        ? note.path.split('/').slice(0, -1).join('/')
        : '';
      store(STORE_NOTES).put({
        path: note.path,
        content: note.content,
        folder,
        updatedAt: Date.now(),
      });
      if (folder) {
        const parts = folder.split('/');
        for (let i = 1; i <= parts.length; i++) {
          store(STORE_FOLDERS).put({ path: parts.slice(0, i).join('/') });
        }
      }
    }
    await done;
  }
}

export const localDB = new LocalDB();