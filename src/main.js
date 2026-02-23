import './style.css';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } from '@codemirror/view';
import { defaultKeymap, indentWithTab, history, historyKeymap } from '@codemirror/commands';
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
      history(),
      EditorState.allowMultipleSelections.of(true),
      drawSelection(),
      lineNumbers(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      autocompletion(),
      search({top: true}),
      keymap.of([...searchKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
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

let fileStates = {};

let view = new EditorView({
  state: createEditorState(files[currentFile]),
  parent: document.getElementById('editor-wrap'),
});
fileStates[currentFile] = view.state;

// ── File Management & Rendering ──────────────────────────────────────────────
let openTabs = Object.keys(files);
let activeContextFile = null;

function getFileIcon(filename) {
  if (filename.endsWith('.py')) return '<i class="fa-brands fa-python" style="color: #4B8BBE;"></i>';
  if (filename.endsWith('.json')) return '<i class="fa-solid fa-code" style="color: #e06c75;"></i>';
  if (filename.endsWith('.js')) return '<i class="fa-brands fa-js" style="color: #F7DF1E;"></i>';
  if (filename.endsWith('.css')) return '<i class="fa-brands fa-css3-alt" style="color: #1572B6;"></i>';
  if (filename.endsWith('.html')) return '<i class="fa-brands fa-html5" style="color: #E34F26;"></i>';
  return '<i class="fa-solid fa-file" style="color: #888;"></i>';
}

function deleteFile(filename) {
  if (confirm(`Are you sure you want to delete ${filename}?`)) {
      delete files[filename];
      delete fileStates[filename];
      if (openTabs.includes(filename)) {
          closeFile(filename);
      }
      renderExplorer();
      renderTabs();
  }
}

function renderExplorer() {
  const explorer = document.getElementById('file-explorer');
  if (!explorer) return;
  explorer.innerHTML = '';
  
  Object.keys(files).sort().forEach(filename => {
      const div = document.createElement('div');
      div.className = 'file-item' + (filename === currentFile ? ' active' : '');
      div.dataset.file = filename;
      div.tabIndex = 0; // Make focusable
      div.innerHTML = `${getFileIcon(filename)} <span class="file-name">${filename}</span>`;
      
      div.addEventListener('click', () => {
          openFile(filename);
          div.focus();
      });
      div.addEventListener('keydown', (e) => {
          if (e.key === 'Delete') {
              e.preventDefault();
              deleteFile(filename);
          }
      });
      div.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          activeContextFile = filename;
          const contextMenu = document.getElementById('context-menu');
          contextMenu.style.left = e.pageX + 'px';
          contextMenu.style.top = e.pageY + 'px';
          contextMenu.classList.remove('hidden');
          div.focus();
      });
      
      explorer.appendChild(div);
  });
}

function renderTabs() {
  const tabsContainer = document.getElementById('tabs-container');
  if (!tabsContainer) return;
  tabsContainer.innerHTML = '';
  
  openTabs.forEach(filename => {
      const div = document.createElement('div');
      div.className = 'tab' + (filename === currentFile ? ' active' : '');
      div.dataset.file = filename;
      div.innerHTML = `
          ${getFileIcon(filename)}
          <span class="tab-title" style="margin-left: 6px;">${filename}</span>
          <div class="tab-close"><i class="fa-solid fa-xmark"></i></div>
      `;
      
      div.addEventListener('click', (e) => {
          if (e.target.closest('.tab-close')) return;
          openFile(filename);
      });
      
      const closeBtn = div.querySelector('.tab-close');
      closeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          closeFile(filename);
      });
      
      tabsContainer.appendChild(div);
  });
}

function closeFile(filename) {
  openTabs = openTabs.filter(f => f !== filename);
  if (filename === currentFile) {
      if (openTabs.length > 0) {
          openFile(openTabs[0]);
      } else {
          currentFile = null;
          document.getElementById('editor-wrap').style.display = 'none';
          if(document.getElementById('editor-breadcrumb')) document.getElementById('editor-breadcrumb').style.display = 'none';
          renderExplorer();
          renderTabs();
          if (document.getElementById('sb-cursor')) document.getElementById('sb-cursor').textContent = "";
          if (document.getElementById('sb-words')) document.getElementById('sb-words').textContent = "0 words";
      }
  } else {
      renderTabs();
  }
}

function openFile(filename) {
  if (files[filename] === undefined) return;
  
  if (currentFile && fileStates[currentFile]) {
      fileStates[currentFile] = view.state;
  }
  
  if (!openTabs.includes(filename)) openTabs.push(filename);
  currentFile = filename;
  
  document.getElementById('editor-wrap').style.display = 'flex';
  if(document.getElementById('editor-breadcrumb')) document.getElementById('editor-breadcrumb').style.display = 'flex';
  
  if (!fileStates[currentFile]) {
      fileStates[currentFile] = createEditorState(files[currentFile]);
  }
  view.setState(fileStates[currentFile]);
  
  const breadcrumbCurrent = document.getElementById('breadcrumb-current');
  if (breadcrumbCurrent) {
      breadcrumbCurrent.innerHTML = getFileIcon(filename) + '<span style="margin-left: 6px;">' + filename + '</span>';
  }
  
  // Update styling for explorer items without destroying DOM
  document.querySelectorAll('.file-item').forEach(el => {
      if (el.dataset.file === filename) el.classList.add('active');
      else el.classList.remove('active');
  });
  
  renderTabs();
  updateStatus();
};

window.openFile = openFile;

// Initial render
renderExplorer();
renderTabs();

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

// ── Explorer Toolbar Actions ──────────────────────────────────────────────────
document.getElementById('action-new-file').addEventListener('click', (e) => {
  e.stopPropagation();
  const filename = prompt("Enter new file name:");
  if (filename && !files[filename]) {
      files[filename] = "";
      renderExplorer();
      openFile(filename);
  } else if (filename && files[filename]) {
      alert("File already exists!");
  }
});
document.getElementById('action-new-folder').addEventListener('click', (e) => {
  e.stopPropagation();
  alert("Dummy action: Creating a new folder (awaiting Tauri impl.)");
});
document.getElementById('action-refresh').addEventListener('click', (e) => {
  e.stopPropagation();
  renderExplorer();
});
document.getElementById('action-collapse').addEventListener('click', (e) => {
  e.stopPropagation();
  alert("Dummy action: Collapsing all folders (awaiting Tauri impl.)");
});

// ── Context Menu Logic ────────────────────────────────────────────────────────
const contextMenu = document.getElementById('context-menu');

// Hide context menu on global map clicks
window.addEventListener('click', () => {
  contextMenu.classList.add('hidden');
});

// Context Menu actions
document.getElementById('ctx-rename').addEventListener('click', () => {
  const newName = prompt(`Rename ${activeContextFile} to:`, activeContextFile);
  if (newName && newName !== activeContextFile && !files[newName]) {
      files[newName] = files[activeContextFile];
      delete files[activeContextFile];
      
      if (fileStates[activeContextFile]) {
          fileStates[newName] = fileStates[activeContextFile];
          delete fileStates[activeContextFile];
      }
      
      if (openTabs.includes(activeContextFile)) {
          openTabs[openTabs.indexOf(activeContextFile)] = newName;
      }
      
      if (currentFile === activeContextFile) {
          currentFile = newName;
          openFile(newName);
      } else {
          renderExplorer();
          renderTabs();
      }
  } else if (newName && files[newName]) {
      alert("File already exists!");
  }
  contextMenu.classList.add('hidden');
});

document.getElementById('ctx-delete').addEventListener('click', () => {
  deleteFile(activeContextFile);
  contextMenu.classList.add('hidden');
});

document.getElementById('ctx-copy').addEventListener('click', () => {
  navigator.clipboard.writeText(activeContextFile).catch(() => {});
  contextMenu.classList.add('hidden');
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
  { id: 'close-editor', label: 'View: Close Editor' },
  { id: 'open-keybindings', label: 'Preferences: Open Keyboard Shortcuts' }
];

let filteredCommands = [];
let selectedIndex = 0;

function toggleCommandPalette(forceClose = false, mode = 'command') {
  if (forceClose || commandOverlay.classList.contains('active')) {
    commandOverlay.classList.remove('active');
    view.focus();
  } else {
    commandOverlay.classList.add('active');
    if (mode === 'command') {
      commandInput.value = '>';
      renderCommands('>');
    } else {
      commandInput.value = '';
      renderCommands('');
    }
    setTimeout(() => commandInput.focus(), 50);
  }
}

function renderCommands(query) {
  if (query.startsWith('>')) {
    const search = query.slice(1).trim().toLowerCase();
    filteredCommands = commands.filter(c => c.label.toLowerCase().includes(search));
  } else {
    const search = query.toLowerCase();
    filteredCommands = Object.keys(files)
        .filter(f => f.toLowerCase().includes(search))
        .map(f => ({ id: 'open-file:' + f, label: f, isFile: true }));
  }
  
  selectedIndex = 0;
  
  paletteList.innerHTML = '';
  filteredCommands.forEach((cmd, idx) => {
    const el = document.createElement('div');
    el.className = 'palette-item' + (idx === 0 ? ' active' : '');
    el.innerHTML = cmd.isFile ? `${getFileIcon(cmd.label)} <span style="margin-left:8px;">${cmd.label}</span>` : cmd.label;
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
  
  if (id.startsWith('open-file:')) {
    const filename = id.split(':')[1];
    openFile(filename);
    return;
  }
  
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
    const filename = prompt("Enter new file name:");
    if (filename && !files[filename]) {
        files[filename] = "";
        renderExplorer();
        openFile(filename);
    } else if (filename && files[filename]) {
        alert("File already exists!");
    }
  } else if (id === 'new-folder') {
    alert("Dummy Action: New Folder (awaiting Tauri impl.)");
  } else if (id === 'close-editor') {
    const activeClose = document.querySelector('.tab.active .tab-close');
    if(activeClose) activeClose.click();
  } else if (id === 'open-keybindings') {
    openKeymapSettings();
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
  // Toggle on Ctrl+P (File switcher)
  if (e.ctrlKey && !e.shiftKey && !e.altKey && (e.key === 'p' || e.key === 'P')) {
    e.preventDefault();
    toggleCommandPalette(false, 'file');
  }
  // Toggle on Ctrl+Shift+P (Command palette)
  else if (e.ctrlKey && e.shiftKey && !e.altKey && (e.key === 'p' || e.key === 'P')) {
    e.preventDefault();
    toggleCommandPalette(false, 'command');
  }
  // Ctrl+Alt+G — Toggle Neon Glow
  else if (e.ctrlKey && e.altKey && (e.key === 'g' || e.key === 'G')) {
    e.preventDefault();
    executeCommand('toggle-glow');
  }
  // Ctrl+Alt+R — Toggle RGB Glow
  else if (e.ctrlKey && e.altKey && (e.key === 'r' || e.key === 'R')) {
    e.preventDefault();
    executeCommand('toggle-rgb-glow');
  }
  // Ctrl+Alt+T — Toggle RGB Text
  else if (e.ctrlKey && e.altKey && (e.key === 't' || e.key === 'T')) {
    e.preventDefault();
    executeCommand('toggle-rgb-text');
  }
  // Ctrl+Alt+Z — Toggle 300% Zoom
  else if (e.ctrlKey && e.altKey && (e.key === 'z' || e.key === 'Z')) {
    e.preventDefault();
    executeCommand('toggle-zoom');
  }
});

// ── Keymap Settings Logic ──────────────────────────────────────────────────
const keybindings = [
  // Editor basics (CodeMirror built-in)
  { id: 'editor.undo', command: 'Undo', keys: 'Ctrl+Z', source: 'Default' },
  { id: 'editor.redo', command: 'Redo', keys: 'Ctrl+Y', source: 'Default' },
  { id: 'editor.cut', command: 'Cut', keys: 'Ctrl+X', source: 'Default' },
  { id: 'editor.copy', command: 'Copy', keys: 'Ctrl+C', source: 'Default' },
  { id: 'editor.paste', command: 'Paste', keys: 'Ctrl+V', source: 'Default' },
  { id: 'editor.selectAll', command: 'Select All', keys: 'Ctrl+A', source: 'Default' },
  { id: 'editor.find', command: 'Find', keys: 'Ctrl+F', source: 'Default' },
  { id: 'editor.replace', command: 'Find and Replace', keys: 'Ctrl+H', source: 'Default' },
  { id: 'editor.addSelectionToNextFind', command: 'Add Selection To Next Find Match', keys: 'Ctrl+D', source: 'Default' },
  { id: 'editor.indentLine', command: 'Indent Line', keys: 'Tab', source: 'Default' },
  { id: 'editor.outdentLine', command: 'Outdent Line', keys: 'Shift+Tab', source: 'Default' },
  // Workbench / file management
  { id: 'workbench.quickOpen', command: 'Go to File (Quick Open)', keys: 'Ctrl+P', source: 'Default' },
  { id: 'workbench.commandPalette', command: 'Open Command Palette', keys: 'Ctrl+Shift+P', source: 'Default' },
  { id: 'workbench.openKeybindings', command: 'Open Keyboard Shortcuts', keys: 'Ctrl+K Ctrl+S', source: 'Default' },
  { id: 'workbench.newFile', command: 'New File', keys: 'Ctrl+N', source: 'Default' },
  { id: 'workbench.closeEditor', command: 'Close Editor', keys: 'Ctrl+W', source: 'Default' },
  { id: 'editor.deleteFile', command: 'Delete Selected File', keys: 'Delete', source: 'Default' },
  { id: 'editor.triggerSuggest', command: 'Trigger Autocomplete', keys: 'Ctrl+Space', source: 'Default' },
  { id: 'debug.run', command: 'Run Code', keys: 'F5', source: 'Default' },
  // Axiom IDE custom effects
  { id: 'preferences.glow', command: 'Toggle Neon Glow Effect', keys: 'Ctrl+Alt+G', source: 'Default' },
  { id: 'preferences.rgbGlow', command: 'Toggle RGB Moving Glow Effect', keys: 'Ctrl+Alt+R', source: 'Default' },
  { id: 'preferences.rgbText', command: 'Toggle RGB Text Effect', keys: 'Ctrl+Alt+T', source: 'Default' },
  { id: 'preferences.zoom', command: 'Toggle 300% Zoom Tracking', keys: 'Ctrl+Alt+Z', source: 'Default' },
];

const keymapOverlay = document.getElementById('keymap-overlay');
const keymapSearch = document.getElementById('keymap-search');
const keymapTableBody = document.getElementById('keymap-table-body');
let editingRowId = null;

function openKeymapSettings() {
  keymapOverlay.classList.add('active');
  keymapSearch.value = '';
  editingRowId = null;
  renderKeymapRows();
  setTimeout(() => keymapSearch.focus(), 50);
}

function closeKeymapSettings() {
  keymapOverlay.classList.remove('active');
  editingRowId = null;
  view.focus();
}

document.getElementById('keymap-close-btn').addEventListener('click', closeKeymapSettings);

keymapOverlay.addEventListener('click', (e) => {
  if (e.target === keymapOverlay) closeKeymapSettings();
});

keymapOverlay.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !editingRowId) {
    e.preventDefault();
    closeKeymapSettings();
  }
});

function formatKeybinding(keys) {
  if (!keys) return '<span style="color: var(--text-muted); font-style: italic; font-size: 11px;">—</span>';
  
  return keys.split(' ').map((chord, i) => {
    const parts = chord.split('+');
    const badges = parts.map(k => `<span class="kbd-badge">${k}</span>`).join('<span class="kbd-separator">+</span>');
    return (i > 0 ? '<span class="kbd-separator" style="margin: 0 4px;"> </span>' : '') + badges;
  }).join('');
}

function renderKeymapRows(query = '') {
  const search = query.toLowerCase();
  const filtered = keybindings.filter(kb => {
    return kb.command.toLowerCase().includes(search) ||
           kb.keys.toLowerCase().includes(search) ||
           kb.id.toLowerCase().includes(search);
  });
  
  keymapTableBody.innerHTML = '';
  
  if (filtered.length === 0) {
    keymapTableBody.innerHTML = '<div class="keymap-no-results">No keybindings found.</div>';
    return;
  }
  
  filtered.forEach(kb => {
    const row = document.createElement('div');
    row.className = 'keymap-row' + (editingRowId === kb.id ? ' keymap-row-editing' : '');
    row.dataset.id = kb.id;
    
    if (editingRowId === kb.id) {
      row.innerHTML = `
        <span class="keymap-col-command">${kb.command}</span>
        <span class="keymap-col-keybinding">
          <input type="text" class="keymap-edit-input" id="keymap-edit-active"
                 placeholder="Press desired key combination..."
                 readonly />
        </span>
        <span class="keymap-col-source">${kb.source}</span>
      `;
    } else {
      row.innerHTML = `
        <span class="keymap-col-command">${kb.command}</span>
        <span class="keymap-col-keybinding">
          <button class="keymap-edit-btn" title="Edit Keybinding"><i class="fa-solid fa-pencil"></i></button>
          ${formatKeybinding(kb.keys)}
        </span>
        <span class="keymap-col-source">${kb.source}</span>
      `;
    }
    
    keymapTableBody.appendChild(row);
    
    if (editingRowId === kb.id) {
      const input = row.querySelector('#keymap-edit-active');
      setTimeout(() => input.focus(), 30);
      
      input.addEventListener('keydown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        if (e.key === 'Escape') {
          editingRowId = null;
          renderKeymapRows(keymapSearch.value);
          return;
        }
        
        // Build the chord
        const parts = [];
        if (e.ctrlKey) parts.push('Ctrl');
        if (e.shiftKey) parts.push('Shift');
        if (e.altKey) parts.push('Alt');
        if (e.metaKey) parts.push('Meta');
        
        const key = e.key;
        if (!['Control', 'Shift', 'Alt', 'Meta'].includes(key)) {
          let displayKey = key.length === 1 ? key.toUpperCase() : key;
          if (key === 'ArrowUp') displayKey = 'Up';
          if (key === 'ArrowDown') displayKey = 'Down';
          if (key === 'ArrowLeft') displayKey = 'Left';
          if (key === 'ArrowRight') displayKey = 'Right';
          if (key === ' ') displayKey = 'Space';
          parts.push(displayKey);
          
          kb.keys = parts.join('+');
          kb.source = 'User';
          editingRowId = null;
          renderKeymapRows(keymapSearch.value);
        } else {
          input.value = parts.join('+') + '+...';
        }
      });
    } else {
      const editBtn = row.querySelector('.keymap-edit-btn');
      if (editBtn) {
        editBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          editingRowId = kb.id;
          renderKeymapRows(keymapSearch.value);
        });
      }
      
      row.addEventListener('dblclick', () => {
        editingRowId = kb.id;
        renderKeymapRows(keymapSearch.value);
      });
    }
  });
}

keymapSearch.addEventListener('input', (e) => {
  renderKeymapRows(e.target.value);
});

// Ctrl+K Ctrl+S to open keyboard shortcuts
let ctrlKPending = false;
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey && !e.shiftKey && !e.altKey && (e.key === 'k' || e.key === 'K')) {
    e.preventDefault();
    ctrlKPending = true;
    return;
  }
  if (ctrlKPending && e.ctrlKey && (e.key === 's' || e.key === 'S')) {
    e.preventDefault();
    ctrlKPending = false;
    openKeymapSettings();
    return;
  }
  ctrlKPending = false;
});
