# Contributing to Axiom IDE

> **Repo:** [github.com/adyanthm/axiom](https://github.com/adyanthm/axiom)

First off — **thank you.** Axiom IDE is a personal project, and every issue filed, suggestion made, and PR opened genuinely makes it better. Contributions of all sizes are welcome.

This document covers everything you need to know to get from "I want to contribute" to "my PR is merged."

---

## Table of Contents

1. [Code of Conduct](#code-of-conduct)
2. [Project Structure](#project-structure)
3. [Setting Up the Dev Environment](#setting-up-the-dev-environment)
4. [How to Contribute](#how-to-contribute)
   - [Reporting Bugs](#reporting-bugs)
   - [Suggesting Features](#suggesting-features)
   - [Submitting a Pull Request](#submitting-a-pull-request)
5. [Code Style & Conventions](#code-style--conventions)
6. [Browser Compatibility](#browser-compatibility)
7. [Scope of the Project](#scope-of-the-project)

---

## Code of Conduct

Be respectful, constructive, and kind. Critique the code, not the person. That's it.

---

## Project Structure

```
axiom-ide/
├── index.html          # Single-page app shell — all panels and overlays live here
├── src/
│   ├── main.js         # All editor logic: file system, tabs, effects, keybindings, palette
│   └── style.css       # All styles — no preprocessors, pure CSS custom properties
├── public/             # Static assets
├── dist/               # Production build output (gitignored)
└── package.json        # Dependencies and scripts
```

The entire application is intentionally structured in as few files as possible. **Keep it that way.** Adding extra files should require a very good reason. Axiom's simplicity is a feature.

---

## Setting Up the Dev Environment

### Requirements

- **Node.js** 18 or higher
- **Chrome** or **Edge** 86+ (Firefox does not support the File System Access API)
- A code editor (Axiom IDE itself works great 😄)

### Steps

```bash
# 1. Fork the repository on GitHub, then clone your fork
git clone https://github.com/YOUR_USERNAME/axiom-ide.git
cd axiom-ide

# 2. Install dependencies (there aren't many)
npm install

# 3. Start the Vite dev server
npm run dev
```

Open `http://localhost:5173` in Chrome or Edge. Changes to `src/main.js` and `src/style.css` hot-reload instantly.

### Building

```bash
npm run build
# Output is placed in ./dist
npm run preview  # Serve the production build locally
```

---

## How to Contribute

### Reporting Bugs

Before opening a bug report:
- Check the existing [Issues](https://github.com/adyanthm/axiom/issues) to see if it's already reported.
- Reproduce it in a clean browser profile to rule out extensions.

When opening a bug report, include:
- **Browser + version** (e.g., Chrome 121)
- **Operating system**
- **Steps to reproduce** — be specific
- **Expected behaviour** vs. **actual behaviour**
- A screenshot or screen recording if it helps

### Suggesting Features

Feature requests are welcome. Open an [Issue](https://github.com/adyanthm/axiom/issues) with the label `enhancement` and describe:
- **What** you want to add
- **Why** it fits Axiom IDE's philosophy (fast, lightweight, focused on Python)
- Any relevant prior art (how does VS Code or another editor handle it?)

> ⚠️ Features that add significant complexity, dependencies, or runtime overhead will be considered very carefully. Axiom IDE's performance edge is its core value proposition — please keep that in mind.

### Submitting a Pull Request

1. **Open an [Issue](https://github.com/adyanthm/axiom/issues) first** for anything non-trivial. This ensures your work aligns with the project direction before you invest time in it.

2. **Fork** the repository and create a branch:
   ```bash
   git checkout -b feat/your-feature-name
   # or
   git checkout -b fix/bug-description
   ```

3. **Make your changes.** Keep PRs focused — one feature or fix per PR. Avoid bundling unrelated cleanup.

4. **Test manually** — there is no automated test suite. Open the dev server and verify:
   - Your change works as expected
   - Existing features (file open/save, tabs, keybindings, effects) are not broken
   - The UI looks correct in both a folder-open and no-folder-open state

5. **Commit with a clear message:**
   ```
   feat: add minimap to editor area
   fix: resolve zoom tracking drift on narrow viewports
   style: tighten tab hover transition timing
   docs: update keybindings table in README
   ```

6. **Open a Pull Request** against the `main` branch. Fill in the PR template:
   - What does this change?
   - Why is this change needed?
   - How was it tested?
   - Screenshots / GIFs if the change is visual

---

## Code Style & Conventions

There is no linter configured. Please follow the conventions already present in the codebase.

### JavaScript (`main.js`)

- **No frameworks.** Vanilla JS only. No imports beyond the existing CodeMirror packages.
- **No TypeScript.** The project is intentionally plain JS for accessibility and simplicity.
- Use `const` and `let` — never `var`.
- Arrow functions for callbacks. Named functions for top-level declarations.
- Keep related logic grouped under its `// ── Section Name ──` comment header.
- Async functions that touch the file system should be declared `async` and `await` properly — no raw `.then()` chains unless necessary.
- Global state sits at the top of `main.js`. Don't introduce module-level state scattered around the file.

### CSS (`style.css`)

- All colours and spacing tokens use **CSS custom properties** defined in `:root`. Don't hardcode hex values outside of `:root`.
- Section comments follow the pattern: `/* ── Section Name ── */`
- No CSS preprocessors. No utility classes. Styles are scoped and descriptive.
- Animations should be subtle and respect `prefers-reduced-motion` if possible.

### HTML (`index.html`)

- All UI regions and overlay panels are declared here. JavaScript creates DOM elements only for dynamic content (tabs, file explorer rows, palette items).
- Use semantic elements where possible.
- IDs should be descriptive and kebab-cased.

---

## Browser Compatibility

Axiom IDE targets **Chromium-based browsers only** (Chrome 86+, Edge 86+) due to the File System Access API (`showDirectoryPicker`, `FileSystemFileHandle`, `FileSystemDirectoryHandle`).

- **Do not** add polyfills or fallbacks for Firefox/Safari for file system features. The focus is on doing one thing well in the supported environment.
- Firefox users will see an alert explaining the limitation — this is intentional.

---

## Scope of the Project

Axiom IDE started as a Python-focused editor, but the roadmap is growing. Here's what's planned and what's welcome vs. what's not.

### ✅ Planned & Welcome
These are things actively on the roadmap. PRs in these areas are especially encouraged:
- **Language Server Protocol (LSP)** — planned, contributions welcome
- **Multi-language support** — more languages are coming soon
- **Terminal emulator** — planned for a future release
- **Tauri desktop packaging** — planned, to make Axiom a native desktop app
- Performance improvements
- New visual effects (following the existing pattern)
- UI polish and accessibility improvements
- Better Python syntax support (via CodeMirror extensions)
- Bug fixes in file system operations
- Documentation improvements

### ❌ Out of Scope
The following are unlikely to be accepted as they conflict with the project's core philosophy of being lean and fast:
- Extension/plugin marketplace
- Cloud sync or remote editing
- Git integration (at least for now)
- Telemetry or analytics of any kind

When in doubt, open an [Issue](https://github.com/adyanthm/axiom/issues) and ask. It's much better to align upfront than to put in effort on something that won't be merged.

---

Thanks again for taking the time to contribute. Every bit helps. ⚡
