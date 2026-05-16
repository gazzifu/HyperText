import { Editor } from 'https://esm.sh/@tiptap/core@2';
import StarterKit from 'https://esm.sh/@tiptap/starter-kit@2';
import Highlight from 'https://esm.sh/@tiptap/extension-highlight@2';
import Link from 'https://esm.sh/@tiptap/extension-link@2';
import Table from 'https://esm.sh/@tiptap/extension-table@2';
import TableRow from 'https://esm.sh/@tiptap/extension-table-row@2';
import TableCell from 'https://esm.sh/@tiptap/extension-table-cell@2';
import TableHeader from 'https://esm.sh/@tiptap/extension-table-header@2';
import SmilesDrawer from 'https://esm.sh/smiles-drawer@2';
import Underline from 'https://esm.sh/@tiptap/extension-underline@2';
import { mathBlock, smilesBlock, mathInline, insertMathBlock, insertSmilesBlock, insertMathInline } from './math-smiles-nodes.js';
import { githubAPI, initGitHub } from './github-api.js';
const katex = window.katex;

// ============================================================
// Zustand
// ============================================================
let editor = null;
let currentNotePath = null;
let saveTimer = null;
let isDirty = false;

const $ = id => document.getElementById(id);


// ============================================================
// Tiptap-Editor initialisieren
// ============================================================
function initEditor() {
  editor = new Editor({
    element: $('editor'),
    extensions: [
      StarterKit,
      Link.configure({openOnClick: true, HTMLAttributes: { target: '_blank',  rel: 'noopener noreferrer', } }),
      Table.configure({ resizable: true }), // NEU
      TableRow,                              // NEU
      TableCell,                             // NEU
      TableHeader,                           // NEU
      Underline,
      Highlight.configure({ multicolor: false }),
      mathBlock(),
      smilesBlock(),
      mathInline(),
    ],
    editorProps: {
      attributes: {
        'data-placeholder': 'Beginne zu schreiben…',
      },
    },
    onUpdate() {
      setDirty(true);
      clearTimeout(saveTimer);
      saveTimer = setTimeout(saveCurrentNote, 20000);
    },
    onSelectionUpdate() {
      updateToolbarState();
    },
  });
}

// ============================================================
// Toolbar-Status aktualisieren
// ============================================================
function updateToolbarState() {
  if (!editor) return;
  document.querySelectorAll('#toolbar button[data-cmd]').forEach(btn => {
    const cmd = btn.dataset.cmd;
    let active = false;
    if (cmd === 'bold')        active = editor.isActive('bold');
    if (cmd === 'italic')      active = editor.isActive('italic');
    if (cmd === 'strike')      active = editor.isActive('strike');
    if (cmd === 'code')        active = editor.isActive('code');
    if (cmd === 'h1')          active = editor.isActive('heading', { level: 1 });
    if (cmd === 'h2')          active = editor.isActive('heading', { level: 2 });
    if (cmd === 'h3')          active = editor.isActive('heading', { level: 3 });
    if (cmd === 'bulletList')  active = editor.isActive('bulletList');
    if (cmd === 'orderedList') active = editor.isActive('orderedList');
    if (cmd === 'blockquote')  active = editor.isActive('blockquote');
    if (cmd === 'codeBlock')   active = editor.isActive('codeBlock');
    if (cmd === 'underline') active = editor.isActive('underline');
    if (cmd === 'highlight') active = editor.isActive('highlight');
    btn.classList.toggle('active', active);
  });
}

// ============================================================
// Editor-Befehl ausführen
// ============================================================
function runCommand(cmd) {
  if (!editor) return;
  const c = editor.chain().focus();
  switch (cmd) {
    case 'bold':        c.toggleBold().run(); break;
    case 'italic':      c.toggleItalic().run(); break;
    case 'strike':      c.toggleStrike().run(); break;
    case 'code':        c.toggleCode().run(); break;
    case 'h1':          c.toggleHeading({ level: 1 }).run(); break;
    case 'h2':          c.toggleHeading({ level: 2 }).run(); break;
    case 'h3':          c.toggleHeading({ level: 3 }).run(); break;
    case 'bulletList':  c.toggleBulletList().run(); break;
    case 'orderedList': c.toggleOrderedList().run(); break;
    case 'blockquote':  c.toggleBlockquote().run(); break;
    case 'codeBlock':   c.toggleCodeBlock().run(); break;
    case 'hr':          c.setHorizontalRule().run(); break;
    case 'undo':        c.undo().run(); break;
    case 'redo':        c.redo().run(); break;
    case 'link':        insertLink(); break;
    case 'deleteNote':  deleteCurrentNote(); break;
    case 'table': c.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(); break;
    case 'addColumnBefore': c.addColumnBefore().run(); break;
    case 'addColumnAfter':  c.addColumnAfter().run();  break;
    case 'toggleHeaderRow': c.toggleHeaderRow().run(); break;
    case 'deleteColumn':    c.deleteColumn().run();    break;
    case 'addRowBefore':    c.addRowBefore().run();    break;
    case 'addRowAfter':     c.addRowAfter().run();     break;
    case 'deleteRow':       c.deleteRow().run();       break;
    case 'deleteTable':     c.deleteTable().run();     break;
    case 'mathBlock':   insertMathBlock();   break;
    case 'smilesBlock': insertSmilesBlock(); break;
    case 'mathInline': insertMathInline(); break;
    case 'underline': c.toggleUnderline().run(); break;
    case 'highlight': c.toggleHighlight().run(); break;
  }
  updateToolbarState();
}

// ============================================================
// Toolbar-Buttons
// ============================================================
document.querySelectorAll('#toolbar button[data-cmd]').forEach(btn => {
  btn.addEventListener('mousedown', e => {
    e.preventDefault(); // Fokus im Editor behalten
    runCommand(btn.dataset.cmd);
  });
});

// ============================================================
// Keyboard Shortcuts
// ============================================================
document.addEventListener('keydown', e => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key === 'n') { e.preventDefault(); createNote(); }
  if (mod && e.key === 's') { e.preventDefault(); saveCurrentNote(); }
  if (e.key === 'Escape')   { closeContextMenu(); closeDialog(); }
});

// ============================================================
// Speichern / Dirty-State
// ============================================================
function setDirty(dirty) {
  isDirty = dirty;
  const ind = $('save-indicator');
  ind.classList.toggle('unsaved', dirty);
  ind.classList.toggle('saved', !dirty);
  ind.title = dirty ? 'Ungespeicherte Änderungen' : 'Gespeichert';
}

async function saveCurrentNote() {
  if (!currentNotePath || !editor) return;
  try {
    const html = editor.getHTML();
    await githubAPI.writeNote(currentNotePath, html);
    setDirty(false);
  } catch (err) {
    console.error('Speichern fehlgeschlagen:', err);
  }
}

// ============================================================
// Notiz laden
// ============================================================
async function loadNote(filename) {
  try {
    const html = await githubAPI.readNote(filename);
    currentNotePath = filename;
    editor.commands.setContent(html || '<p></p>');
    editor.commands.focus();
    setDirty(false);
    updateToolbarState();

    document.querySelectorAll('#note-list li').forEach(li => {
      li.classList.toggle('active', li.dataset.file === filename);
    });

    $('editor-wrap').style.display = '';
    $('empty-state').classList.remove('visible');
  } catch (err) {
    console.error('Laden fehlgeschlagen:', err);
  }
}

// ============================================================
// Sidebar befüllen
// ============================================================
async function refreshSidebar(filter = '') {
  try {
    const { files, folders } = await githubAPI.listContents();

    const list = $('note-list');
    list.innerHTML = '';

    const filtered = files.filter(f =>
      f.toLowerCase().includes(filter.toLowerCase())
    );

    // Alle Ordner vorbelegen (auch leere)
    const groups = {};
    folders.forEach(f => { groups[f] = []; });

    filtered.forEach(f => {
      const parts  = f.split('/');
      const folder = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
      if (!groups[folder]) groups[folder] = [];
      groups[folder].push(f);
    });

    if (filtered.length === 0 && folders.length === 0) {
      const li = document.createElement('li');
      li.textContent = 'Keine Notizen';
      li.style.color = 'var(--text-faint)';
      li.style.pointerEvents = 'none';
      list.appendChild(li);
      return;
    }
    
    Object.entries(groups).forEach(([folder, files]) => {
      if (folder) {
        // Ordner-Header
        const header = document.createElement('li');
        header.classList.add('folder-header');

        const collapsed = localStorage.getItem(`folder-collapsed:${folder}`) === 'true';

        const arrow = document.createElement('span');
        arrow.classList.add('folder-arrow');
        arrow.textContent = collapsed ? '›' : '›';

        const label = document.createElement('span');
        label.classList.add('folder-label');
        label.textContent = folder;

        const addBtn = document.createElement('button');
        addBtn.classList.add('folder-add-btn');
        addBtn.textContent = '+';
        addBtn.title = `Notiz in "${folder}" erstellen`;
        addBtn.addEventListener('click', e => {
          e.stopPropagation();
          createNoteInFolder(folder);
        });

        header.appendChild(arrow);
        header.appendChild(label);
        header.appendChild(addBtn);

        header.addEventListener('contextmenu', e => {
          e.preventDefault();
          e.stopPropagation();
          showFolderContextMenu(e.clientX, e.clientY, folder);
        });

        header.addEventListener('dragover', e => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          header.classList.add('drag-over');
        });
        header.addEventListener('dragleave', () => header.classList.remove('drag-over'));
        header.addEventListener('drop', e => {
          e.preventDefault();
          header.classList.remove('drag-over');
          const srcFile = e.dataTransfer.getData('text/plain');
          if (!srcFile) return;
          moveNoteTo(srcFile, folder);
        });

        // Kollabieren togglen
        header.addEventListener('click', () => {
          const isNowCollapsed = !header.classList.contains('collapsed');
          header.classList.toggle('collapsed', isNowCollapsed);
          localStorage.setItem(`folder-collapsed:${folder}`, isNowCollapsed);
          // Alle zugehörigen Notizen ein/ausblenden
          list.querySelectorAll(`li[data-folder="${folder}"]`).forEach(li => {
            li.style.display = isNowCollapsed ? 'none' : '';
          });
        });

        if (collapsed) header.classList.add('collapsed');
        list.appendChild(header);
      }

      files.forEach(f => {
        const li = document.createElement('li');
        li.textContent = f.split('/').pop().replace(/\.html$/, '');
        li.dataset.file = f;
        li.dataset.folder = folder;
        li.classList.add(folder ? 'note-item-sub' : 'note-item');
        if (currentNotePath && currentNotePath.endsWith(f)) li.classList.add('active');
        if (folder && localStorage.getItem(`folder-collapsed:${folder}`) === 'true') {
          li.style.display = 'none';
        }

        // Drag
        li.draggable = true;
        li.addEventListener('dragstart', e => {
          e.dataTransfer.setData('text/plain', f);
          e.dataTransfer.effectAllowed = 'move';
          li.classList.add('dragging');
        });
        li.addEventListener('dragend', () => li.classList.remove('dragging'));

        li.addEventListener('click', () => loadNote(f));
        li.addEventListener('contextmenu', e => {
          e.preventDefault();
          e.stopPropagation();
          showFileContextMenu(e.clientX, e.clientY, f);
        });
        list.appendChild(li);
      });
    });
    // Root-Drop-Zone (für Dateien aus Unterordnern in Root ziehen)
    const rootDrop = document.createElement('li');
    rootDrop.classList.add('root-drop-zone');
    rootDrop.textContent = 'Hierher ziehen für Root';
    rootDrop.style.display = 'none';

    rootDrop.addEventListener('dragover', e => {
      e.preventDefault();
      rootDrop.style.display = '';
      rootDrop.classList.add('drag-over');
    });
    rootDrop.addEventListener('dragleave', () => rootDrop.classList.remove('drag-over'));
    rootDrop.addEventListener('drop', e => {
      e.preventDefault();
      rootDrop.classList.remove('drag-over');
      rootDrop.style.display = 'none';
      const srcFile = e.dataTransfer.getData('text/plain');
      if (!srcFile) return;
      moveNoteTo(srcFile, '');
    });
    list.appendChild(rootDrop);

    // Root-Drop-Zone beim Drag ein/ausblenden
    list.addEventListener('dragstart', () => {
      rootDrop.style.display = '';
    });
    list.addEventListener('dragend', () => {
      rootDrop.style.display = 'none';
      rootDrop.classList.remove('drag-over');
});
  } catch (err) {
    console.error('Sidebar-Fehler:', err);
  }
}


// ============================================================
// Suche
// ============================================================
$('search-input').addEventListener('input', e => {
  refreshSidebar(e.target.value);
});

// ============================================================
// Sidebar ein/aus
// ============================================================
$('toggle-sidebar-btn').addEventListener('click', () => {
  const sidebar = $('sidebar');
  const btn = $('toggle-sidebar-btn');
  sidebar.classList.toggle("hidden");
  btn.classList.toggle("in-toolbar")
});

const mediaQuery = window.matchMedia('(max-width: 1000px)');

function handleResize(e) {
  const sidebar = $('sidebar');
  const btn = $('toggle-sidebar-btn');
  if (e.matches) {
    sidebar.classList.add('hidden');
    btn.classList.add('in-toolbar');
  } else {
    sidebar.classList.remove('hidden');
    btn.classList.remove('in-toolbar');
  }
}

mediaQuery.addEventListener('change', handleResize);
handleResize(mediaQuery); // beim Start einmal prüfen

// ============================================================
// Neue Notiz
// ============================================================
async function createNote() {
  showDialog('Name der neuen Notiz:', '', async name => {
    if (!name) return;
    const filename = name.replace(/[\\/:*?"<>|]/g, '_') + '.html';
    try {
      await githubAPI.writeNote(filename, '<p></p>');
      await new Promise(r => setTimeout(r, 1000));
      await refreshSidebar();
      await loadNote(filename);
    } catch (err) {
      alert('Fehler: ' + err.message);
    }
  });
}

async function createNoteInFolder(folder) {
  showDialog(`Neue Notiz in "${folder}":`, '', async name => {
    if (!name) return;
    const filename = name.replace(/[\\/:*?"<>|]/g, '_') + '.html';
    const path = `${folder}/${filename}`;
    try {
      await githubAPI.writeNote(path, '<p></p>');
      await new Promise(r => setTimeout(r, 1000));
      await refreshSidebar();
      await loadNote(path);
    } catch (err) {
      alert('Fehler: ' + err.message);
    }
  });
}

async function createFolder() {
  showDialog('Name des neuen Ordners:', '', async name => {
    if (!name) return;
    const folderName = name.replace(/[\\/:*?"<>|]/g, '_');
    try {
      await githubAPI.writeNote(`${folderName}/.gitkeep`, '');
      // GitHub braucht einen Moment
      await new Promise(r => setTimeout(r, 1000));
      await refreshSidebar();
    } catch (err) {
      alert('Fehler: ' + err.message);
    }
  });
}

$('btn-new').addEventListener('click', createFolder);

// ============================================================
// Notiz löschen
// ============================================================
async function deleteCurrentNote() {
  if (!currentNotePath) return;
  showDialog(`"${currentNotePath}" löschen?`, 'Ja, löschen', async confirm => {
    if (confirm !== 'Ja, löschen') return;
    try {
      await githubAPI.deleteNote(currentNotePath);
      await new Promise(r => setTimeout(r, 1000));
      currentNotePath = null;
      editor.commands.setContent('<p></p>');
      $('editor-wrap').style.display = 'none';
      $('empty-state').classList.add('visible');
      setDirty(false);
      await refreshSidebar();
    } catch (err) {
      alert('Löschen fehlgeschlagen: ' + err.message);
    }
  });
}

async function moveNoteTo(srcFile, targetFolder) {
  const filename = srcFile.split('/').pop();
  const newPath  = targetFolder ? `${targetFolder}/${filename}` : filename;
  if (srcFile === newPath) return;
  try {
    await githubAPI.renameNote(srcFile, newPath);
    await new Promise(r => setTimeout(r, 1000));
    if (currentNotePath === srcFile) currentNotePath = newPath;
    await refreshSidebar();
  } catch (err) {
    alert('Verschieben fehlgeschlagen: ' + err.message);
  }
}

let ctxFolder = null;
const folderCtxMenu = document.getElementById('folder-context-menu');

function showFolderContextMenu(x, y, folder) {
  ctxFolder = folder;
  folderCtxMenu.style.display = 'block';
  const mx = Math.min(x, window.innerWidth  - 160 - 8);
  const my = Math.min(y, window.innerHeight - 80  - 8);
  folderCtxMenu.style.left = mx + 'px';
  folderCtxMenu.style.top  = my + 'px';
}

document.getElementById('ctx-folder-rename').onclick = () => {
  folderCtxMenu.style.display = 'none';
  if (!ctxFolder) return;
  showDialog(`Ordner umbenennen: "${ctxFolder}"`, ctxFolder, async newName => {
    if (!newName || newName === ctxFolder) return;
    try {
      await githubAPI.renameFolder(ctxFolder, newName);
      await new Promise(r => setTimeout(r, 1000));
      if (currentNotePath && currentNotePath.startsWith(ctxFolder + '/')) {
        currentNotePath = currentNotePath.replace(ctxFolder, newName);
      }
      await refreshSidebar();
    } catch (err) {
      alert('Umbenennen fehlgeschlagen: ' + err.message);
    }
  });
};

document.getElementById('ctx-folder-delete').onclick = () => {
  folderCtxMenu.style.display = 'none';
  if (!ctxFolder) return;
  showDialog(`Ordner "${ctxFolder}" löschen?`, 'Ja, löschen', async confirm => {
    if (confirm !== 'Ja, löschen') return;
    try {
      await githubAPI.deleteFolder(ctxFolder);
      await new Promise(r => setTimeout(r, 1000));
      if (currentNotePath && currentNotePath.startsWith(ctxFolder + '/')) {
        currentNotePath = null;
        editor.commands.setContent('<p></p>');
        $('editor-wrap').style.display = 'none';
        $('empty-state').classList.add('visible');
        setDirty(false);
      }
      await refreshSidebar();
    } catch (err) {
      alert('Löschen fehlgeschlagen: ' + err.message);
    }
  });
};

document.addEventListener('click', e => {
  if (!folderCtxMenu.contains(e.target)) folderCtxMenu.style.display = 'none';
});

// ============================================================
// Link einfügen
// ============================================================
function insertLink() {
  const current = editor.getAttributes('link').href || '';
  showDialog('URL:', current, url => {
    if (url) {
      editor.chain().focus().setLink({ href: url }).run();
    } else {
      editor.chain().focus().unsetLink().run();
    }
  });
}

// ============================================================
// Kontextmenü
// ============================================================
const ctxMenu = $('context-menu');

$('editor').addEventListener('contextmenu', e => {
  e.preventDefault();

  // Tabellen-Einträge ein/ausblenden
  const inTable = editor.isActive('table');
  document.querySelectorAll('[data-cmd^="addColumn"],[data-cmd^="deleteColumn"],[data-cmd^="addRow"],[data-cmd^="deleteRow"],[data-cmd="deleteTable"],[data-cmd="toggleHeaderRow')
    .forEach(el => el.style.display = inTable ? '' : 'none');
  document.getElementById('ctx-table-sep').style.display = inTable ? '' : 'none';

  ctxMenu.style.display = 'block';
  const mw = 200, mh = ctxMenu.offsetHeight || 250;
  const x = Math.min(e.clientX, window.innerWidth  - mw - 8);
  const y = Math.min(e.clientY, window.innerHeight - mh - 8);
  ctxMenu.style.left = x + 'px';
  ctxMenu.style.top  = y + 'px';
});

document.querySelectorAll('.ctx-item').forEach(item => {
  item.addEventListener('click', () => {
    runCommand(item.dataset.cmd);
    closeContextMenu();
  });
});

document.addEventListener('click', e => {
  if (!ctxMenu.contains(e.target)) closeContextMenu();
});

function closeContextMenu() {
  ctxMenu.style.display = 'none';
}

// ============================================================
// Datei-Kontextmenü
// ============================================================

let ctxFile = null;
const fileCtxMenu = document.getElementById('file-context-menu');

function showFileContextMenu(x, y, filename) {
  ctxFile = filename;
  fileCtxMenu.style.display = 'block';
  const mx = Math.min(x, window.innerWidth  - 160 - 8);
  const my = Math.min(y, window.innerHeight - 80  - 8);
  fileCtxMenu.style.left = mx + 'px';
  fileCtxMenu.style.top  = my + 'px';
}

document.getElementById('ctx-rename').onclick = () => {
  fileCtxMenu.style.display = 'none';
  if (!ctxFile) return;
  const current = ctxFile.split('/').pop().replace(/\.html$/, '');
  showDialog(`Umbenennen: "${current}"`, current, async newName => {
    if (!newName || newName === current) return;
    const folder  = ctxFile.includes('/') ? ctxFile.split('/').slice(0, -1).join('/') : '';
    const newFile = newName.replace(/[\\/:*?"<>|]/g, '_') + '.html';
    const newPath = folder ? `${folder}/${newFile}` : newFile;
    try {
      await githubAPI.renameNote(ctxFile, newPath);
      await new Promise(r => setTimeout(r, 1000));
      if (currentNotePath === ctxFile) currentNotePath = newPath;
      await refreshSidebar();
    } catch (err) {
      alert('Umbenennen fehlgeschlagen: ' + err.message);
    }
  });
};

document.getElementById('ctx-delete-file').onclick = () => {
  fileCtxMenu.style.display = 'none';
  if (!ctxFile) return;
  showDialog(`"${ctxFile.split('/').pop()}" löschen?`, 'Ja, löschen', async confirm => {
    if (confirm !== 'Ja, löschen') return;
    try {
      await githubAPI.deleteNote(ctxFile);
      await new Promise(r => setTimeout(r, 1000));
      if (currentNotePath === ctxFile) {
        currentNotePath = null;
        editor.commands.setContent('<p></p>');
        $('editor-wrap').style.display = 'none';
        $('empty-state').classList.add('visible');
        setDirty(false);
      }
      await refreshSidebar();
    } catch (err) {
      alert('Löschen fehlgeschlagen: ' + err.message);
    }
  });
};

document.addEventListener('click', e => {
  if (!fileCtxMenu.contains(e.target)) fileCtxMenu.style.display = 'none';
});

// ============================================================
// Dialog (ersetzt window.prompt)
// ============================================================
let dialogCallback = null;

function showDialog(label, defaultValue, callback) {
  $('dialog-label').textContent = label;
  $('dialog-input').value = defaultValue || '';
  dialogCallback = callback;
  $('overlay').classList.remove('hidden');
  setTimeout(() => $('dialog-input').focus(), 50);
}

function closeDialog() {
  $('overlay').classList.add('hidden');
  dialogCallback = null;
}

$('dialog-ok').onclick = () => {
  const val = $('dialog-input').value.trim();
  const cb = dialogCallback;
  closeDialog();
  if (cb) cb(val);
};

$('dialog-cancel').onclick = closeDialog;

$('dialog-input').onkeydown = e => {
  if (e.key === 'Enter') $('dialog-ok').onclick();
};

// ============================================================
// Notizordner wählen (über Tauri Dialog)
// ============================================================
$('btn-settings').textContent = '⎋ Abmelden';
$('btn-settings').onclick = () => {
  showDialog('Abmelden und Token löschen?', 'Ja', confirm => {
    if (confirm !== 'Ja') return;
    localStorage.removeItem('github_token');
    localStorage.removeItem('github_repo');
    localStorage.removeItem('github_branch');
    location.reload();
  });
};

// ============================================================
// Start
// ============================================================
await initGitHub();
initEditor();
window._editor = editor;

