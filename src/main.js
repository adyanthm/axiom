import './style.css';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } from '@codemirror/view';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { python } from '@codemirror/lang-python';
import { oneDark } from '@codemirror/theme-one-dark';
import { autocompletion } from '@codemirror/autocomplete';
import { searchKeymap, search } from '@codemirror/search';

// ── Dummy Files Storage ────────────────────────────────────────────────────────
const files = {
  'main.py': `import os
import sys

def main():
    print("Welcome to Axiom IDE")
    print(f"Python version: {sys.version}")
    
    # Let's write some real logic
    data = [1, 2, 3, 4, 5]
    total = sum(data)
    print(f"Total: {total}")

if __name__ == "__main__":
    main()
`,
  'utils.py': `def calculate_average(numbers: list[float]) -> float:
    """Calculate the average of a list of numbers."""
    if not numbers:
        return 0.0
    return sum(numbers) / len(numbers)

def format_currency(amount: float) -> str:
    """Format a float as currency."""
    return f"\${amount:,.2f}"

def get_platform_info() -> str:
    """Returns basic platform identifier."""
    import sys
    return sys.platform
`,
  'config.json': `{
  "projectName": "AxiomApp",
  "version": "1.0.0",
  "pythonVersion": "3.11",
  "dependencies": [
    "requests",
    "numpy",
    "pandas"
  ]
}
`
};

let currentFile = 'main.py';

let currentTheme = oneDark;

// Build editor state function
function createEditorState(content) {
  return EditorState.create({
    doc: content,
    extensions: [
      EditorState.allowMultipleSelections.of(true),
      drawSelection(),
      lineNumbers(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      autocompletion(),
      search({top: true}),
      keymap.of([...searchKeymap, ...defaultKeymap, indentWithTab]),
      python(),
      currentTheme,
      EditorView.lineWrapping,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          files[currentFile] = update.state.doc.toString();
        }
        if (update.selectionSet || update.docChanged || update.geometryChanged || update.focusChanged) {
          if (typeof window.updateZoomOrigin === 'function') window.updateZoomOrigin();
        }
      })
    ],
  });
}

let view = new EditorView({
  state: createEditorState(files[currentFile]),
  parent: document.getElementById('editor-wrap'),
});

// File Opener Setup (Easy to rig to Tauri later)
function openFile(filename) {
  if (files[filename] === undefined) return;
  
  // Show the editor in case it was hidden
  document.getElementById('editor-wrap').style.display = 'flex';
  if(document.getElementById('editor-breadcrumb')) document.getElementById('editor-breadcrumb').style.display = 'flex';
  
  // Update current file
  currentFile = filename;
  
  // Reload state with the corresponding file content
  view.setState(createEditorState(files[currentFile]));
  
  // Update styling for explorer items
  document.querySelectorAll('.file-item').forEach(el => {
    if (el.dataset.file === filename) el.classList.add('active');
    else el.classList.remove('active');
  });

  // Update styling for tabs
  document.querySelectorAll('.tab').forEach(el => {
    if (el.dataset.file === filename) el.classList.add('active');
    else el.classList.remove('active');
  });

  // Update breadcrumb
  const breadcrumbCurrent = document.getElementById('breadcrumb-current');
  if (breadcrumbCurrent) {
    let iconHTML = '';
    if (filename.endsWith('.py')) {
      iconHTML = '<i class="fa-brands fa-python" style="color: #4B8BBE; margin-right: 6px;"></i>';
    } else if (filename.endsWith('.json')) {
      iconHTML = '<i class="fa-solid fa-code" style="color: #e06c75; margin-right: 6px;"></i>';
    }
    breadcrumbCurrent.innerHTML = iconHTML + filename;
  }
  
  updateStatus();
};

window.openFile = openFile;

function bindTabEvents() {
  document.querySelectorAll('.tab').forEach(el => {
    // Only bind if we haven't already
    if (el.dataset.bound) return;
    el.dataset.bound = "true";
    
    // Clicking the tab switches to it
    el.addEventListener('click', (e) => {
      // Ignore click if clicking the close button
      if (e.target.closest('.tab-close')) return;
      openFile(el.dataset.file);
    });

    // Clicking the close button
    const closeBtn = el.querySelector('.tab-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation(); // prevent triggering the tab click
        const fileToClose = el.dataset.file;
        el.remove();
        
        // If we closed the currently active file, we should open another one (or clear out)
        if (fileToClose === currentFile) {
          const remainingTabs = document.querySelectorAll('.tab');
          if (remainingTabs.length > 0) {
            // Open the first remaining tab
            openFile(remainingTabs[0].dataset.file);
          } else {
            // Empty state!
            currentFile = null;
            document.getElementById('editor-wrap').style.display = 'none';
            if(document.getElementById('editor-breadcrumb')) document.getElementById('editor-breadcrumb').style.display = 'none';
            document.querySelectorAll('.file-item.active').forEach(i => i.classList.remove('active'));
            // Reset status bar
            if (document.getElementById('sb-cursor')) document.getElementById('sb-cursor').textContent = "";
            if (document.getElementById('sb-words')) document.getElementById('sb-words').textContent = "0 words";
          }
        }
      });
    }
  });
}

// UI Listeners for file clicks
document.querySelectorAll('.file-item').forEach(el => {
  el.addEventListener('click', () => {
    // If the tab doesn't exist, we could create it, but for our dummy showcase we assume it's there.
    openFile(el.dataset.file);
  });
});

bindTabEvents();

// ── Sidebar Resizer Logic ──────────────────────────────────────────────────
const resizer = document.getElementById('resizer');
const sidebar = document.getElementById('sidebar');
let isResizing = false;

resizer.addEventListener('mousedown', (e) => {
  isResizing = true;
  resizer.classList.add('resizing');
  document.body.style.cursor = 'col-resize';
});

window.addEventListener('mousemove', (e) => {
  if (!isResizing) return;
  // Limit structural boundaries realistically
  let newWidth = e.clientX;
  if (newWidth < 150) newWidth = 150;
  if (newWidth > 600) newWidth = 600;
  sidebar.style.width = newWidth + 'px';
});

window.addEventListener('mouseup', () => {
  if (isResizing) {
    isResizing = false;
    resizer.classList.remove('resizing');
    document.body.style.cursor = 'default';
  }
});

// ── Explorer Toolbar Actions (Dummy to be rigged later) ───────────────────
document.getElementById('action-new-file').addEventListener('click', (e) => {
  e.stopPropagation();
  alert("Dummy action: Creating a new file (awaiting Tauri impl.)");
});
document.getElementById('action-new-folder').addEventListener('click', (e) => {
  e.stopPropagation();
  alert("Dummy action: Creating a new folder (awaiting Tauri impl.)");
});
document.getElementById('action-refresh').addEventListener('click', (e) => {
  e.stopPropagation();
  alert("Dummy action: Refreshing Explorer (awaiting Tauri impl.)");
});
document.getElementById('action-collapse').addEventListener('click', (e) => {
  e.stopPropagation();
  alert("Dummy action: Collapsing all folders (awaiting Tauri impl.)");
});

// ── Context Menu Logic (Dummy to be rigged later) ─────────────────────────
const contextMenu = document.getElementById('context-menu');
let activeContextFile = null;

// Attach right-click listeners to file items
document.querySelectorAll('.file-item').forEach(el => {
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    activeContextFile = el.dataset.file;
    contextMenu.style.left = e.pageX + 'px';
    contextMenu.style.top = e.pageY + 'px';
    contextMenu.classList.remove('hidden');
  });
});

// Hide context menu on global map clicks
window.addEventListener('click', () => {
  contextMenu.classList.add('hidden');
});

// Context Menu actions
document.getElementById('ctx-rename').addEventListener('click', () => {
  alert(`Dummy action: Renaming \${activeContextFile}`);
});
document.getElementById('ctx-delete').addEventListener('click', () => {
  alert(`Dummy action: Deleting \${activeContextFile}`);
});
document.getElementById('ctx-copy').addEventListener('click', () => {
  alert(`Dummy action: Copying path of \${activeContextFile}`);
});

// Run Button Logic
document.getElementById('run-btn').addEventListener('click', () => {
  console.log(`Executing ${currentFile}...`);
  // Dummy execution simulation
  alert(`Starting dummy execution for ${currentFile}...\nCheck console for output details (if any).`);
});

// ── Status bar — live cursor position ─────────────────────────────────────────
const cursorEl  = document.getElementById('sb-cursor');
const wordsEl   = document.getElementById('sb-words');

function updateStatus() {
  const sel    = view.state.selection.main;
  const line   = view.state.doc.lineAt(sel.head);
  const col    = sel.head - line.from + 1;
  if (cursorEl) cursorEl.textContent = `Ln ${line.number}, Col ${col}`;

  const text   = view.state.doc.toString();
  const words  = text.trim() === '' ? 0 : text.trim().split(/\s+/).length;
  if (wordsEl) wordsEl.textContent  = `${words} words`;
}

// Update status on any state change
view.dom.addEventListener('click',   updateStatus);
view.dom.addEventListener('keyup',   updateStatus);
view.dom.addEventListener('keydown', updateStatus);

updateStatus();

let isZoomEnabled = false;

window.updateZoomOrigin = function() {
  if (!isZoomEnabled || !view) return;
  
  if (!view.hasFocus) {
    document.body.classList.remove('zoom-active');
    return;
  }
  
  const sel = view.state.selection.main;
  const coords = view.coordsAtPos(sel.head);
  
  if (coords) {
    const rect = view.dom.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      // Find the unscaled physical position using mathematical screen ratios spanning the scaled bounding box
      const unscaledX = ((coords.left - rect.left) / rect.width) * view.dom.offsetWidth;
      const unscaledY = ((coords.top - rect.top) / rect.height) * view.dom.offsetHeight;
      
      const W = view.dom.offsetWidth;
      const H = view.dom.offsetHeight;
      
      // We want the caret to have at least this much pixel margin on screen
      // 400 screen pixels / 3 (scale) = ~133 unscaled pixels = gutter + ~12 chars
      const minMarginX = 400; 
      const minMarginY = 200; 
      
      let targetScreenX = Math.max(minMarginX, Math.min(W - minMarginX, unscaledX));
      let targetScreenY = Math.max(minMarginY, Math.min(H - minMarginY, unscaledY));
      
      if (W < minMarginX * 2) targetScreenX = W / 2;
      if (H < minMarginY * 2) targetScreenY = H / 2;
      
      const scale = 3;
      const originX = (targetScreenX - scale * unscaledX) / (1 - scale);
      const originY = (targetScreenY - scale * unscaledY) / (1 - scale);
      
      view.dom.style.setProperty('--caret-x', `${originX}px`);
      view.dom.style.setProperty('--caret-y', `${originY}px`);
    }
  }
  
  document.body.classList.add('zoom-active');
};

// ── Command Palette Logic ──────────────────────────────────────────────────
const commandOverlay = document.getElementById('command-palette-overlay');
const commandInput = document.getElementById('command-input');
const paletteList = document.getElementById('palette-list');
let isGlowEnabled = false;
let isRgbGlowEnabled = false;
let isRgbTextEnabled = false;

const commands = [
  { id: 'toggle-glow', label: 'Preferences: Toggle Neon Glow Effect' },
  { id: 'toggle-rgb-glow', label: 'Preferences: Toggle RGB Moving Glow Effect' },
  { id: 'toggle-rgb-text', label: 'Preferences: Toggle RGB Text Effect (No Glow)' },
  { id: 'toggle-zoom', label: 'Preferences: Toggle 300% Zoom Tracking' },
  { id: 'new-file', label: 'File: New File' },
  { id: 'new-folder', label: 'File: New Folder' },
  { id: 'close-editor', label: 'View: Close Editor' }
];

let filteredCommands = [];
let selectedIndex = 0;

function toggleCommandPalette(forceClose = false) {
  if (forceClose || commandOverlay.classList.contains('active')) {
    commandOverlay.classList.remove('active');
    view.focus();
  } else {
    commandOverlay.classList.add('active');
    commandInput.value = '>';
    renderCommands('>');
    setTimeout(() => commandInput.focus(), 50);
  }
}

function renderCommands(query) {
  const search = query.startsWith('>') ? query.slice(1).trim().toLowerCase() : query.trim().toLowerCase();
  filteredCommands = commands.filter(c => c.label.toLowerCase().includes(search));
  selectedIndex = 0;
  
  paletteList.innerHTML = '';
  filteredCommands.forEach((cmd, idx) => {
    const el = document.createElement('div');
    el.className = 'palette-item' + (idx === 0 ? ' active' : '');
    el.textContent = cmd.label;
    el.onclick = () => executeCommand(cmd.id);
    
    el.addEventListener('mouseenter', () => {
      document.querySelectorAll('.palette-item').forEach(i => i.classList.remove('active'));
      el.classList.add('active');
      selectedIndex = idx;
    });
    
    paletteList.appendChild(el);
  });
}

function updateCommandSelection() {
  const items = document.querySelectorAll('.palette-item');
  items.forEach((el, idx) => {
    if (idx === selectedIndex) el.classList.add('active');
    else el.classList.remove('active');
  });
  if(items[selectedIndex]) items[selectedIndex].scrollIntoView({ block: 'nearest' });
}

function executeCommand(id) {
  toggleCommandPalette(true);
  
  if (id === 'toggle-glow') {
    isGlowEnabled = !isGlowEnabled;
    if (isGlowEnabled) {
      document.body.classList.add('glow-effect');
      document.body.classList.remove('glow-effect-micro');
      isRgbGlowEnabled = false;
      document.body.classList.remove('rgb-glow-effect');
      isRgbTextEnabled = false;
      document.body.classList.remove('rgb-text-effect');
    } else {
      document.body.classList.remove('glow-effect');
      document.body.classList.remove('glow-effect-micro');
    }
  } else if (id === 'toggle-rgb-glow') {
    isRgbGlowEnabled = !isRgbGlowEnabled;
    if (isRgbGlowEnabled) {
      document.body.classList.add('rgb-glow-effect');
      isGlowEnabled = false;
      document.body.classList.remove('glow-effect');
      document.body.classList.remove('glow-effect-micro');
      isRgbTextEnabled = false;
      document.body.classList.remove('rgb-text-effect');
    } else {
      document.body.classList.remove('rgb-glow-effect');
    }
  } else if (id === 'toggle-rgb-text') {
    isRgbTextEnabled = !isRgbTextEnabled;
    if (isRgbTextEnabled) {
      document.body.classList.add('rgb-text-effect');
      isGlowEnabled = false;
      document.body.classList.remove('glow-effect');
      document.body.classList.remove('glow-effect-micro');
      isRgbGlowEnabled = false;
      document.body.classList.remove('rgb-glow-effect');
    } else {
      document.body.classList.remove('rgb-text-effect');
    }
  } else if (id === 'toggle-zoom') {
    isZoomEnabled = !isZoomEnabled;
    if (isZoomEnabled) {
      document.body.classList.add('zoom-tracking-effect');
      document.body.classList.add('zoom-active');
      window.updateZoomOrigin();
    } else {
      document.body.classList.remove('zoom-tracking-effect');
      document.body.classList.remove('zoom-active');
      view.dom.style.removeProperty('--caret-x');
      view.dom.style.removeProperty('--caret-y');
    }
  } else if (id === 'new-file') {
    alert("Dummy Action: New File");
  } else if (id === 'new-folder') {
    alert("Dummy Action: New Folder");
  } else if (id === 'close-editor') {
    const activeClose = document.querySelector('.tab.active .tab-close');
    if(activeClose) activeClose.click();
  }
}

commandInput.addEventListener('input', (e) => {
  renderCommands(e.target.value);
});

commandInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') toggleCommandPalette(true);
  else if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (selectedIndex < filteredCommands.length - 1) {
      selectedIndex++;
      updateCommandSelection();
    }
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (selectedIndex > 0) {
      selectedIndex--;
      updateCommandSelection();
    }
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (filteredCommands.length > 0) {
      executeCommand(filteredCommands[selectedIndex].id);
    }
  }
});

commandOverlay.addEventListener('click', (e) => {
  if (e.target === commandOverlay) toggleCommandPalette(true);
});

window.addEventListener('keydown', (e) => {
  // Toggle on Ctrl+Shift+P
  if (e.ctrlKey && e.shiftKey && (e.key === 'p' || e.key === 'P')) {
    e.preventDefault();
    toggleCommandPalette();
  }
});
