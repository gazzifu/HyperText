// ============================================================
// sync.js
// Sync zwischen IndexedDB (lokal) und GitHub (remote)
// ============================================================

import { localDB } from './local-db.js';
import { githubAPI } from './github-api.js';

// Sync-Status UI
let statusEl = null;

function setStatus(text, type = 'idle') {
  if (!statusEl) {
    statusEl = document.getElementById('sync-status');
    if (!statusEl) return;
  }
  statusEl.textContent = text;
  statusEl.className   = `sync-status sync-${type}`;
}

// ============================================================
// Erster Start: alles von GitHub in IndexedDB laden
// ============================================================
export async function initialSync() {
  setStatus('Synchronisiere…', 'syncing');
  try {
    const { files } = await githubAPI.listContents();

    // Nur .html-Dateien, .gitkeep ignorieren
    const htmlFiles = files.filter(f => f.endsWith('.html'));

    if (htmlFiles.length === 0) {
      setStatus('Bereit', 'idle');
      return;
    }

    // Alle Notizen parallel laden (max 5 gleichzeitig um Rate Limit zu schonen)
    const notes = [];
    for (let i = 0; i < htmlFiles.length; i += 5) {
      const batch = htmlFiles.slice(i, i + 5);
      const results = await Promise.all(
        batch.map(async path => {
          try {
            const content = await githubAPI.readNote(path);
            return { path, content };
          } catch (e) {
            console.warn('Konnte nicht laden:', path, e);
            return null;
          }
        })
      );
      notes.push(...results.filter(Boolean));
      setStatus(`Lade ${Math.min(i + 5, htmlFiles.length)}/${htmlFiles.length}…`, 'syncing');
    }

    await localDB.importFromGitHub(notes);
    setStatus('Synchronisiert ✓', 'done');
    setTimeout(() => setStatus('', 'idle'), 3000);
  } catch (err) {
    console.error('Sync fehlgeschlagen:', err);
    setStatus('Sync fehlgeschlagen', 'error');
  }
}

// ============================================================
// Hintergrund-Sync: Queue abarbeiten
// ============================================================
let syncRunning = false;

export async function processQueue() {
  if (syncRunning) return;
  syncRunning = true;

  try {
    const queue = await localDB.listQueue();
    if (queue.length === 0) { syncRunning = false; return; }

    setStatus(`Speichere ${queue.length} Änderung(en)…`, 'syncing');

    for (const item of queue) {
      try {
        switch (item.type) {
          case 'write':
            await githubAPI.writeNote(item.path, item.content);
            break;
          case 'delete':
            await githubAPI.deleteNote(item.path);
            break;
          case 'rename':
            await githubAPI.renameNote(item.path, item.newPath);
            break;
          case 'rename-folder':
            await githubAPI.renameFolder(item.path, item.newPath);
            break;
          case 'delete-folder':
            await githubAPI.deleteFolder(item.path);
            break;
          case 'create-folder':
            await githubAPI.writeNote(`${item.path}/.gitkeep`, '');
            break;
        }
        await localDB.dequeue(item.id);
      } catch (err) {
        console.warn('Queue-Eintrag fehlgeschlagen:', item, err);
        // Nicht aus Queue entfernen – beim nächsten Mal nochmal versuchen
      }
    }

    setStatus('Synchronisiert ✓', 'done');
    setTimeout(() => setStatus('', 'idle'), 3000);
  } catch (err) {
    setStatus('Sync fehlgeschlagen', 'error');
  } finally {
    syncRunning = false;
  }
}

// Queue alle 30 Sekunden abarbeiten
export function startBackgroundSync() {
  processQueue(); // sofort einmal
  setInterval(processQueue, 30000);
}

// ============================================================
// Wrapper-Funktionen die main.js aufruft
// (ersetzen direkte githubAPI-Calls)
// ============================================================

export async function writeNote(path, content) {
  // 1. Sofort lokal speichern
  await localDB.writeNote(path, content);
  // 2. In Queue für GitHub
  await localDB.enqueue({ type: 'write', path, content });
  // 3. Sofort versuchen zu syncen
  processQueue();
}

export async function deleteNote(path) {
  await localDB.deleteNote(path);
  await localDB.enqueue({ type: 'delete', path });
  processQueue();
}

export async function renameNote(oldPath, newPath) {
  await localDB.renameNote(oldPath, newPath);
  await localDB.enqueue({ type: 'rename', path: oldPath, newPath });
  processQueue();
}

export async function createFolder(path) {
  await localDB.createFolder(path);
  await localDB.enqueue({ type: 'create-folder', path });
  processQueue();
}

export async function renameFolder(oldPath, newPath) {
  await localDB.renameFolder(oldPath, newPath);
  await localDB.enqueue({ type: 'rename-folder', path: oldPath, newPath });
  processQueue();
}

export async function deleteFolder(path) {
  await localDB.deleteFolder(path);
  await localDB.enqueue({ type: 'delete-folder', path });
  processQueue();
}

export async function readNote(path) {
  return localDB.readNote(path);
}

export async function listContents() {
  const files   = await localDB.listNotes();
  const folders = await localDB.listFolders();
  return { files, folders };
}