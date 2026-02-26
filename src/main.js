import './style.css';
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } from '@codemirror/view';
import { defaultKeymap, indentWithTab, history, historyKeymap } from '@codemirror/commands';
import { oneDark } from '@codemirror/theme-one-dark';
import { autocompletion } from '@codemirror/autocomplete';
import { searchKeymap, search } from '@codemirror/search';

// ── File System State ──────────────────────────────────────────────────────────
let rootDirHandle = null;
let rootName = 'AXIOM_PROJECT';
const fileHandles = new Map();      // path → FileSystemFileHandle
const dirHandles  = new Map();      // path → FileSystemDirectoryHandle
const fileContents = new Map();     // path → string (last-saved content)
const fileEditorStates = new Map(); // path → EditorState
const dirtyFiles = new Set();       // paths of unsaved files
let fileTree = null;                // tree root node
let expandedDirs = new Set();       // expanded folder paths
let usingMemory = true;             // true when no real folder is open

// In-memory fallback
const memFiles = {};
// Seed fileContents with all memory files so dirty tracking works
Object.entries(memFiles).forEach(([k, v]) => fileContents.set(k, v));

let openTabs = [];
let currentFile = null;

// Context state
let activeContextPath = null;
let activeContextIsDir = false;

// Inline creator state  { parentPath, type }
let inlineCreator = null;

// ── CodeMirror Effects Flags ───────────────────────────────────────────────────
let isZoomEnabled    = false;
let isGlowEnabled    = false;
let isRgbGlowEnabled = false;
let isRgbTextEnabled = false;

const languageBox = new Compartment();

const languageMap = {
  py:   () => import('@codemirror/lang-python').then(m => m.python()),
  js:   () => import('@codemirror/lang-javascript').then(m => m.javascript()),
  mjs:  () => import('@codemirror/lang-javascript').then(m => m.javascript()),
  cjs:  () => import('@codemirror/lang-javascript').then(m => m.javascript()),
  ts:   () => import('@codemirror/lang-javascript').then(m => m.javascript({ typescript: true })),
  mts:  () => import('@codemirror/lang-javascript').then(m => m.javascript({ typescript: true })),
  cts:  () => import('@codemirror/lang-javascript').then(m => m.javascript({ typescript: true })),
  jsx:  () => import('@codemirror/lang-javascript').then(m => m.javascript({ jsx: true })),
  tsx:  () => import('@codemirror/lang-javascript').then(m => m.javascript({ jsx: true, typescript: true })),
  html: () => import('@codemirror/lang-html').then(m => m.html()),
  ejs:  () => import('@codemirror/lang-html').then(m => m.html()),
  css:  () => import('@codemirror/lang-css').then(m => m.css()),
  cpp:  () => import('@codemirror/lang-cpp').then(m => m.cpp()),
  c:    () => import('@codemirror/lang-cpp').then(m => m.cpp()),
  h:    () => import('@codemirror/lang-cpp').then(m => m.cpp()),
  hpp:  () => import('@codemirror/lang-cpp').then(m => m.cpp()),
  go:   () => import('@codemirror/lang-go').then(m => m.go()),
  rs:   () => import('@codemirror/lang-rust').then(m => m.rust()),
  json: () => import('@codemirror/lang-json').then(m => m.json()),
  md:   () => import('@codemirror/lang-markdown').then(m => m.markdown()),
};

async function getLanguageExtension(fileName) {
  const ext = fileName.split('.').pop().toLowerCase();
  if (languageMap[ext]) {
    try {
      return await languageMap[ext]();
    } catch (e) {
      console.error(`Failed to load language for .${ext}`, e);
    }
  }
  return [];
}

// ── Editor Factory ─────────────────────────────────────────────────────────────
function createEditorState(content, langExt = []) {
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
      search({ top: true }),
      keymap.of([...searchKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
      languageBox.of(langExt),
      oneDark,
      EditorView.lineWrapping,
      EditorView.updateListener.of((update) => {
        if (update.docChanged && currentFile) {
          const newContent = update.state.doc.toString();
          const savedContent = fileContents.get(currentFile) ?? '';
          const isDirtyNow = newContent !== savedContent;
          if (isDirtyNow && !dirtyFiles.has(currentFile)) {
            dirtyFiles.add(currentFile);
            patchTabDirty(currentFile);
            patchExplorerDirty(currentFile);
          } else if (!isDirtyNow && dirtyFiles.has(currentFile)) {
            dirtyFiles.delete(currentFile);
            patchTabDirty(currentFile);
            patchExplorerDirty(currentFile);
          }
        }
        if (update.selectionSet || update.docChanged) {
          if (typeof window.updateZoomOrigin === 'function') window.updateZoomOrigin();
          updateStatus();
        }
      })
    ]
  });
}

const view = new EditorView({
  state: createEditorState(''),
  parent: document.getElementById('editor-wrap'),
});

// ── File Icon ──────────────────────────────────────────────────────────────────
function getFileIcon(name) {
  if (name.endsWith('.py'))   return '<i class="fa-brands fa-python" style="color:#4B8BBE;"></i>';
  if (name.endsWith('.json')) return '<i class="fa-solid fa-code" style="color:#e06c75;"></i>';
  if (name.endsWith('.js') || name.endsWith('.mjs') || name.endsWith('.cjs')) return '<i class="fa-brands fa-js" style="color:#F7DF1E;"></i>';
  if (name.endsWith('.ts') || name.endsWith('.mts') || name.endsWith('.cts')) return '<i class="fa-solid fa-code" style="color:#3178C6;"></i>';
  if (name.endsWith('.jsx') || name.endsWith('.tsx')) return '<i class="fa-brands fa-react" style="color:#61DAFB;"></i>';
  if (name.endsWith('.css'))  return '<i class="fa-brands fa-css3-alt" style="color:#1572B6;"></i>';
  if (name.endsWith('.html') || name.endsWith('.ejs')) return '<i class="fa-brands fa-html5" style="color:#E34F26;"></i>';
  if (name.endsWith('.md'))   return '<i class="fa-solid fa-file-lines" style="color:#6699CC;"></i>';
  if (name.endsWith('.txt'))  return '<i class="fa-solid fa-file-lines" style="color:#888;"></i>';
  if (name.endsWith('.cpp') || name.endsWith('.hpp') || name.endsWith('.c') || name.endsWith('.h')) return '<i class="fa-solid fa-file-code" style="color:#00599C;"></i>';
  if (name.endsWith('.go'))   return '<i class="fa-brands fa-golang" style="color:#00ADD8;"></i>';
  if (name.endsWith('.rs'))   return '<i class="fa-brands fa-rust" style="color:#DEA584;"></i>';
  return '<i class="fa-solid fa-file" style="color:#888;"></i>';
}

// CSS-escape a path for querySelector
function esc(str) {
  return CSS.escape ? CSS.escape(str) : str.replace(/[!"#$%&'()*+,.\/:;<=>?@[\\\]^`{|}~]/g, '\\$&');
}

// ── Open Folder (File System Access API) ──────────────────────────────────────
async function openFolder() {
  if (!('showDirectoryPicker' in window)) {
    alert('Your browser does not support the File System Access API.\nPlease use Chrome or Edge 86+.');
    return;
  }
  try {
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    rootDirHandle = handle;
    rootName = handle.name;

    // Clear state
    fileHandles.clear(); dirHandles.clear();
    fileContents.clear(); fileEditorStates.clear();
    dirtyFiles.clear(); expandedDirs.clear();
    openTabs = []; currentFile = null;
    usingMemory = false;

    dirHandles.set('', handle);

    const children = await scanDir(handle, '');
    fileTree = { name: rootName, path: '', type: 'directory', children };

    document.getElementById('sidebar-folder-name').textContent = rootName.toUpperCase();
    showWelcome(false);
    renderExplorer();
    renderTabs();

    // Auto-open first .py
    const first = findFirstFile(children, '.py');
    if (first) openFile(first);
  } catch (e) {
    if (e.name !== 'AbortError') console.error('Open folder failed:', e);
  }
}

async function scanDir(dirHandle, parentPath) {
  const children = [];
  for await (const [name, handle] of dirHandle.entries()) {
    if (name.startsWith('.') || name === 'node_modules' || name === '__pycache__') continue;
    const fullPath = parentPath ? `${parentPath}/${name}` : name;
    if (handle.kind === 'file') {
      fileHandles.set(fullPath, handle);
      children.push({ name, path: fullPath, type: 'file' });
    } else {
      dirHandles.set(fullPath, handle);
      const sub = await scanDir(handle, fullPath);
      children.push({ name, path: fullPath, type: 'directory', children: sub });
    }
  }
  children.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return children;
}

function findFirstFile(nodes, ext) {
  for (const n of nodes) {
    if (n.type === 'file' && n.name.endsWith(ext)) return n.path;
    if (n.type === 'directory' && n.children) {
      const f = findFirstFile(n.children, ext);
      if (f) return f;
    }
  }
  return null;
}

async function refreshTree() {
  if (usingMemory || !rootDirHandle) { renderExplorer(); return; }
  fileHandles.clear();
  dirHandles.set('', rootDirHandle);
  const children = await scanDir(rootDirHandle, '');
  fileTree = { name: rootName, path: '', type: 'directory', children };
  renderExplorer();
}

// ── Explorer Rendering ─────────────────────────────────────────────────────────
function renderExplorer() {
  const el = document.getElementById('file-explorer');
  if (!el) return;
  el.innerHTML = '';

  if (usingMemory) {
    const welcome = document.createElement('div');
    welcome.className = 'explorer-welcome';
    welcome.innerHTML = `
      <p>No folder open</p>
      <button id="explorer-open-btn">Open Folder</button>
    `;
    welcome.querySelector('#explorer-open-btn').addEventListener('click', () => openFolder());
    el.appendChild(welcome);
    
    // Hide/disable explorer toolbar actions
    document.querySelector('.title-actions').style.display = 'none';
    return;
  }
  
  // Show toolbar actions when a folder is open
  document.querySelector('.title-actions').style.display = 'flex';

  if (!fileTree) return;
  renderNodes(fileTree.children, el, 0, '');
}

function renderNodes(nodes, container, depth, parentPath) {
  // Inline creator for this dir level
  if (inlineCreator && inlineCreator.parentPath === parentPath) {
    container.appendChild(buildInlineCreatorEl(depth, parentPath));
  }
  if (!nodes) return;
  nodes.forEach(node => {
    if (node.type === 'directory') {
      const expanded = expandedDirs.has(node.path);
      const dir = document.createElement('div');
      dir.className = 'dir-item';
      dir.dataset.path = node.path;
      dir.style.paddingLeft = (6 + depth * 12) + 'px';
      dir.innerHTML = `
        <i class="fa-solid ${expanded ? 'fa-chevron-down' : 'fa-chevron-right'} dir-chevron"></i>
        <i class="fa-solid ${expanded ? 'fa-folder-open' : 'fa-folder'} dir-icon"></i>
        <span class="dir-name">${node.name}</span>`;

      dir.addEventListener('click', e => { e.stopPropagation(); toggleDir(node.path); });
      dir.addEventListener('contextmenu', e => {
        e.preventDefault(); e.stopPropagation();
        activeContextPath = node.path; activeContextIsDir = true;
        showCtxMenu(e.pageX, e.pageY);
      });
      container.appendChild(dir);

      if (expanded) renderNodes(node.children, container, depth + 1, node.path);
    } else {
      container.appendChild(buildFileEl(node.path, node.name, depth));
    }
  });
}

function buildFileEl(filePath, fileName, depth) {
  const dirty = dirtyFiles.has(filePath);
  const div = document.createElement('div');
  div.className = 'file-item' + (filePath === currentFile ? ' active' : '');
  div.dataset.file = filePath;
  div.tabIndex = 0;
  div.style.paddingLeft = (6 + depth * 12 + (usingMemory ? 0 : 16)) + 'px';
  div.innerHTML = `${getFileIcon(fileName)}<span class="file-name">${fileName}</span>${dirty ? '<span class="explorer-dot">●</span>' : ''}`;
  div.addEventListener('click', () => openFile(filePath));
  div.addEventListener('keydown', e => { if (e.key === 'Delete') { e.preventDefault(); deleteItem(filePath, false); }});
  div.addEventListener('contextmenu', e => {
    e.preventDefault(); e.stopPropagation();
    activeContextPath = filePath; activeContextIsDir = false;
    showCtxMenu(e.pageX, e.pageY);
  });
  return div;
}

function buildInlineCreatorEl(depth, parentPath) {
  const wrap = document.createElement('div');
  wrap.className = 'inline-creator';
  const extraIndent = usingMemory ? 0 : 16;
  wrap.style.paddingLeft = (6 + depth * 12 + extraIndent) + 'px';
  const iconHtml = inlineCreator.type === 'file'
    ? '<i class="fa-solid fa-file" style="color:#888;"></i>'
    : '<i class="fa-solid fa-folder" style="color:#E8AB4F;"></i>';
  wrap.innerHTML = `${iconHtml}<input type="text" class="inline-input" placeholder="${inlineCreator.type === 'file' ? 'filename.py' : 'folder'}" autocomplete="off" spellcheck="false"/>`;

  const input = wrap.querySelector('.inline-input');
  setTimeout(() => { input.focus(); input.select(); }, 30);

  const commit = async () => {
    const name = input.value.trim();
    if (name) {
      if (inlineCreator.type === 'file') await doCreateFile(parentPath, name);
      else await doCreateDir(parentPath, name);
    }
    inlineCreator = null;
    await refreshTree();
  };

  input.addEventListener('keydown', async e => {
    if (e.key === 'Enter') { e.preventDefault(); await commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); inlineCreator = null; renderExplorer(); }
  });
  input.addEventListener('blur', () => setTimeout(async () => {
    if (inlineCreator) { inlineCreator = null; renderExplorer(); }
  }, 150));
  return wrap;
}

function toggleDir(path) {
  if (expandedDirs.has(path)) expandedDirs.delete(path);
  else expandedDirs.add(path);
  renderExplorer();
}

// ── Tab Rendering ──────────────────────────────────────────────────────────────
function renderTabs() {
  const c = document.getElementById('tabs-container');
  if (!c) return;
  c.innerHTML = '';
  let activeTabEl = null;

  openTabs.forEach(fp => {
    const fn = fp.split('/').pop();
    const dirty = dirtyFiles.has(fp);
    const div = document.createElement('div');
    div.className = 'tab' + (fp === currentFile ? ' active' : '');
    div.dataset.file = fp;
    div.innerHTML = `${getFileIcon(fn)}<span class="tab-title">${fn}</span><div class="tab-close-btn ${dirty ? 'is-dirty' : ''}">${dirty ? '<span class="tab-dot">●</span>' : '<i class="fa-solid fa-xmark"></i>'}</div>`;
    div.addEventListener('click', e => { if (!e.target.closest('.tab-close-btn')) openFile(fp); });
    div.querySelector('.tab-close-btn').addEventListener('click', e => { e.stopPropagation(); closeTab(fp); });
    c.appendChild(div);
    if (fp === currentFile) activeTabEl = div;
  });

  if (activeTabEl) {
    requestAnimationFrame(() => {
      activeTabEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    });
  }
}

function patchTabDirty(fp) {
  const btn = document.querySelector(`.tab[data-file="${esc(fp)}"] .tab-close-btn`);
  if (!btn) { renderTabs(); return; }
  const dirty = dirtyFiles.has(fp);
  btn.className = 'tab-close-btn' + (dirty ? ' is-dirty' : '');
  btn.innerHTML = dirty ? '<span class="tab-dot">●</span>' : '<i class="fa-solid fa-xmark"></i>';
}

function patchExplorerDirty(fp) {
  const el = document.querySelector(`.file-item[data-file="${esc(fp)}"]`);
  if (!el) return;
  let dot = el.querySelector('.explorer-dot');
  if (dirtyFiles.has(fp)) {
    if (!dot) { dot = document.createElement('span'); dot.className = 'explorer-dot'; dot.textContent = '●'; el.appendChild(dot); }
  } else {
    dot?.remove();
  }
}

// ── Open / Close File ──────────────────────────────────────────────────────────
async function openFile(filePath) {
  if (!filePath) return;
  if (currentFile) fileEditorStates.set(currentFile, view.state);

  if (!fileEditorStates.has(filePath)) {
    let content = '';
    if (usingMemory) {
      content = memFiles[filePath] ?? '';
      fileContents.set(filePath, content);
    } else {
      const handle = fileHandles.get(filePath);
      if (!handle) return;
      try {
        const f = await handle.getFile();
        content = await f.text();
        fileContents.set(filePath, content);
      } catch (e) { console.error('Read failed:', e); return; }
    }
    const langExt = await getLanguageExtension(filePath);
    fileEditorStates.set(filePath, createEditorState(content, langExt));
  }

  if (!openTabs.includes(filePath)) openTabs.push(filePath);
  currentFile = filePath;

  showWelcome(false);
  document.getElementById('editor-wrap').style.display = 'flex';
  const bc = document.getElementById('editor-breadcrumb');
  if (bc) bc.style.display = 'flex';

  const state = fileEditorStates.get(filePath);
  view.setState(state);
  updateBreadcrumb(filePath);

  document.querySelectorAll('.file-item').forEach(el =>
    el.classList.toggle('active', el.dataset.file === filePath));
  renderTabs();
  updateStatus();
  setTimeout(() => view.focus(), 30);
}
window.openFile = openFile;

async function closeTab(filePath) {
  if (dirtyFiles.has(filePath)) {
    const result = await showSaveDialog(filePath);
    if (result === 'cancel') return;
    if (result === 'save') await saveFile(filePath);
    dirtyFiles.delete(filePath);
  }

  openTabs = openTabs.filter(f => f !== filePath);
  fileEditorStates.delete(filePath);

  if (filePath === currentFile) {
    if (openTabs.length > 0) {
      await openFile(openTabs[openTabs.length - 1]);
    } else {
      currentFile = null;
      document.getElementById('editor-wrap').style.display = 'none';
      const bc = document.getElementById('editor-breadcrumb');
      if (bc) { bc.style.display = 'none'; bc.innerHTML = ''; }
      showWelcome(true);
      renderExplorer();
      renderTabs();
    }
  } else {
    renderTabs();
  }
}

// ── Save File ───────────────────────────────────────────────────────────────────
async function saveFile(filePath) {
  const fp = filePath ?? currentFile;
  if (!fp) return;
  const content = fp === currentFile ? view.state.doc.toString() : (fileEditorStates.get(fp)?.doc.toString() ?? '');

  if (usingMemory) {
    memFiles[fp] = content;
  } else {
    const handle = fileHandles.get(fp);
    if (!handle) return;
    try {
      const w = await handle.createWritable();
      await w.write(content);
      await w.close();
    } catch (e) { console.error('Save failed:', e); return; }
  }
  fileContents.set(fp, content);
  dirtyFiles.delete(fp);
  patchTabDirty(fp);
  patchExplorerDirty(fp);
}

// ── Save Dialog ─────────────────────────────────────────────────────────────────
function showSaveDialog(filePath) {
  return new Promise(resolve => {
    const overlay = document.getElementById('save-dialog-overlay');
    document.getElementById('save-dialog-message').textContent =
      `Do you want to save changes to "${filePath.split('/').pop()}"?`;
    overlay.classList.remove('hidden');

    const saveBtn = document.getElementById('save-dialog-save');
    const skipBtn = document.getElementById('save-dialog-dont-save');
    const cancelBtn = document.getElementById('save-dialog-cancel');

    const done = (result) => {
      overlay.classList.add('hidden');
      saveBtn.removeEventListener('click', onSave);
      skipBtn.removeEventListener('click', onSkip);
      cancelBtn.removeEventListener('click', onCancel);
      resolve(result);
    };
    const onSave = () => done('save');
    const onSkip = () => done('discard');
    const onCancel = () => done('cancel');

    saveBtn.addEventListener('click', onSave);
    skipBtn.addEventListener('click', onSkip);
    cancelBtn.addEventListener('click', onCancel);
  });
}

// ── Create File / Folder ────────────────────────────────────────────────────────
async function doCreateFile(parentPath, name) {
  const fullPath = parentPath ? `${parentPath}/${name}` : name;
  if (usingMemory) {
    memFiles[fullPath] = '';
    fileContents.set(fullPath, '');
    await openFile(fullPath);
    return;
  }
  const dh = parentPath === '' ? rootDirHandle : dirHandles.get(parentPath);
  if (!dh) return;
  try {
    const fh = await dh.getFileHandle(name, { create: true });
    fileHandles.set(fullPath, fh);
    const empty = await fh.getFile();
    fileContents.set(fullPath, await empty.text());
    await refreshTree();
    await openFile(fullPath);
  } catch (e) { console.error('Create file failed:', e); }
}

async function doCreateDir(parentPath, name) {
  if (usingMemory) return;
  const fullPath = parentPath ? `${parentPath}/${name}` : name;
  const dh = parentPath === '' ? rootDirHandle : dirHandles.get(parentPath);
  if (!dh) return;
  try {
    const nd = await dh.getDirectoryHandle(name, { create: true });
    dirHandles.set(fullPath, nd);
    expandedDirs.add(fullPath);
    await refreshTree();
  } catch (e) { console.error('Create dir failed:', e); }
}

function startInlineCreate(parentPath, type) {
  if (!usingMemory && parentPath !== '' && !expandedDirs.has(parentPath)) {
    expandedDirs.add(parentPath);
  }
  inlineCreator = { parentPath, type };
  renderExplorer();
}

// ── Delete Item ─────────────────────────────────────────────────────────────────
async function deleteItem(filePath, isDir) {
  const name = filePath.split('/').pop();
  if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;

  if (usingMemory && !isDir) {
    delete memFiles[filePath];
    fileContents.delete(filePath);
    if (openTabs.includes(filePath)) {
      openTabs = openTabs.filter(f => f !== filePath);
      fileEditorStates.delete(filePath); dirtyFiles.delete(filePath);
      if (currentFile === filePath) {
        if (openTabs.length > 0) await openFile(openTabs[openTabs.length - 1]);
        else { currentFile = null; showWelcome(true); renderTabs(); }
      } else renderTabs();
    }
    renderExplorer(); return;
  }

  const parentPath = filePath.includes('/') ? filePath.split('/').slice(0, -1).join('/') : '';
  const ph = parentPath === '' ? rootDirHandle : dirHandles.get(parentPath);
  if (!ph) return;
  try {
    await ph.removeEntry(name, { recursive: isDir });
    if (!isDir) {
      fileHandles.delete(filePath); fileContents.delete(filePath); dirtyFiles.delete(filePath);
      if (openTabs.includes(filePath)) {
        openTabs = openTabs.filter(f => f !== filePath);
        fileEditorStates.delete(filePath);
        if (currentFile === filePath) {
          if (openTabs.length > 0) await openFile(openTabs[openTabs.length - 1]);
          else { currentFile = null; showWelcome(true); renderTabs(); }
        } else renderTabs();
      }
    }
    await refreshTree();
  } catch (e) { console.error('Delete failed:', e); }
}

// ── Rename ──────────────────────────────────────────────────────────────────────
function startRename(filePath, isDir) {
  hideCtxMenu();
  const sel = isDir ? `.dir-item[data-path="${esc(filePath)}"]` : `.file-item[data-file="${esc(filePath)}"]`;
  const el = document.querySelector(sel);
  if (!el) return;
  const nameEl = el.querySelector('.file-name, .dir-name');
  if (!nameEl) return;

  const original = nameEl.textContent;
  const input = document.createElement('input');
  input.type = 'text'; input.value = original;
  input.className = 'inline-input rename-input';
  input.autocomplete = 'off'; input.spellcheck = false;
  nameEl.replaceWith(input);
  input.select();

  let committed = false;
  const commit = async () => {
    if (committed) return; committed = true;
    const newName = input.value.trim();
    if (!newName || newName === original) { input.replaceWith(nameEl); return; }
    await doRename(filePath, isDir, original, newName);
  };

  input.addEventListener('keydown', async e => {
    if (e.key === 'Enter') { e.preventDefault(); await commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); input.replaceWith(nameEl); }
  });
  input.addEventListener('blur', () => setTimeout(commit, 100));
}

async function doRename(filePath, isDir, original, newName) {
  const parentPath = filePath.includes('/') ? filePath.split('/').slice(0, -1).join('/') : '';
  const newPath = parentPath ? `${parentPath}/${newName}` : newName;
  const extChanged = filePath.split('.').pop().toLowerCase() !== newPath.split('.').pop().toLowerCase();

  const updateStateLang = async (path) => {
    const state = fileEditorStates.get(path);
    if (state && extChanged) {
      const langExt = await getLanguageExtension(path);
      fileEditorStates.set(path, state.update({
        effects: languageBox.reconfigure(langExt)
      }).state);
    }
  };

  if (usingMemory && !isDir) {
    memFiles[newPath] = memFiles[filePath]; delete memFiles[filePath];
    fileContents.set(newPath, fileContents.get(filePath) ?? ''); fileContents.delete(filePath);
    const tabIdx = openTabs.indexOf(filePath);
    if (tabIdx !== -1) openTabs[tabIdx] = newPath;
    if (currentFile === filePath) currentFile = newPath;
    const state = fileEditorStates.get(filePath);
    if (state) { fileEditorStates.set(newPath, state); fileEditorStates.delete(filePath); }
    if (dirtyFiles.has(filePath)) { dirtyFiles.add(newPath); dirtyFiles.delete(filePath); }
    await updateStateLang(newPath);
    renderExplorer(); renderTabs();
    if (currentFile === newPath) {
      view.setState(fileEditorStates.get(newPath));
      updateBreadcrumb(newPath);
    }
    return;
  }

  if (!isDir) {
    const fh = fileHandles.get(filePath);
    if (!fh) return;
    const ph = parentPath === '' ? rootDirHandle : dirHandles.get(parentPath);
    if (!ph) return;
    try {
      // Read → create new → delete old
      const f = await fh.getFile(); const content = await f.text();
      const nfh = await ph.getFileHandle(newName, { create: true });
      const w = await nfh.createWritable(); await w.write(content); await w.close();
      await ph.removeEntry(original);
      fileHandles.set(newPath, nfh); fileHandles.delete(filePath);
      fileContents.set(newPath, content); fileContents.delete(filePath);
      const tabIdx = openTabs.indexOf(filePath);
      if (tabIdx !== -1) openTabs[tabIdx] = newPath;
      if (currentFile === filePath) currentFile = newPath;
      const state = fileEditorStates.get(filePath);
      if (state) { fileEditorStates.set(newPath, state); fileEditorStates.delete(filePath); }
      if (dirtyFiles.has(filePath)) { dirtyFiles.add(newPath); dirtyFiles.delete(filePath); }
      await updateStateLang(newPath);
      await refreshTree(); renderTabs();
      if (currentFile === newPath) {
        view.setState(fileEditorStates.get(newPath));
        updateBreadcrumb(newPath);
      }
    } catch (e) { console.error('Rename failed:', e); }
  } else {
    alert('Folder rename is not supported via the browser File System API.\nCreate a new folder and move files manually.');
  }
}

// ── Breadcrumb ──────────────────────────────────────────────────────────────────
function updateBreadcrumb(filePath) {
  const bc = document.getElementById('editor-breadcrumb');
  if (!bc) return;
  const parts = filePath.split('/');
  // all = [root, dir1, dir2, ..., fileName]
  const all = [rootName, ...parts];
  
  // Smart rendering: if path is too long, we keep root and fileName, and abbreviate middle parts
  const MAX_VISIBLE = 4; // Max parts to show before using ellipsis
  let displayParts = [...all];
  
  if (all.length > MAX_VISIBLE) {
    // Keep first (root) and last two (parent + file), or just root and file
    // and replace middle with ...
    const root = all[0];
    const fileName = all[all.length - 1];
    const parentDir = all[all.length - 2];
    
    // Structure: [root, '...', parentDir, fileName]
    displayParts = [root, '...', parentDir, fileName];
  }

  bc.innerHTML = displayParts.map((p, i) => {
    const isLast = i === displayParts.length - 1;
    const isEllipsis = p === '...';
    const isRoot = i === 0 && !isEllipsis;
    
    // Find the original index for path reconstruction
    const originalIdx = isEllipsis ? -1 : (i === 0 ? 0 : (i === 1 ? (all.length > MAX_VISIBLE ? -1 : 1) : (all.length > MAX_VISIBLE ? all.length - (displayParts.length - i) : i)));
    // For the breadcrumb path, we want the path up to that directory
    // If it's root, path is empty string ''. If it's a file, it's the full path.
    const partPath = originalIdx >= 0 ? all.slice(1, originalIdx + 1).join('/') : null;

    let icon = '';
    if (isLast) {
      icon = getFileIcon(p);
    } else if (!isEllipsis && !isRoot) {
      icon = '<i class="fa-solid fa-folder" style="color:#E8AB4F;font-size:11px;"></i>';
    } else if (isRoot) {
      icon = '<i class="fa-solid fa-home" style="color:var(--text-muted);font-size:11px;"></i>';
    }

    const crumbClass = isLast ? 'crumb current-file-crumb' : 'crumb';
    const separator = i < displayParts.length - 1 ? '<i class="fa-solid fa-chevron-right crumb-separator"></i>' : '';
    
    return `<span class="${crumbClass}" data-path="${partPath || ''}" data-root="${isRoot}">${icon ? icon + ' ' : ''}${p}</span>${separator}`;
  }).join('');

  // Add click listeners for VS Code style dropdown behavior
  bc.querySelectorAll('.crumb').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation();
      const path = el.dataset.path;
      const isRoot = el.dataset.root === 'true';
      const rect = el.getBoundingClientRect();
      renderBreadcrumbDropdown(rect.left, rect.bottom, isRoot ? '' : path);
    });
  });

  // Auto-scroll to end to ensure the current file is always visible
  requestAnimationFrame(() => {
    bc.scrollLeft = bc.scrollWidth;
  });
}

function renderBreadcrumbDropdown(x, y, path) {
  hideCtxMenu(); // Close any other menus
  ctxMenu.innerHTML = '';
  
  let targetNodes = [];
  if (path === '') {
    targetNodes = fileTree ? fileTree.children : [];
  } else {
    // Find directory in handles or tree
    const targetDir = dirHandles.get(path);
    if (!targetDir) return;
    
    // We need the children. If already in tree, use that, else we might need to scan (simpler to use tree for now)
    const findInTree = (nodes, p) => {
      for (const n of nodes) {
        if (n.path === p) return n.children;
        if (n.children) {
          const res = findInTree(n.children, p);
          if (res) return res;
        }
      }
      return null;
    };
    targetNodes = findInTree(fileTree.children, path) || [];
  }

  if (targetNodes.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'context-item';
    empty.style.opacity = '0.5';
    empty.innerHTML = '<span>Empty</span>';
    ctxMenu.appendChild(empty);
  }

  targetNodes.forEach(node => {
    const d = document.createElement('div');
    d.className = 'context-item';
    const icon = node.type === 'directory' 
      ? '<i class="fa-solid fa-folder" style="color:#E8AB4F;"></i>' 
      : getFileIcon(node.name);
    d.innerHTML = `${icon}<span>${node.name}</span>`;
    d.addEventListener('click', e => {
      e.stopPropagation();
      hideCtxMenu();
      if (node.type === 'file') {
        openFile(node.path);
      } else {
        // For directories in breadcrumb, we could expand them in explorer or show nested dropdown
        // For now, let's just open the explorer to that path
        if (!expandedDirs.has(node.path)) {
          expandedDirs.add(node.path);
          renderExplorer();
        }
      }
    });
    ctxMenu.appendChild(d);
  });

  ctxMenu.style.left = x + 'px';
  ctxMenu.style.top = y + 'px';
  ctxMenu.classList.remove('hidden');
}

// ── Welcome Screen ──────────────────────────────────────────────────────────────
function showWelcome(show) {
  const welcome = document.getElementById('editor-welcome');
  const msg = document.getElementById('welcome-message');
  const btn = document.getElementById('welcome-open-btn');
  const bc = document.getElementById('editor-breadcrumb');
  const wrap = document.getElementById('editor-wrap');
  const header = document.querySelector('.editor-header');

  if (show) {
    welcome.style.display = 'flex';
    wrap.style.display = 'none';
    if (bc) bc.style.display = 'none';
    if (header) header.style.display = 'none';
    
    if (usingMemory) {
      msg.textContent = 'Open a folder to start editing';
      btn.style.display = 'inline-block';
    } else {
      msg.textContent = 'Select a file to start editing';
      btn.style.display = 'none';
    }
  } else {
    welcome.style.display = 'none';
    wrap.style.display = 'flex';
    if (bc) bc.style.display = 'flex';
    if (header) header.style.display = 'flex';
  }
}

document.getElementById('welcome-open-btn').addEventListener('click', () => openFolder());

// ── Context Menu ────────────────────────────────────────────────────────────────
const ctxMenu = document.getElementById('context-menu');

function showCtxMenu(x, y) {
  if (usingMemory) return;
  ctxMenu.innerHTML = '';
  const isDir = activeContextIsDir;
  const p = activeContextPath;
  const parentOfSelected = isDir ? p : (p.includes('/') ? p.split('/').slice(0, -1).join('/') : '');
  const createTarget = isDir ? p : parentOfSelected;

  const item = (label, icon, fn, danger = false) => {
    const d = document.createElement('div');
    d.className = 'context-item' + (danger ? ' ctx-danger' : '');
    d.innerHTML = `<i class="fa-solid ${icon}"></i><span>${label}</span>`;
    d.addEventListener('click', e => { e.stopPropagation(); hideCtxMenu(); fn(); });
    ctxMenu.appendChild(d);
  };
  const sep = () => { const s = document.createElement('div'); s.className = 'ctx-sep'; ctxMenu.appendChild(s); };

  item('New File', 'fa-file-circle-plus', () => startInlineCreate(createTarget, 'file'));
  item('New Folder', 'fa-folder-plus', () => startInlineCreate(createTarget, 'directory'));
  sep();
  item('Rename', 'fa-pencil', () => startRename(p, isDir));
  sep();
  item('Delete', 'fa-trash', () => deleteItem(p, isDir), true);
  sep();
  item('Copy Path', 'fa-copy', () => navigator.clipboard.writeText(p).catch(() => {}));

  ctxMenu.style.left = x + 'px'; ctxMenu.style.top = y + 'px';
  ctxMenu.classList.remove('hidden');
  requestAnimationFrame(() => {
    const r = ctxMenu.getBoundingClientRect();
    if (r.right > window.innerWidth) ctxMenu.style.left = (x - r.width) + 'px';
    if (r.bottom > window.innerHeight) ctxMenu.style.top = (y - r.height) + 'px';
  });
}

function hideCtxMenu() { ctxMenu.classList.add('hidden'); }
window.addEventListener('click', () => hideCtxMenu());

// ── Sidebar Resizer ─────────────────────────────────────────────────────────────
const resizer = document.getElementById('resizer');
const sidebar = document.getElementById('sidebar');
let isResizing = false;
resizer.addEventListener('mousedown', () => { isResizing = true; resizer.classList.add('resizing'); document.body.style.cursor = 'col-resize'; });
window.addEventListener('mousemove', e => { if (!isResizing) return; let w = Math.max(150, Math.min(600, e.clientX)); sidebar.style.width = w + 'px'; });
window.addEventListener('mouseup', () => { if (isResizing) { isResizing = false; resizer.classList.remove('resizing'); document.body.style.cursor = ''; } });

// ── Explorer Toolbar ────────────────────────────────────────────────────────────
document.getElementById('action-new-file').addEventListener('click', e => {
  e.stopPropagation();
  const parent = (currentFile && currentFile.includes('/')) ? currentFile.split('/').slice(0, -1).join('/') : '';
  startInlineCreate(parent, 'file');
});
document.getElementById('action-new-folder').addEventListener('click', e => {
  e.stopPropagation();
  const parent = (currentFile && currentFile.includes('/')) ? currentFile.split('/').slice(0, -1).join('/') : '';
  startInlineCreate(parent, 'directory');
});
document.getElementById('action-refresh').addEventListener('click', async e => { e.stopPropagation(); await refreshTree(); });
document.getElementById('action-collapse').addEventListener('click', e => { e.stopPropagation(); expandedDirs.clear(); renderExplorer(); });

// ── Status Bar ──────────────────────────────────────────────────────────────────
const cursorEl = document.getElementById('sb-cursor');
const wordsEl  = document.getElementById('sb-words');
function updateStatus() {
  if (!currentFile) return;
  const sel  = view.state.selection.main;
  const line = view.state.doc.lineAt(sel.head);
  const col  = sel.head - line.from + 1;
  if (cursorEl) cursorEl.textContent = `Ln ${line.number}, Col ${col}`;
  const txt = view.state.doc.toString();
  if (wordsEl) wordsEl.textContent = `${txt.trim() === '' ? 0 : txt.trim().split(/\s+/).length} words`;
}
view.dom.addEventListener('click', updateStatus);
view.dom.addEventListener('keyup',  updateStatus);

// ── Zoom Logic ──────────────────────────────────────────────────────────────────
window.updateZoomOrigin = function () {
  if (!isZoomEnabled || !view) return;
  if (!view.hasFocus) { document.body.classList.remove('zoom-active'); return; }
  const sel = view.state.selection.main;
  const coords = view.coordsAtPos(sel.head);
  if (coords) {
    const rect = view.dom.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      const ux = ((coords.left - rect.left) / rect.width) * view.dom.offsetWidth;
      const uy = ((coords.top  - rect.top)  / rect.height) * view.dom.offsetHeight;
      const W = view.dom.offsetWidth, H = view.dom.offsetHeight;
      const mx = 400, my = 200;
      let tx = Math.max(mx, Math.min(W - mx, ux));
      let ty = Math.max(my, Math.min(H - my, uy));
      if (W < mx * 2) tx = W / 2;
      if (H < my * 2) ty = H / 2;
      const s = 3;
      view.dom.style.setProperty('--caret-x', `${(tx - s * ux) / (1 - s)}px`);
      view.dom.style.setProperty('--caret-y', `${(ty - s * uy) / (1 - s)}px`);
    }
  }
  document.body.classList.add('zoom-active');
};

// ── Command Palette ─────────────────────────────────────────────────────────────
const commandOverlay = document.getElementById('command-palette-overlay');
const commandInput   = document.getElementById('command-input');
const paletteList    = document.getElementById('palette-list');

const commands = [
  { id: 'open-folder',       label: 'File: Open Folder...' },
  { id: 'new-file',          label: 'File: New File' },
  { id: 'new-folder',        label: 'File: New Folder' },
  { id: 'save-file',         label: 'File: Save' },
  { id: 'close-editor',      label: 'View: Close Editor' },
  { id: 'toggle-glow',       label: 'Preferences: Toggle Neon Glow Effect' },
  { id: 'toggle-rgb-glow',   label: 'Preferences: Toggle RGB Moving Glow Effect' },
  { id: 'toggle-rgb-text',   label: 'Preferences: Toggle RGB Text Effect' },
  { id: 'toggle-zoom',       label: 'Preferences: Toggle 300% Zoom Tracking' },
  { id: 'open-keybindings',  label: 'Preferences: Open Keyboard Shortcuts' },
];

let filteredCmds = [], selIdx = 0;

function togglePalette(forceClose = false, mode = 'command') {
  if (forceClose || commandOverlay.classList.contains('active')) {
    commandOverlay.classList.remove('active');
    view.focus();
  } else {
    commandOverlay.classList.add('active');
    commandInput.value = mode === 'command' ? '>' : '';
    renderPalette(commandInput.value);
    setTimeout(() => commandInput.focus(), 50);
  }
}

function renderPalette(q) {
  if (q.startsWith('>')) {
    const s = q.slice(1).trim().toLowerCase();
    filteredCmds = commands.filter(c => c.label.toLowerCase().includes(s));
  } else {
    const s = q.toLowerCase();
    const allFiles = usingMemory ? Object.keys(memFiles) : [...fileHandles.keys()];
    filteredCmds = allFiles.filter(f => f.toLowerCase().includes(s))
      .map(f => ({ id: 'open-file:' + f, label: f, isFile: true }));
  }
  selIdx = 0;
  paletteList.innerHTML = '';
  filteredCmds.forEach((cmd, i) => {
    const el = document.createElement('div');
    el.className = 'palette-item' + (i === 0 ? ' active' : '');
    el.innerHTML = cmd.isFile ? `${getFileIcon(cmd.label)}<span style="margin-left:8px">${cmd.label}</span>` : cmd.label;
    el.onclick = () => execCmd(cmd.id);
    el.addEventListener('mouseenter', () => { document.querySelectorAll('.palette-item').forEach(x => x.classList.remove('active')); el.classList.add('active'); selIdx = i; });
    paletteList.appendChild(el);
  });
}

function execCmd(id) {
  togglePalette(true);
  if (id.startsWith('open-file:')) { openFile(id.slice(10)); return; }
  switch (id) {
    case 'open-folder':     openFolder(); break;
    case 'new-file':
      if (usingMemory) { alert('Please open a folder first.'); return; }
      { const p = (currentFile && currentFile.includes('/')) ? currentFile.split('/').slice(0, -1).join('/') : ''; startInlineCreate(p, 'file'); }
      break;
    case 'new-folder':
      if (usingMemory) { alert('Please open a folder first.'); return; }
      { const p = (currentFile && currentFile.includes('/')) ? currentFile.split('/').slice(0, -1).join('/') : ''; startInlineCreate(p, 'directory'); }
      break;
    case 'save-file':
      if (usingMemory) return;
      saveFile(); break;
    case 'close-editor':    if (currentFile) closeTab(currentFile); break;
    case 'toggle-glow':
      isGlowEnabled = !isGlowEnabled;
      isRgbGlowEnabled = false; isRgbTextEnabled = false;
      document.body.classList.toggle('glow-effect', isGlowEnabled);
      document.body.classList.remove('rgb-glow-effect', 'rgb-text-effect'); break;
    case 'toggle-rgb-glow':
      isRgbGlowEnabled = !isRgbGlowEnabled;
      isGlowEnabled = false; isRgbTextEnabled = false;
      document.body.classList.toggle('rgb-glow-effect', isRgbGlowEnabled);
      document.body.classList.remove('glow-effect', 'rgb-text-effect'); break;
    case 'toggle-rgb-text':
      isRgbTextEnabled = !isRgbTextEnabled;
      isGlowEnabled = false; isRgbGlowEnabled = false;
      document.body.classList.toggle('rgb-text-effect', isRgbTextEnabled);
      document.body.classList.remove('glow-effect', 'rgb-glow-effect'); break;
    case 'toggle-zoom':
      isZoomEnabled = !isZoomEnabled;
      document.body.classList.toggle('zoom-tracking-effect', isZoomEnabled);
      if (isZoomEnabled) { document.body.classList.add('zoom-active'); window.updateZoomOrigin(); }
      else { document.body.classList.remove('zoom-active'); view.dom.style.removeProperty('--caret-x'); view.dom.style.removeProperty('--caret-y'); } break;
    case 'open-keybindings': openKeymapSettings(); break;
  }
}

commandInput.addEventListener('input', e => renderPalette(e.target.value));
commandInput.addEventListener('keydown', e => {
  if (e.key === 'Escape') togglePalette(true);
  else if (e.key === 'ArrowDown') { e.preventDefault(); if (selIdx < filteredCmds.length - 1) { selIdx++; document.querySelectorAll('.palette-item').forEach((el,i) => el.classList.toggle('active', i === selIdx)); document.querySelectorAll('.palette-item')[selIdx]?.scrollIntoView({block:'nearest'}); } }
  else if (e.key === 'ArrowUp')   { e.preventDefault(); if (selIdx > 0) { selIdx--; document.querySelectorAll('.palette-item').forEach((el,i) => el.classList.toggle('active', i === selIdx)); document.querySelectorAll('.palette-item')[selIdx]?.scrollIntoView({block:'nearest'}); } }
  else if (e.key === 'Enter')     { e.preventDefault(); if (filteredCmds[selIdx]) execCmd(filteredCmds[selIdx].id); }
});
commandOverlay.addEventListener('click', e => { if (e.target === commandOverlay) togglePalette(true); });

// ── Keymap Settings ─────────────────────────────────────────────────────────────
const keybindings = [
  { id: 'editor.undo',               command: 'Undo',                       keys: 'Ctrl+Z',          source: 'Default' },
  { id: 'editor.redo',               command: 'Redo',                       keys: 'Ctrl+Y',          source: 'Default' },
  { id: 'editor.cut',                command: 'Cut',                        keys: 'Ctrl+X',          source: 'Default' },
  { id: 'editor.copy',               command: 'Copy',                       keys: 'Ctrl+C',          source: 'Default' },
  { id: 'editor.paste',              command: 'Paste',                      keys: 'Ctrl+V',          source: 'Default' },
  { id: 'editor.selectAll',          command: 'Select All',                 keys: 'Ctrl+A',          source: 'Default' },
  { id: 'editor.find',               command: 'Find',                       keys: 'Ctrl+F',          source: 'Default' },
  { id: 'editor.replace',            command: 'Find and Replace',           keys: 'Ctrl+H',          source: 'Default' },
  { id: 'editor.addSelectionNext',   command: 'Add Next Occurrence',        keys: 'Ctrl+D',          source: 'Default' },
  { id: 'editor.indent',             command: 'Indent Line',                keys: 'Tab',             source: 'Default' },
  { id: 'editor.outdent',            command: 'Outdent Line',               keys: 'Shift+Tab',       source: 'Default' },
  { id: 'workbench.quickOpen',       command: 'Go to File',                 keys: 'Ctrl+P',          source: 'Default' },
  { id: 'workbench.commandPalette',  command: 'Open Command Palette',       keys: 'Ctrl+Shift+P',    source: 'Default' },
  { id: 'workbench.openKeybindings', command: 'Open Keyboard Shortcuts',    keys: 'Ctrl+K Ctrl+S',   source: 'Default' },
  { id: 'workbench.newFile',         command: 'New File',                   keys: 'Ctrl+N',          source: 'Default' },
  { id: 'workbench.saveFile',        command: 'Save File',                  keys: 'Ctrl+S',          source: 'Default' },
  { id: 'workbench.closeEditor',     command: 'Close Editor',               keys: 'Ctrl+W',          source: 'Default' },
  { id: 'workbench.openFolder',      command: 'Open Folder',                keys: 'Ctrl+K Ctrl+O',   source: 'Default' },
  { id: 'preferences.glow',         command: 'Toggle Neon Glow',           keys: 'Ctrl+Alt+G',      source: 'Default' },
  { id: 'preferences.rgbGlow',      command: 'Toggle RGB Glow',            keys: 'Ctrl+Alt+R',      source: 'Default' },
  { id: 'preferences.rgbText',      command: 'Toggle RGB Text',            keys: 'Ctrl+Alt+T',      source: 'Default' },
  { id: 'preferences.zoom',         command: 'Toggle 300% Zoom',           keys: 'Ctrl+Alt+Z',      source: 'Default' },
];

const keymapOverlay = document.getElementById('keymap-overlay');
const keymapSearch  = document.getElementById('keymap-search');
const keymapBody    = document.getElementById('keymap-table-body');
let editRowId = null;

function openKeymapSettings() {
  keymapOverlay.classList.add('active');
  keymapSearch.value = ''; editRowId = null;
  renderKeymapRows(); setTimeout(() => keymapSearch.focus(), 50);
}
function closeKeymapSettings() { keymapOverlay.classList.remove('active'); editRowId = null; view.focus(); }

document.getElementById('keymap-close-btn').addEventListener('click', closeKeymapSettings);
keymapOverlay.addEventListener('click', e => { if (e.target === keymapOverlay) closeKeymapSettings(); });
keymapOverlay.addEventListener('keydown', e => { if (e.key === 'Escape' && !editRowId) { e.preventDefault(); closeKeymapSettings(); } });

function fmtKeys(keys) {
  if (!keys) return '<span style="color:var(--text-muted);font-style:italic;font-size:11px">—</span>';
  return keys.split(' ').map((chord, i) => {
    const badges = chord.split('+').map(k => `<span class="kbd-badge">${k}</span>`).join('<span class="kbd-sep">+</span>');
    return (i > 0 ? '<span class="kbd-sep" style="margin:0 4px"> </span>' : '') + badges;
  }).join('');
}

function renderKeymapRows(q = '') {
  const s = q.toLowerCase();
  const filtered = keybindings.filter(kb => kb.command.toLowerCase().includes(s) || kb.keys.toLowerCase().includes(s) || kb.id.toLowerCase().includes(s));
  keymapBody.innerHTML = '';
  if (!filtered.length) { keymapBody.innerHTML = '<div class="keymap-no-results">No keybindings found.</div>'; return; }
  filtered.forEach(kb => {
    const row = document.createElement('div');
    row.className = 'keymap-row' + (editRowId === kb.id ? ' keymap-row-editing' : '');
    row.dataset.id = kb.id;
    if (editRowId === kb.id) {
      row.innerHTML = `<span class="keymap-col-command">${kb.command}</span><span class="keymap-col-keybinding"><input type="text" class="keymap-edit-input" id="keymap-edit-active" placeholder="Press key combo..." readonly/></span><span class="keymap-col-source">${kb.source}</span>`;
    } else {
      row.innerHTML = `<span class="keymap-col-command">${kb.command}</span><span class="keymap-col-keybinding"><button class="keymap-edit-btn" title="Edit"><i class="fa-solid fa-pencil"></i></button>${fmtKeys(kb.keys)}</span><span class="keymap-col-source">${kb.source}</span>`;
    }
    keymapBody.appendChild(row);
    if (editRowId === kb.id) {
      const inp = row.querySelector('#keymap-edit-active');
      setTimeout(() => inp.focus(), 30);
      inp.addEventListener('keydown', e => {
        e.preventDefault(); e.stopPropagation();
        if (e.key === 'Escape') { editRowId = null; renderKeymapRows(keymapSearch.value); return; }
        const parts = [...(e.ctrlKey?['Ctrl']:[]), ...(e.shiftKey?['Shift']:[]), ...(e.altKey?['Alt']:[]), ...(e.metaKey?['Meta']:[])];
        if (!['Control','Shift','Alt','Meta'].includes(e.key)) {
          let dk = e.key.length === 1 ? e.key.toUpperCase() : e.key;
          if (e.key === 'ArrowUp') dk = 'Up'; if (e.key === 'ArrowDown') dk = 'Down';
          if (e.key === 'ArrowLeft') dk = 'Left'; if (e.key === 'ArrowRight') dk = 'Right';
          if (e.key === ' ') dk = 'Space';
          parts.push(dk); kb.keys = parts.join('+'); kb.source = 'User';
          editRowId = null; renderKeymapRows(keymapSearch.value);
        } else inp.value = parts.join('+') + '+...';
      });
    } else {
      row.querySelector('.keymap-edit-btn')?.addEventListener('click', e => { e.stopPropagation(); editRowId = kb.id; renderKeymapRows(keymapSearch.value); });
      row.addEventListener('dblclick', () => { editRowId = kb.id; renderKeymapRows(keymapSearch.value); });
    }
  });
}
keymapSearch.addEventListener('input', e => renderKeymapRows(e.target.value));

// ── Menu Bar ────────────────────────────────────────────────────────────────────
let activeMenu = null;
function closeAllMenus() { document.querySelectorAll('.menu-item.open').forEach(el => el.classList.remove('open')); activeMenu = null; }
document.querySelectorAll('.menu-item').forEach(item => {
  item.querySelector('.menu-label').addEventListener('click', e => {
    e.stopPropagation();
    if (item.classList.contains('open')) closeAllMenus();
    else { closeAllMenus(); item.classList.add('open'); activeMenu = item.dataset.menu; }
  });
  item.addEventListener('mouseenter', () => {
    if (activeMenu && activeMenu !== item.dataset.menu) { closeAllMenus(); item.classList.add('open'); activeMenu = item.dataset.menu; }
  });
});
document.querySelectorAll('.menu-entry').forEach(e => {
  e.addEventListener('click', ev => { ev.stopPropagation(); closeAllMenus(); handleMenu(e.dataset.action); });
});
window.addEventListener('click', () => { if (activeMenu) closeAllMenus(); });

function handleMenu(action) {
  switch (action) {
    case 'new-file':          execCmd('new-file'); break;
    case 'new-folder':        execCmd('new-folder'); break;
    case 'open-folder':       openFolder(); break;
    case 'save-file':         saveFile(); break;
    case 'close-editor':      if (currentFile) closeTab(currentFile); break;
    case 'refresh-explorer':  refreshTree(); break;
    case 'undo':              import('@codemirror/commands').then(m => m.undo(view)); break;
    case 'redo':              import('@codemirror/commands').then(m => m.redo(view)); break;
    case 'cut':               document.execCommand('cut'); break;
    case 'copy':              document.execCommand('copy'); break;
    case 'paste':             navigator.clipboard.readText().then(t => view.dispatch(view.state.replaceSelection(t))).catch(()=>{}); break;
    case 'find':              import('@codemirror/search').then(m => m.openSearchPanel(view)); break;
    case 'replace':           import('@codemirror/search').then(m => m.openSearchPanel(view)); break;
    case 'command-palette':   togglePalette(false, 'command'); break;
    case 'keyboard-shortcuts':openKeymapSettings(); break;
    case 'toggle-glow':       execCmd('toggle-glow'); break;
    case 'toggle-rgb-glow':   execCmd('toggle-rgb-glow'); break;
    case 'toggle-rgb-text':   execCmd('toggle-rgb-text'); break;
    case 'toggle-zoom':       execCmd('toggle-zoom'); break;
    case 'go-to-file':        togglePalette(false, 'file'); break;
  }
}

// ── Global Keyboard Shortcuts ───────────────────────────────────────────────────
let ctrlKPending = false;
window.addEventListener('keydown', async e => {
  const ctrl = e.ctrlKey, shift = e.shiftKey, alt = e.altKey;
  const k = e.key.toLowerCase();

  if (ctrl && !shift && !alt && k === 's') { e.preventDefault(); await saveFile(); return; }
  if (ctrl && !shift && !alt && k === 'n') { e.preventDefault(); execCmd('new-file'); return; }
  if (ctrl && !shift && !alt && k === 'w') { e.preventDefault(); if (currentFile) closeTab(currentFile); return; }
  if (ctrl && !shift && !alt && k === 'p') { e.preventDefault(); togglePalette(false, 'file'); return; }
  if (ctrl && shift  && !alt && k === 'p') { e.preventDefault(); togglePalette(false, 'command'); return; }
  if (ctrl && !shift && !alt && k === 'k') { e.preventDefault(); ctrlKPending = true; return; }
  if (ctrlKPending) {
    if (ctrl && k === 's') { e.preventDefault(); ctrlKPending = false; openKeymapSettings(); return; }
    if (ctrl && k === 'o') { e.preventDefault(); ctrlKPending = false; openFolder(); return; }
    ctrlKPending = false;
  }
  if (ctrl && alt && k === 'g') { e.preventDefault(); execCmd('toggle-glow'); return; }
  if (ctrl && alt && k === 'r') { e.preventDefault(); execCmd('toggle-rgb-glow'); return; }
  if (ctrl && alt && k === 't') { e.preventDefault(); execCmd('toggle-rgb-text'); return; }
  if (ctrl && alt && k === 'z') { e.preventDefault(); execCmd('toggle-zoom'); return; }
});

// ── Init ────────────────────────────────────────────────────────────────────────
const tabsContainer = document.getElementById('tabs-container');
if (tabsContainer) {
  tabsContainer.addEventListener('wheel', (e) => {
    if (e.deltaY !== 0 && !e.shiftKey) {
      e.preventDefault();
      tabsContainer.scrollLeft += e.deltaY;
    }
  }, { passive: false });
}

showWelcome(true);
renderExplorer();
renderTabs();
