// ============================================================
// src/layout-nodes.js
// Zweispaltiges Layout + Callout-Boxen als echte Container-Nodes
// ============================================================
// Änderungen in main.js:
//
// 1. Import ergänzen:
//    import { columnLayout, column, callout, insertColumnLayout, insertCallout } from './layout-nodes.js';
//
// 2. In initEditor() extensions[] ergänzen:
//    columnLayout(),
//    column(),
//    callout(),
//
// 3. In runCommand() ergänzen:
//    case 'columnLayout':  insertColumnLayout();     break;
//    case 'calloutInfo':   insertCallout('info');    break;
//    case 'calloutWarn':   insertCallout('warning'); break;
//    case 'calloutTip':    insertCallout('tip');     break;
//    case 'calloutDanger': insertCallout('danger');  break;
//
// 4. Toolbar in index.html ergänzen:
//    <div class="sep"></div>
//    <button data-cmd="columnLayout"  title="Zweispaltig">⫿</button>
//    <button data-cmd="calloutInfo"   title="Info-Box">ℹ</button>
//    <button data-cmd="calloutWarn"   title="Warn-Box">⚠</button>
//    <button data-cmd="calloutTip"    title="Tipp-Box">💡</button>
//    <button data-cmd="calloutDanger" title="Gefahr-Box">⛔</button>
//
// 5. Kontextmenü in index.html ergänzen:
//    <div class="ctx-sep"></div>
//    <div class="ctx-item" data-cmd="columnLayout">Zweispaltiges Layout</div>
//    <div class="ctx-item" data-cmd="calloutInfo">Info-Box</div>
//    <div class="ctx-item" data-cmd="calloutWarn">Warn-Box</div>
//    <div class="ctx-item" data-cmd="calloutTip">Tipp-Box</div>
//    <div class="ctx-item" data-cmd="calloutDanger">Gefahr-Box</div>
//
// 6. CSS am Ende von styles.css ergänzen (siehe ganz unten)
// ============================================================

import { Node, mergeAttributes } from 'https://esm.sh/@tiptap/core@2';

// ============================================================
// Zweispaltiges Layout
// ============================================================

export function columnLayout() {
  return Node.create({
    name: 'columnLayout',
    group: 'block',
    content: 'column column',
    isolating: true,

    parseHTML() {
      return [{ tag: 'div[data-type="column-layout"]' }];
    },

    renderHTML({ HTMLAttributes }) {
      return ['div', mergeAttributes(HTMLAttributes, {
        'data-type': 'column-layout',
        'class': 'column-layout',
      }), 0];
    },
  });
}

export function column() {
  return Node.create({
    name: 'column',
    group: 'block',
    content: 'block+',
    isolating: true,

    parseHTML() {
      return [{ tag: 'div[data-type="column"]' }];
    },

    renderHTML({ HTMLAttributes }) {
      return ['div', mergeAttributes(HTMLAttributes, {
        'data-type': 'column',
        'class': 'column-pane',
      }), 0];
    },
  });
}

// ============================================================
// Callout-Boxen
// ============================================================

export function callout() {
  return Node.create({
    name: 'callout',
    group: 'block',
    content: 'block+',
    isolating: true,

    addAttributes() {
      return {
        type: {
          default: 'info',
          parseHTML: el => el.getAttribute('data-callout-type') || 'info',
          renderHTML: attrs => ({ 'data-callout-type': attrs.type }),
        },
      };
    },

    parseHTML() {
      return [{ tag: 'div[data-type="callout"]' }];
    },

    renderHTML({ HTMLAttributes }) {
      const type = HTMLAttributes['data-callout-type'] || 'info';
      return ['div', mergeAttributes(HTMLAttributes, {
        'data-type': 'callout',
        'class': `callout callout-${type}`,
      }), 0];
    },

    addNodeView() {
      return ({ node, getPos, editor }) => {
        const ICONS  = { info: 'ℹ', warning: '⚠', tip: '💡', danger: '⛔' };
        const LABELS = { info: 'Info', warning: 'Warnung', tip: 'Tipp', danger: 'Gefahr' };

        const outer = document.createElement('div');
        outer.classList.add('callout', `callout-${node.attrs.type}`);

        const header = document.createElement('div');
        header.classList.add('callout-header');

        const icon = document.createElement('span');
        icon.classList.add('callout-icon');
        icon.textContent = ICONS[node.attrs.type] || 'ℹ';

        const label = document.createElement('span');
        label.classList.add('callout-label');
        label.textContent = LABELS[node.attrs.type] || 'Info';

        const typeSelect = document.createElement('select');
        typeSelect.classList.add('callout-type-select');
        Object.entries(LABELS).forEach(([key, val]) => {
          const opt = document.createElement('option');
          opt.value = key;
          opt.textContent = `${ICONS[key]} ${val}`;
          if (key === node.attrs.type) opt.selected = true;
          typeSelect.appendChild(opt);
        });

        typeSelect.addEventListener('mousedown', e => e.stopPropagation());
        typeSelect.addEventListener('change', () => {
          const newType = typeSelect.value;
          icon.textContent  = ICONS[newType];
          label.textContent = LABELS[newType];
          outer.className   = `callout callout-${newType}`;
          if (typeof getPos === 'function') {
            editor.commands.command(({ tr, state }) => {
              const pos = getPos();
              if (pos === undefined) return false;
              const n = state.doc.nodeAt(pos);
              if (!n) return false;
              tr.setNodeMarkup(pos, undefined, { type: newType });
              return true;
            });
          }
        });

        header.appendChild(icon);
        header.appendChild(label);
        header.appendChild(typeSelect);

        const contentEl = document.createElement('div');
        contentEl.classList.add('callout-content');

        outer.appendChild(header);
        outer.appendChild(contentEl);

        return {
          dom: outer,
          contentDOM: contentEl,
          update(updatedNode) {
            if (updatedNode.type !== node.type) return false;
            const t = updatedNode.attrs.type || 'info';
            outer.className   = `callout callout-${t}`;
            icon.textContent  = ICONS[t] || 'ℹ';
            label.textContent = LABELS[t] || 'Info';
            typeSelect.value  = t;
            return true;
          },
        };
      };
    },
  });
}

// ============================================================
// Einfüge-Funktionen
// ============================================================

export function insertColumnLayout() {
  window._editor.chain().focus().insertContent({
    type: 'columnLayout',
    content: [
      { type: 'column', content: [{ type: 'paragraph' }] },
      { type: 'column', content: [{ type: 'paragraph' }] },
    ],
  }).run();
}

export function insertCallout(type) {
  window._editor.chain().focus().insertContent({
    type: 'callout',
    attrs: { type },
    content: [{ type: 'paragraph' }],
  }).run();
}

// ============================================================
// CSS – in styles.css anhängen
// ============================================================
/*

.column-layout {
  display: flex;
  gap: 0;
  margin: 1.5em 0;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
}

.column-pane {
  flex: 1;
  padding: 1em 1.2em;
  min-height: 80px;
  min-width: 0;
}

.column-pane + .column-pane {
  border-left: 1px solid var(--border);
}

.column-pane p { margin: 0 0 0.5em; }
.column-pane p:last-child { margin: 0; }

.callout {
  margin: 1.2em 0;
  border-radius: var(--radius);
  border-left: 4px solid;
  overflow: hidden;
}

.callout-info    { border-color: #5a8fc8; background: #1a2535; }
.callout-warning { border-color: #c8a040; background: #2a2010; }
.callout-tip     { border-color: #5aaa6a; background: #162216; }
.callout-danger  { border-color: #c05040; background: #251510; }

.callout-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 14px;
  border-bottom: 1px solid rgba(255,255,255,0.05);
}

.callout-icon { font-size: 14px; }

.callout-label {
  flex: 1;
  font-family: var(--font-ui);
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
}

.callout-type-select {
  background: transparent;
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 4px;
  color: var(--text-faint);
  font-size: 11px;
  padding: 2px 4px;
  cursor: pointer;
  outline: none;
}

.callout-content {
  padding: 10px 14px;
}

.callout-content p { margin: 0 0 0.4em; }
.callout-content p:last-child { margin: 0; }

*/