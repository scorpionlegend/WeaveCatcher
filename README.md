# WeaveCatcher

WeaveCatcher is a cross-platform desktop website editor built with Tauri 2, Rust, TypeScript, and Preact. It renders page elements in the webview and keeps the editable project document in the Rust process.

## Prerequisites

Install Node.js (LTS) and Rust stable before building. Tauri also needs platform development tools:

- **Windows:** Microsoft C++ Build Tools with **Desktop development with C++**, plus Microsoft Edge WebView2. WebView2 is already included with current Windows 10 and Windows 11 installations.
- **macOS:** Xcode Command Line Tools (`xcode-select --install`) for desktop builds. Full Xcode is needed for Apple mobile targets, which this project does not use.
- **Linux:** Install the WebKitGTK, GTK, and related system development packages for your distribution. Follow the package list for your distribution in the [Tauri prerequisites guide](https://v2.tauri.app/start/prerequisites/).

The official [Tauri prerequisites guide](https://v2.tauri.app/start/prerequisites/) has the current platform requirements and installation instructions.

## Run

```sh
npm install
npm run tauri:dev
```

To build a desktop bundle for the current operating system:

```sh
npm run tauri:build
```

To build just the frontend:

```sh
npm run build
```

Build each desktop release on its target operating system. Linux builds also depend on the distribution's installed WebKitGTK libraries.

## Download installers

The **Build release downloads** workflow publishes these desktop packages to a GitHub Release:

- **Windows x86, x64, and ARM64:** setup `.exe`, `.msi`, and portable `.zip`.
- **macOS:** universal `.dmg` and an archive of the universal `.app` bundle in `.zip` format.
- **Linux x86-64 and ARM64:** `.AppImage`, `.AppImage.zsync`, `.deb`, `.flatpak`, `.pkg.tar.zst`, `.rpm`, and `.tar.gz`.
  FreeBSD packages are not included because Tauri's windowing backend does not support that target.
- **Checksums:** `SHA256SUMS.txt` covers the attached release downloads. GitHub also creates source-code `.zip` and `.tar.gz` archives for each release.

The Mac `.zip` contains the app bundle; this version does not include a separate command-line executable. The browser edition is not part of the desktop release. Website projects created in WeaveCatcher can still be exported from the application.

To publish a release, open the repository's **Actions** tab, select **Build release downloads**, and choose **Run workflow**. It builds the version in `src-tauri/tauri.conf.json` and publishes it as `weavecatcher-v<version>`. Pushing a tag beginning with `weavecatcher-v` also starts a build. Bump the app version in `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and `package.json` before publishing an updated version.

Installers are not code-signed. Windows may show a SmartScreen prompt, and macOS may require approval in Privacy & Security the first time the app is opened. The Windows portable ZIP uses the WebView2 runtime provided by current Windows 10 and Windows 11 installations.

## Editor overview

- Add sections, containers, headings, paragraphs, images, buttons, links, lists, forms, inputs, dividers, spacers, and modal elements from the palette.
- Select elements on the live canvas and edit their text, attributes, dimensions, spacing, color, typography, borders, and layout in the inspector.
- Drag elements into the canvas to nest them, reorder them in Layers, and select, rename, hide, duplicate, copy, or delete them.
- Create and switch between pages. Save and reopen a `.json` project file.
- Configure click, submit, and scroll behaviors. Export emits static HTML and CSS plus one vanilla JavaScript file for configured behaviors.
- Switch between Classic menus and toolbar and the Modern sidebar layout while the app is running. The layout preference is stored on the device.
- Use Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl/Cmd+C/V, and Ctrl/Cmd+D for undo, redo, copy, paste, and duplicate.
- Open generated HTML, CSS, and JavaScript in the split code view. Export a website folder and open its `index.html` in the default browser.

The v1 export interface is structured for adding a future React emitter. Server-side scaffolds and deployment are outside the current scope.

## Architecture

```text
src-tauri/src/
  document.rs       Serializable project, pages, elements, styles, behaviors
  commands.rs       Validated document mutation intents
  undo.rs           Snapshot-based undo and redo history
  ipc.rs            Tauri commands, project file I/O, and editor state
  export/mod.rs      HTML, CSS, JavaScript preview and export emitter
src/
  App.tsx            Preact editor panels, canvas, interactions, and dialogs
  types.ts           Typed document and intent contracts
  style.css          Editor chrome and canvas presentation
```

The Rust `Document` is the source of truth. The frontend sends typed mutation intents over Tauri IPC and renders the returned document. Export code consumes that document directly, without reading UI state.

## Platform note

The Rust and frontend sources are shared across Windows, macOS, and Linux. Native application builds still need to be run on a machine with the target OS prerequisites installed. React and server-side emitters are not implemented in v1.
