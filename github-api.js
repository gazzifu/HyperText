// ============================================================
// src/github-api.js
// Ersetzt alle invoke()-Calls aus der Desktop-App
// ============================================================
// Änderungen in main.js:
//
// 1. Import ergänzen:
//    import { githubAPI, initGitHub } from './github-api.js';
//
// 2. Den invoke()-Import entfernen:
//    const { invoke } = window.__TAURI__.core;  ← LÖSCHEN
//
// 3. Alle invoke()-Calls ersetzen (siehe unten)
//
// 4. Am Anfang von main.js vor initEditor():
//    await initGitHub();
//    (main.js muss dafür async sein oder top-level await nutzen)
// ============================================================

const STORAGE_TOKEN  = 'github_token';
const STORAGE_REPO   = 'github_repo';   // z.B. "deinname/notizen-privat"
const STORAGE_BRANCH = 'github_branch'; // z.B. "main"

class GitHubAPI {
  constructor() {
    this.token  = localStorage.getItem(STORAGE_TOKEN)  || '';
    this.repo   = localStorage.getItem(STORAGE_REPO)   || '';
    this.branch = localStorage.getItem(STORAGE_BRANCH) || 'main';
  }

  isConfigured() {
    return !!(this.token && this.repo);
  }

  save() {
    localStorage.setItem(STORAGE_TOKEN,  this.token);
    localStorage.setItem(STORAGE_REPO,   this.repo);
    localStorage.setItem(STORAGE_BRANCH, this.branch);
  }

  headers() {
    return {
      'Authorization': `Bearer ${this.token}`,
      'Accept':        'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  // Basis-Request
  async request(method, path, body) {
    const url = `https://api.github.com/repos/${this.repo}/contents/${path}`;
    const res = await fetch(url, {
      method,
      headers: {
        ...this.headers(),
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `GitHub API Fehler: ${res.status}`);
    }

    // DELETE gibt kein JSON zurück
    if (res.status === 204) return null;
    return res.json();
  }

  // ============================================================
  // Ersetzt: list_notes + list_folders
  // Gibt { files: [...], folders: [...] } zurück
  // ============================================================
  async listContents(dir = '') {
    const url = `https://api.github.com/repos/${this.repo}/contents/${dir}`;
    const res = await fetch(url, {
      headers: this.headers(),
    });

    if (res.status === 404) return { files: [], folders: [] };
    if (!res.ok) throw new Error(`Fehler beim Laden: ${res.status}`);

    const items = await res.json();
    if (!Array.isArray(items)) return { files: [], folders: [] };

    const files   = [];
    const folders = [];

    for (const item of items) {
      if (item.type === 'file' && item.name.endsWith('.html') && item.name !== '.gitkeep') {
        files.push(dir ? `${dir}/${item.name}` : item.name);
      } else if (item.type === 'dir' && !item.name.startsWith('.')) {
        const sub = dir ? `${dir}/${item.name}` : item.name;
        folders.push(sub);
        // Rekursiv Unterordner laden
        const subContents = await this.listContents(sub);
        files.push(...subContents.files);
        folders.push(...subContents.folders);
      }
    }

    return { files, folders };
  }

  // ============================================================
  // Ersetzt: read_note
  // ============================================================
  async readNote(path) {
    const data = await this.request('GET', path);
    // GitHub liefert Inhalt als Base64
    return atob(data.content.replace(/\n/g, ''));
  }

  // ============================================================
  // Ersetzt: write_note (neu anlegen + überschreiben)
  // ============================================================
  async writeNote(path, content) {
    // Prüfen ob Datei existiert (für SHA bei Update nötig)
    let sha = undefined;
    try {
      const existing = await this.request('GET', path);
      sha = existing.sha;
    } catch (e) {
      // Datei existiert nicht → neu anlegen, kein SHA nötig
    }

    const body = {
      message: sha ? `Update ${path}` : `Create ${path}`,
      content: btoa(unescape(encodeURIComponent(content))),
      branch:  this.branch,
    };
    if (sha) body.sha = sha;

    await this.request('PUT', path, body);
  }

  // ============================================================
  // Ersetzt: delete_note
  // ============================================================
  async deleteNote(path) {
    const existing = await this.request('GET', path);
    await this.request('DELETE', path, {
      message: `Delete ${path}`,
      sha:     existing.sha,
      branch:  this.branch,
    });
  }

  // ============================================================
  // Ersetzt: rename_note (GitHub hat kein Rename → kopieren + löschen)
  // ============================================================
  async renameNote(oldPath, newPath) {
    const content = await this.readNote(oldPath);
    await this.writeNote(newPath, content);
    await this.deleteNote(oldPath);
  }

  // ============================================================
  // Ersetzt: rename_folder
  // ============================================================
  async renameFolder(oldFolder, newFolder) {
    const { files } = await this.listContents(oldFolder);
    for (const file of files) {
      const newFile = file.replace(oldFolder, newFolder);
      await this.renameNote(file, newFile);
    }
  }

  // ============================================================
  // Ersetzt: delete_folder
  // ============================================================
  async deleteFolder(folder) {
    const { files } = await this.listContents(folder);
    for (const file of files) {
      await this.deleteNote(file);
    }
  }
}

export const githubAPI = new GitHubAPI();

// ============================================================
// Login-Screen
// ============================================================
export async function initGitHub() {
  if (githubAPI.isConfigured()) return;

  // Login-Overlay anzeigen
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.id = 'github-login';
    overlay.innerHTML = `
      <div id="github-login-dialog">
        <h2>Notizen-Manager</h2>
        <p>Gib deine GitHub-Zugangsdaten ein um zu starten.</p>

        <label>Personal Access Token
          <input type="password" id="gh-token" placeholder="ghp_..." />
        </label>
        <label>Notiz-Repository
          <input type="text" id="gh-repo" placeholder="deinname/notizen-privat" />
        </label>
        <label>Branch
          <input type="text" id="gh-branch" value="main" />
        </label>

        <button id="gh-login-btn">Verbinden</button>
        <p id="gh-error"></p>
      </div>
    `;
    document.body.appendChild(overlay);

    document.getElementById('gh-login-btn').onclick = async () => {
      const token  = document.getElementById('gh-token').value.trim();
      const repo   = document.getElementById('gh-repo').value.trim();
      const branch = document.getElementById('gh-branch').value.trim() || 'main';
      const errEl  = document.getElementById('gh-error');

      if (!token || !repo) {
        errEl.textContent = 'Bitte alle Felder ausfüllen.';
        return;
      }

      // Token testen
      const btn = document.getElementById('-btn');
      btn.textContent = 'Verbinde…';
      btn.disabled = true;

      try {
        const res = await fetch(`https://api.github.com/repos/${repo}`, {
            headers: { 'Authorization': `Bearer ${token}` },
        });
        if (!res.ok) throw new Error('Repository nicht gefunden oder kein Zugriff.');

        githubAPI.token  = token;
        githubAPI.repo   = repo;
        githubAPI.branch = branch;
        githubAPI.save();

        overlay.remove();
        resolve();
    } catch (err) {
        errEl.textContent = err.message;
        btn.textContent = 'Verbinden';
        btn.disabled = false;
      }
    };

    // Enter-Taste
    overlay.addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById('gh-login-btn').click();
    });
  });
}

// ============================================================
// CSS für Login-Screen – in styles.css anhängen
// ============================================================
/*

#github-login {
  position: fixed;
  inset: 0;
  background: var(--bg);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}

#github-login-dialog {
  background: var(--bg-dialog);
  border: 1px solid var(--border-light);
  border-radius: 10px;
  padding: 32px;
  width: 360px;
  box-shadow: 0 24px 64px rgba(0,0,0,0.6);
}

#github-login-dialog h2 {
  font-family: var(--font-ui);
  font-size: 18px;
  font-weight: 500;
  color: var(--text);
  margin-bottom: 8px;
}

#github-login-dialog p {
  font-size: 13px;
  color: var(--text-muted);
  margin-bottom: 20px;
  line-height: 1.5;
}

#github-login-dialog label {
  display: block;
  font-size: 12px;
  color: var(--text-muted);
  margin-bottom: 12px;
}

#github-login-dialog input {
  display: block;
  width: 100%;
  margin-top: 4px;
  background: var(--bg-active);
  border: 1px solid var(--border-light);
  border-radius: var(--radius);
  color: var(--text);
  font-family: var(--font-ui);
  font-size: 13px;
  padding: 7px 10px;
  outline: none;
}

#github-login-dialog input:focus {
  border-color: var(--accent-dim);
}

#gh-login-btn {
  width: 100%;
  margin-top: 8px;
  padding: 9px;
  background: var(--accent-dim);
  border: none;
  border-radius: var(--radius);
  color: var(--text);
  font-family: var(--font-ui);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s;
}

#gh-login-btn:hover:not(:disabled) { background: var(--accent); }
#gh-login-btn:disabled { opacity: 0.5; cursor: default; }

#gh-error {
  margin-top: 10px;
  font-size: 12px;
  color: var(--danger);
  min-height: 16px;
}

*/