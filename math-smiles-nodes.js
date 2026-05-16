// ============================================================
// ANHÄNGEN AN main.js
// ============================================================
// Außerdem folgende Änderungen vornehmen:
//
// 1. Imports oben ergänzen:
//    import katex from 'https://esm.sh/katex@0.16';
//    import SmilesDrawer from 'https://esm.sh/smiles-drawer@2';
//
// 2. In index.html im <head> ergänzen:
//    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16/dist/katex.min.css">
//
// 3. In initEditor() bei extensions[] ergänzen:
//    mathBlock(),
//    smilesBlock(),
//
// 4. In runCommand() ergänzen:
//    case 'mathBlock':   insertMathBlock();   break;
//    case 'smilesBlock': insertSmilesBlock(); break;
//
// 5. In index.html Toolbar ergänzen:
//    <button data-cmd="mathBlock"   title="Mathe-Block (LaTeX)">∑</button>
//    <button data-cmd="smilesBlock" title="Molekül (SMILES)">⬡</button>
//
// 6. In index.html Kontextmenü ergänzen:
//    <div class="ctx-item" data-cmd="mathBlock">Mathe-Block (LaTeX)</div>
//    <div class="ctx-item" data-cmd="smilesBlock">Molekül (SMILES)</div>
//
// 7. In styles.css ergänzen (am Ende):
//    Siehe CSS-Block unten
// ============================================================

import { Node, mergeAttributes } from 'https://esm.sh/@tiptap/core@2';

// ============================================================
// Hilfsfunktion: NodeView-Fabrik
// Baut den gemeinsamen Rahmen für Math und SMILES
// ============================================================
function makeBlockNodeView(renderFn, placeholder) {
  return ({ node, getPos, editor }) => {
    // Äußerer Container
    const outer = document.createElement('div');
    outer.classList.add('custom-block');

    // Render-Anzeige (gerenderte Ausgabe)
    const display = document.createElement('div');
    display.classList.add('custom-block-display');

    // Code-Editor (Textarea)
    const textarea = document.createElement('textarea');
    textarea.classList.add('custom-block-input');
    textarea.spellcheck = false;
    textarea.value = node.attrs.code || '';
    textarea.placeholder = placeholder;

    outer.appendChild(display);
    outer.appendChild(textarea);

    // Zustand: editing oder rendered
    let editing = false;

    function render() {
      const code = textarea.value.trim();
      display.innerHTML = '';
      if (!code) {
        display.innerHTML = `<span class="custom-block-empty">${placeholder}</span>`;
        return;
      }
      try {
        renderFn(code, display);
        display.classList.remove('custom-block-error');
      } catch (err) {
        display.textContent = '⚠ ' + err.message;
        display.classList.add('custom-block-error');
      }
    }

    function showEditor() {
      editing = true;
      outer.classList.add('editing');
      textarea.style.display = 'block';
      display.style.display = 'none';
      setTimeout(() => textarea.focus(), 0);
    }

    function showRendered() {
        editing = false;
        outer.classList.remove('editing');
        textarea.style.display = 'none';
        display.style.display = 'block';
        render();
        // Code in Node speichern – sicher über Command statt direktem Dispatch
        if (typeof getPos === 'function') {
            try {
            editor.commands.command(({ tr, state }) => {
                const pos = getPos();
                if (pos === undefined) return false;
                const nodeAtPos = state.doc.nodeAt(pos);
                if (!nodeAtPos) return false;
                tr.setNodeMarkup(pos, undefined, { code: textarea.value });
                return true;
            });
            } catch (e) {
            // Position ungültig, ignorieren
            }
        }
    }

    // Klick auf Render-Anzeige → Editor öffnen
    display.addEventListener('click', () => {
      if (!editing) showEditor();
    });

    // Fokus verloren → rendern
    textarea.addEventListener('blur', () => {
      showRendered();
    });

    // Escape → rendern
    textarea.addEventListener('keydown', e => {
        // Alle Events stoppen damit Tiptap den Node nicht ersetzt
        e.stopPropagation();
        if (e.key === 'Escape') {
            e.preventDefault();
            textarea.blur();
        }
        if (e.key === 'Tab') {
            e.preventDefault();
            const start = textarea.selectionStart;
            const end   = textarea.selectionEnd;
            textarea.value = textarea.value.slice(0, start) + '  ' + textarea.value.slice(end);
            textarea.selectionStart = textarea.selectionEnd = start + 2;
        }
    });

    // Auch keyup und keypress stoppen
    textarea.addEventListener('keyup',    e => e.stopPropagation());
    textarea.addEventListener('keypress', e => e.stopPropagation());
    // Initial rendern
    render();
    textarea.style.display = 'none';

    return {
      dom: outer,
      // Tiptap ruft dies auf wenn der Node von außen aktualisiert wird
      update(updatedNode) {
        if (updatedNode.type !== node.type) return false;
        textarea.value = updatedNode.attrs.code || '';
        if (!editing) render();
        return true;
      },
      // Verhindert dass Tiptap den Node selbst rendert
      ignoreMutation() { return true; },
    };
  };
}

// ============================================================
// Math-Node (KaTeX)
// ============================================================
export function mathBlock() {
  return Node.create({
    name: 'mathBlock',
    group: 'block',
    atom: true,
    draggable: true,

    addAttributes() {
      return {
        code: { default: '' },
      };
    },

    parseHTML() {
      return [{ tag: 'div[data-type="math"]' }];
    },

    renderHTML({ HTMLAttributes }) {
      return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'math' })];
    },

    addNodeView() {
      return makeBlockNodeView((code, container) => {
        katex.render(code, container, {
          throwOnError: true,
          displayMode: true,
        });
      }, 'LaTeX eingeben, z.B.  x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}');
    },
  });
}

// ============================================================
// SMILES-Node (SmilesDrawer)
// ============================================================
export function smilesBlock() {
  return Node.create({
    name: 'smilesBlock',
    group: 'block',
    atom: true,
    draggable: true,

    addAttributes() {
      return {
        code: { default: '' },
      };
    },

    parseHTML() {
      return [{ tag: 'div[data-type="smiles"]' }];
    },

    renderHTML({ HTMLAttributes }) {
      return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'smiles' })];
    },

    addNodeView() {
      return makeBlockNodeView((code, container) => {
        const canvas = document.createElement('canvas');
        canvas.width  = 200;
        canvas.height = 180;
        container.appendChild(canvas);
        const drawer = new SmilesDrawer.Drawer({ width: 200, height: 120, themes: {
          dark: {
            C: '#e8e3db', O: '#e05a4e', N: '#6a9fd8', F: '#5abf7a',
            CL: '#5abf7a', BR: '#c8793a', I: '#9b6bb5', P: '#c8a96e',
            S: '#c8c84e', B: '#e09060', SI: '#aaaaaa', H: '#e8e3db',
          }
        }});
        SmilesDrawer.parse(code, tree => {
          drawer.draw(tree, canvas, 'dark', false);
        }, err => { throw new Error(err); });
      }, 'SMILES eingeben, z.B.  CCO  für Ethanol');
    },
  });
}

// ============================================================
// Einfüge-Funktionen (in runCommand aufrufen)
// ============================================================
export function insertMathBlock() {
  window._editor.chain().focus()
    .insertContent({ type: 'mathBlock', attrs: { code: '' } })
    .run();
  // Direkt in Bearbeitungsmodus – NodeView öffnet sich beim nächsten Klick
}

export function insertSmilesBlock() {
  window._editor.chain().focus()
    .insertContent({ type: 'smilesBlock', attrs: { code: '' } })
    .run();
}

// ============================================================
// Inline-Math-Node (KaTeX)
// ============================================================
export function mathInline() {
  return Node.create({
    name: 'mathInline',
    group: 'inline',
    inline: true,
    atom: true,
    draggable: false,

    addAttributes() {
      return {
        code: { default: '' },
      };
    },

    parseHTML() {
      return [{ tag: 'span[data-type="math-inline"]' }];
    },

    renderHTML({ HTMLAttributes }) {
      return ['span', mergeAttributes(HTMLAttributes, { 'data-type': 'math-inline' })];
    },

    addNodeView() {
      return ({ node, getPos, editor }) => {
        const outer = document.createElement('span');
        outer.classList.add('math-inline');

        const display = document.createElement('span');
        display.classList.add('math-inline-display');

        const input = document.createElement('input');
        input.type = 'text';
        input.classList.add('math-inline-input');
        input.spellcheck = false;
        input.value = node.attrs.code || '';
        input.placeholder = 'LaTeX…';

        outer.appendChild(display);
        outer.appendChild(input);

        let editing = false;

        function render() {
          const code = input.value.trim();
          display.innerHTML = '';
          if (!code) {
            display.innerHTML = '<span class="math-inline-empty">$…$</span>';
            return;
          }
          try {
            katex.render(code, display, { throwOnError: true, displayMode: false });
            display.classList.remove('math-inline-error');
          } catch (err) {
            display.textContent = '⚠';
            display.title = err.message;
            display.classList.add('math-inline-error');
          }
        }

        function showEditor() {
          editing = true;
          outer.classList.add('editing');
          input.style.display = 'inline';
          display.style.display = 'none';
          setTimeout(() => { input.focus(); input.select(); }, 0);
        }

        function showRendered() {
          editing = false;
          outer.classList.remove('editing');
          input.style.display = 'none';
          display.style.display = 'inline';
          render();
          try {
            editor.commands.command(({ tr, state }) => {
              const pos = getPos();
              if (pos === undefined) return false;
              const nodeAtPos = state.doc.nodeAt(pos);
              if (!nodeAtPos) return false;
              tr.setNodeMarkup(pos, undefined, { code: input.value });
              return true;
            });
          } catch (e) {}
        }

        display.addEventListener('click', () => { if (!editing) showEditor(); });

        input.addEventListener('blur', () => showRendered());

        input.addEventListener('keydown', e => {
          e.stopPropagation();
          if (e.key === 'Escape' || e.key === 'Enter') {
            e.preventDefault();
            input.blur();
          }
        });
        input.addEventListener('keyup',    e => e.stopPropagation());
        input.addEventListener('keypress', e => e.stopPropagation());

        render();
        input.style.display = 'none';

        return {
          dom: outer,
          update(updatedNode) {
            if (updatedNode.type !== node.type) return false;
            input.value = updatedNode.attrs.code || '';
            if (!editing) render();
            return true;
          },
          ignoreMutation() { return true; },
        };
      };
    },
  });
}

export function insertMathInline() {
  window._editor.chain().focus()
    .insertContent({ type: 'mathInline', attrs: { code: '' } })
    .run();
}