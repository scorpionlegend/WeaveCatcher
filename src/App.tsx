import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { h } from "preact";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import type { Behavior, DocumentModel, EditIntent, ElementNode, ExportBundle } from "./types";

type Panel = "add" | "pages" | "layers" | "behaviors" | "theme" | "settings";
type CodeTab = "html" | "css" | "js";
const PALETTE = [
  ["section", "Section", "▱"], ["container", "Container", "▧"], ["heading", "Heading", "T"],
  ["paragraph", "Paragraph", "¶"], ["image", "Image", "▧"], ["button", "Button", "▰"],
  ["link", "Link", "↗"], ["list", "List", "☷"], ["form", "Form", "▤"],
  ["input", "Input", "▭"], ["divider", "Divider", "―"], ["spacer", "Spacer", "↕"],
  ["modal", "Modal", "▣"],
] as const;

function allElements(elements: ElementNode[]): ElementNode[] {
  return elements.flatMap((element) => [element, ...allElements(element.children)]);
}

function findElement(elements: ElementNode[], id: string | null): ElementNode | undefined {
  if (!id) return undefined;
  for (const element of elements) {
    if (element.id === id) return element;
    const child = findElement(element.children, id);
    if (child) return child;
  }
  return undefined;
}

function tagFor(kind: string): string {
  const tags: Record<string, string> = {
    section: "section", container: "div", heading: "h2", paragraph: "p", image: "img",
    button: "a", link: "a", list: "ul", list_item: "li", form: "form", input: "input",
    divider: "hr", spacer: "div", modal: "div",
  };
  return tags[kind] ?? "div";
}

function App() {
  const [documentModel, setDocumentModel] = useState<DocumentModel | null>(null);
  const [dirty, setDirty] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activePanel, setActivePanel] = useState<Panel>("add");
  const [showCode, setShowCode] = useState(false);
  const [codeTab, setCodeTab] = useState<CodeTab>("html");
  const [code, setCode] = useState<ExportBundle>({ html: "", css: "", js: "" });
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [draggingKind, setDraggingKind] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [lastExportDir, setLastExportDir] = useState<string | null>(null);
  const [contextPoint, setContextPoint] = useState<{ x: number; y: number } | null>(null);
  const [modalPreview, setModalPreview] = useState<string | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const page = useMemo(() => documentModel?.pages.find((item) => item.id === documentModel.activePageId), [documentModel]);
  const selected = useMemo(() => page && findElement(page.elements, selectedId), [page, selectedId]);

  useEffect(() => {
    let mounted = true;
    invoke<DocumentModel>("get_document").then(async (doc) => {
      if (!mounted) return;
      setDocumentModel(doc);
      const preferred = localStorage.getItem("visionweave-layout");
      if ((preferred === "classic" || preferred === "modern") && preferred !== doc.settings.layout) {
        const next = await invoke<DocumentModel>("mutate_document", { intent: { type: "set_layout", layout: preferred } });
        if (mounted) setDocumentModel(next);
      }
    }).catch((cause: unknown) => { if (mounted) setError(`Open WeaveCatcher in its desktop window to connect to the Rust editor. ${String(cause)}`); });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!showCode) return;
    invoke<ExportBundle>("get_export_preview").then(setCode).catch(showError);
  }, [documentModel, showCode]);

  useEffect(() => {
    const onKeyDown = async (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editing = target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
      if (editing) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        await travelHistory(event.shiftKey ? "redo_document" : "undo_document");
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
        event.preventDefault(); await travelHistory("redo_document");
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d" && selectedId) {
        event.preventDefault(); await mutate({ type: "duplicate_element", id: selectedId });
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c" && selectedId) {
        event.preventDefault(); await invoke("copy_element", { id: selectedId }); setToast("Element copied");
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v") {
        event.preventDefault(); await pasteElement();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedId, documentModel]);

  function showError(cause: unknown) {
    const message = cause instanceof Error ? cause.message : String(cause);
    setError(message);
    window.setTimeout(() => setError(""), 5000);
  }

  async function mutate(intent: EditIntent) {
    try {
      const next = await invoke<DocumentModel>("mutate_document", { intent });
      setDocumentModel(next);
      setDirty(true);
      return next;
    } catch (cause) { showError(cause); return undefined; }
  }

  async function travelHistory(command: "undo_document" | "redo_document") {
    try { setDocumentModel(await invoke<DocumentModel>(command)); setDirty(true); }
    catch (cause) { showError(cause); }
  }

  async function pasteElement() {
    try {
      const next = await invoke<DocumentModel>("paste_element", { parentId: selectedId });
      setDocumentModel(next); setDirty(true); setToast("Element pasted");
    } catch (cause) { showError(cause); }
  }

  async function newProject() {
    if (documentModel && !window.confirm("Start a new website? Save any changes you want to keep first.")) return;
    try {
      let next = await invoke<DocumentModel>("new_project");
      const preferred = localStorage.getItem("visionweave-layout");
      if ((preferred === "classic" || preferred === "modern") && preferred !== next.settings.layout) next = await invoke<DocumentModel>("mutate_document", { intent: { type: "set_layout", layout: preferred } });
      setDocumentModel(next); setDirty(false); setSelectedId(null); setLastExportDir(null);
    }
    catch (cause) { showError(cause); }
  }

  async function openProject() {
    try {
      const path = await open({ multiple: false, filters: [{ name: "WeaveCatcher project", extensions: ["wc", "weavecatcher.json", "visionweave.json", "json"] }] });
      if (typeof path !== "string") return;
      let next = await invoke<DocumentModel>("load_project", { path });
      const preferred = localStorage.getItem("visionweave-layout");
      if ((preferred === "classic" || preferred === "modern") && preferred !== next.settings.layout) next = await invoke<DocumentModel>("mutate_document", { intent: { type: "set_layout", layout: preferred } });
      setDocumentModel(next); setDirty(false);
      setSelectedId(null); setToast("Project opened");
    } catch (cause) { showError(cause); }
  }

  async function saveProject(saveAs = false) {
    try {
      let path: string | undefined;
      if (saveAs) {
        const picked = await save({ defaultPath: `${documentModel?.name ?? "Untitled website"}.wc`, filters: [{ name: "WeaveCatcher project", extensions: ["wc"] }] });
        if (!picked) return;
        path = picked;
      }
      await invoke<string>("save_project", { path: path ?? null });
      setDirty(false);
      setToast("Project saved");
    } catch (cause) {
      if (String(cause).includes("Choose a project file location")) return saveProject(true);
      showError(cause);
    }
  }

  async function exportToFolder() {
    try {
      const picked = await open({ directory: true, multiple: false, title: "Choose export folder" });
      if (typeof picked !== "string") return;
      await invoke("export_project", { folder: picked });
      setLastExportDir(picked); setToast("Website exported");
    } catch (cause) { showError(cause); }
  }

  async function previewSite() {
    try {
      let folder = lastExportDir;
      if (!folder) {
        const picked = await open({ directory: true, multiple: false, title: "Choose a folder for the preview site" });
        if (typeof picked !== "string") return;
        folder = picked;
        await invoke("export_project", { folder });
        setLastExportDir(folder);
      } else await invoke("export_project", { folder });
      const separator = folder.includes("\\") ? "\\" : "/";
      await openPath(`${folder.replace(/[\\/]$/, "")}${separator}index.html`);
    } catch (cause) { showError(cause); }
  }

  async function addElement(kind: string, parentId?: string | null) {
    const before = parentId ? findElement(page?.elements ?? [], parentId)?.children ?? [] : page?.elements ?? [];
    const next = await mutate({ type: "add_element", kind, parentId: parentId ?? null });
    const after = parentId ? findElement(next?.pages.find((item) => item.id === next.activePageId)?.elements ?? [], parentId)?.children ?? [] : next?.pages.find((item) => item.id === next.activePageId)?.elements ?? [];
    const added = after.find((element) => !before.some((item) => item.id === element.id));
    if (added) {
      setSelectedId(added.id);
      setToast(`${added.name} added to the canvas`);
    }
  }

  function onRootDrop(event: DragEvent) {
    event.preventDefault();
    const kind = event.dataTransfer?.getData("application/x-vw-kind") || draggingKind;
    const id = event.dataTransfer?.getData("application/x-vw-element") || draggingId;
    if (kind) addElement(kind);
    else if (id && page) void mutate({ type: "move_element", id, index: page.elements.length });
    setDraggingId(null); setDraggingKind(null);
  }

  function setLayout(layout: "classic" | "modern") {
    localStorage.setItem("visionweave-layout", layout);
    void mutate({ type: "set_layout", layout });
  }

  function pickElement(id: string, event: MouseEvent) {
    event.stopPropagation();
    setSelectedId(id);
    const stage = stageRef.current?.getBoundingClientRect();
    const target = (event.currentTarget as HTMLElement).getBoundingClientRect();
    if (stage) setContextPoint({ x: Math.max(12, Math.min(target.left - stage.left, stage.width - 168)), y: Math.max(12, target.top - stage.top - 44) });
  }

  async function previewBehavior(element: ElementNode) {
    for (const behavior of element.behaviors.filter((item) => item.trigger === "on_click")) {
      const target = findElement(page?.elements ?? [], behavior.target);
      if (behavior.action === "open_url") setToast(`Preview link: ${behavior.value || "Add a URL in Behaviors"}`);
      else if (behavior.action === "scroll_to" && behavior.target) stageRef.current?.querySelector(`[data-node-id="${behavior.target}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      else if (behavior.action === "toggle" && target) await mutate({ type: "set_hidden", id: target.id, hidden: !target.hidden });
      else if (behavior.action === "open_modal" && target) setModalPreview(target.id);
      else if (behavior.action === "close_modal") setModalPreview(null);
      else if (behavior.action === "validate_form") setToast("Required fields are checked in the exported site.");
      else if (behavior.action === "success_message") setToast(behavior.value || "Thanks! Your form was submitted.");
      else if (behavior.action === "fade_in") setToast("Animation preview");
    }
  }

  if (!documentModel) return <main class="loading-screen"><div class="brand-mark">wc</div><strong>WeaveCatcher</strong><span>{error || "Connecting to the editor…"}</span></main>;

  const elements = page?.elements ?? [];
  const elementCount = page ? allElements(page.elements).length : 0;
  const panelButtons: { id: Panel; icon: string; label: string }[] = [
    { id: "add", icon: "+", label: "Add" }, { id: "pages", icon: "▤", label: "Pages" },
    { id: "layers", icon: "☷", label: "Layers" }, { id: "behaviors", icon: "⌁", label: "Behaviors" },
    { id: "theme", icon: "◒", label: "Theme" }, { id: "settings", icon: "⚙", label: "Settings" },
  ];

  return <div class={`app-shell ${documentModel.settings.layout}`}>
    <header class="topbar">
      <div class="brand-lockup"><div class="brand-mark">wc</div><span>WeaveCatcher</span><i class="brand-divider" /></div>
      {documentModel.settings.layout === "classic" ? <>
        <nav class="menu-row" aria-label="Main menu">
          <details class="menu"><summary>File</summary><div class="menu-pop"><button onClick={newProject}>New project</button><button onClick={openProject}>Open project…</button><button onClick={() => void saveProject()}>Save</button><button onClick={() => void saveProject(true)}>Save as…</button><hr /><button onClick={exportToFolder}>Export website…</button></div></details>
          <details class="menu"><summary>Edit</summary><div class="menu-pop"><button onClick={() => void travelHistory("undo_document")}>Undo <kbd>⌘Z</kbd></button><button onClick={() => void travelHistory("redo_document")}>Redo <kbd>⇧⌘Z</kbd></button><button onClick={() => selectedId && void mutate({ type: "duplicate_element", id: selectedId })}>Duplicate</button><button onClick={() => void pasteElement()}>Paste</button></div></details>
          <details class="menu"><summary>Insert</summary><div class="menu-pop">{PALETTE.slice(0, 8).map(([kind, label]) => <button key={kind} onClick={() => addElement(kind)}>{label}</button>)}</div></details>
          <details class="menu"><summary>Format</summary><div class="menu-pop"><button onClick={() => setActivePanel("theme")}>Style presets</button><button onClick={() => setActivePanel("behaviors")}>Behaviors…</button></div></details>
          <details class="menu"><summary>View</summary><div class="menu-pop"><button onClick={() => setShowCode(!showCode)}>{showCode ? "Hide" : "Show"} code view</button><button onClick={() => setLayout(documentModel.settings.layout === "classic" ? "modern" : "classic")}>Switch toolbar style</button></div></details>
        </nav>
      </> : <div class="project-title"><details class="project-menu"><summary><strong>{documentModel.name}</strong><span>⌄</span></summary><div class="menu-pop"><button onClick={newProject}>New project</button><button onClick={openProject}>Open project…</button><button onClick={() => void saveProject(true)}>Save as…</button><hr /><button onClick={exportToFolder}>Export website…</button></div></details><span>·</span><span>{page?.name ?? "No page"}</span></div>}
      <div class="top-actions">
        <button class="quiet-button layout-switch" title="Switch editor layout" onClick={() => setLayout(documentModel.settings.layout === "classic" ? "modern" : "classic")}><span>◐</span>{documentModel.settings.layout === "classic" ? "Modern" : "Classic"}</button>
        <button class="quiet-button" onClick={() => setShowCode(!showCode)} title="Toggle generated code">{showCode ? "Canvas" : "Code"}</button>
        <button class="quiet-button" onClick={() => void saveProject()} title="Save project">Save</button>
        <button class="quiet-button export-action" onClick={exportToFolder} title="Export website files">Export</button>
        <button class="primary-button" onClick={() => void previewSite()}><span>▷</span> Preview</button>
        <button class="avatar-button" title="WeaveCatcher settings" onClick={() => setActivePanel("settings")}>A</button>
      </div>
    </header>

    {documentModel.settings.layout === "classic" && <div class="classic-toolbar">
      <div class="toolbar-group"><button title="New project" onClick={newProject}>＋ <span>New</span></button><button title="Open project" onClick={openProject}>↗ <span>Open</span></button><button title="Save project" onClick={() => void saveProject()}>▣ <span>Save</span></button><i /></div>
      <div class="toolbar-group"><button title="Undo" onClick={() => void travelHistory("undo_document")}>↶</button><button title="Redo" onClick={() => void travelHistory("redo_document")}>↷</button><i /><button title="Export" onClick={exportToFolder}>⇩ <span>Export</span></button></div>
      <span class="toolbar-spacer" />
      <div class="device-toggle"><button class="active">Desktop</button><button title="Responsive editing is planned for v2" onClick={() => setToast("Tablet preview is coming in a future release.")}>Tablet</button><button title="Responsive editing is planned for v2" onClick={() => setToast("Mobile preview is coming in a future release.")}>Mobile</button></div>
    </div>}

    <div class="workspace">
      <aside class={`left-workbench ${documentModel.settings.layout === "modern" ? "modern-workbench" : "classic-workbench"}`}>
        {documentModel.settings.layout === "modern" && <nav class="icon-rail" aria-label="Editor panels">
          {panelButtons.map((item) => <button key={item.id} class={activePanel === item.id ? "active" : ""} title={item.label} onClick={() => setActivePanel(item.id)}><span>{item.icon}</span><small>{item.label}</small></button>)}
        </nav>}
        <div class="panel-sidebar">
          {documentModel.settings.layout === "classic" && <div class="panel-tabs">{panelButtons.map((item) => <button key={item.id} class={activePanel === item.id ? "active" : ""} onClick={() => setActivePanel(item.id)}>{item.label}</button>)}</div>}
          <div class="panel-heading"><div><span class="eyebrow">WORKSPACE</span><h2>{panelButtons.find((item) => item.id === activePanel)?.label}</h2></div><button class="icon-button small" title="Collapse panel" onClick={() => setActivePanel("add")}>‹</button></div>
          {activePanel === "add" && <div class="panel-content palette-panel">
            <label class="search-box"><span>⌕</span><input placeholder="Find an element" aria-label="Find an element" onInput={(event) => { const term = event.currentTarget.value.toLowerCase(); document.querySelectorAll<HTMLElement>(".palette-item").forEach((item) => { item.hidden = !item.dataset.label?.includes(term); }); }} /></label>
            <p class="section-label">BASIC ELEMENTS</p>
            <div class="palette-grid">{PALETTE.map(([kind, label, icon]) => <button key={kind} class="palette-item" data-label={label.toLowerCase()} draggable onDragStart={(event) => { event.dataTransfer?.setData("application/x-vw-kind", kind); setDraggingKind(kind); }} onDragEnd={() => setDraggingKind(null)} onClick={() => addElement(kind)}><span class="palette-icon">{icon}</span><span>{label}</span><span class="drag-grip">⠿</span></button>)}</div>
            <div class="tip-card"><span>✦</span><div><strong>Build with blocks</strong><p>Drag an element onto the canvas, or click to add it.</p></div></div>
          </div>}
          {activePanel === "pages" && <div class="panel-content pages-panel"><div class="panel-section-title"><span>YOUR PAGES</span><button class="icon-button small accent" title="Add page" onClick={() => void mutate({ type: "add_page", name: `Page ${documentModel.pages.length + 1}` })}>＋</button></div>
            <div class="page-list">{documentModel.pages.map((item, index) => <div key={item.id} class={`page-item ${page?.id === item.id ? "active" : ""}`}><button class="page-main" onClick={() => { void mutate({ type: "set_active_page", id: item.id }); setSelectedId(null); }}><span class="page-icon">{index === 0 ? "⌂" : "▤"}</span><span><strong>{item.name}</strong><small>/{index === 0 ? "" : item.slug}</small></span>{index === 0 && <em>HOME</em>}</button><button class="icon-button small page-menu" title={`Rename ${item.name}`} onClick={() => { const name = window.prompt("Page name", item.name); if (name?.trim()) void mutate({ type: "rename_page", id: item.id, name: name.trim() }); }}>···</button><button class="icon-button small page-delete" title="Delete page" onClick={() => { if (documentModel.pages.length > 1 && window.confirm(`Delete ${item.name}?`)) void mutate({ type: "delete_page", id: item.id }); }}>×</button></div>)}</div>
            <button class="dashed-button" onClick={() => void mutate({ type: "add_page", name: `Page ${documentModel.pages.length + 1}` })}>＋ Add page</button>
          </div>}
          {activePanel === "layers" && <div class="panel-content layers-panel"><div class="panel-section-title"><span>PAGE STRUCTURE</span><span class="tiny-count">{elementCount} items</span></div>{elements.length ? <div class="layer-tree">{elements.map((element, index) => <LayerItem key={element.id} element={element} depth={0} index={index} parentId={null} siblingIds={elements.map((item) => item.id)} selectedId={selectedId} select={setSelectedId} mutate={mutate} />)}</div> : <div class="empty-panel"><span>☷</span><strong>Nothing here yet</strong><p>Add an element to see your page structure.</p></div>}</div>}
          {activePanel === "behaviors" && <div class="panel-content behavior-panel"><div class="behavior-intro"><span class="behavior-symbol">⌁</span><div><strong>Make it interactive</strong><p>Choose what happens when visitors interact with this element.</p></div></div>{selected ? <BehaviorEditor element={selected} elements={page ? allElements(page.elements) : []} mutate={mutate} /> : <div class="empty-panel"><span>↖</span><strong>Select an element</strong><p>Choose an element on the canvas to add behavior.</p></div>}</div>}
          {activePanel === "theme" && <div class="panel-content theme-panel"><p class="section-label">QUICK STYLE PRESETS</p><p class="muted-copy">Select an element on your page, then choose a preset.</p>{selected ? <div class="preset-list"><button onClick={() => { void mutate({ type: "set_style", id: selected.id, property: "borderRadius", value: "12px" }); void mutate({ type: "set_style", id: selected.id, property: "boxShadow", value: "0 8px 24px rgba(31, 41, 55, .12)" }); }}>Soft card <span>▢</span></button><button onClick={() => { void mutate({ type: "set_style", id: selected.id, property: "backgroundColor", value: "#f4f6ff" }); void mutate({ type: "set_style", id: selected.id, property: "padding", value: "24px" }); }}>Lavender surface <span>◒</span></button><button onClick={() => { void mutate({ type: "set_style", id: selected.id, property: "color", value: "#ffffff" }); void mutate({ type: "set_style", id: selected.id, property: "backgroundColor", value: "#25324b" }); }}>Midnight <span>●</span></button><button onClick={() => { void mutate({ type: "set_style", id: selected.id, property: "color", value: "#18212f" }); void mutate({ type: "set_style", id: selected.id, property: "backgroundColor", value: "#ffffff" }); }}>Reset colors <span>↺</span></button></div> : <div class="empty-panel"><span>◒</span><strong>Select an element</strong><p>Choose an element to apply a style preset.</p></div>}</div>}
          {activePanel === "settings" && <div class="panel-content settings-panel"><p class="section-label">PROJECT</p><label class="field-label">Project name<input value={documentModel.name} onChange={(event) => void mutate({ type: "rename_project", name: event.currentTarget.value })} /></label><button class="wide-row" onClick={openProject}><span>Open another project</span><b>↗</b></button><button class="wide-row" onClick={() => void saveProject(true)}><span>Save project as…</span><b>⇩</b></button><p class="section-label separated">EDITOR LAYOUT</p><p class="muted-copy">Your choice is saved on this device.</p><div class="layout-choice"><button class={documentModel.settings.layout === "classic" ? "chosen" : ""} onClick={() => setLayout("classic")}><span class="layout-thumb classic-thumb">▤</span><strong>Classic</strong><small>Menus &amp; toolbar</small></button><button class={documentModel.settings.layout === "modern" ? "chosen" : ""} onClick={() => setLayout("modern")}><span class="layout-thumb modern-thumb">▥</span><strong>Modern</strong><small>Expandable sidebar</small></button></div><p class="settings-footnote">WeaveCatcher 0.1 · Project format v1</p></div>}
        </div>
      </aside>

      <main class="canvas-area">
        <div class="canvas-toolbar"><div class="breadcrumb"><button onClick={() => setSelectedId(null)}>{documentModel.name}</button><span>/</span><button onClick={() => setSelectedId(null)}>{page?.name}</button>{selected && <><span>/</span><strong>{selected.name}</strong></>}</div><div class="canvas-tools"><span class={`saved-state ${dirty ? "unsaved" : ""}`}><i /> {dirty ? "Unsaved changes" : "All changes saved"}</span><i class="tool-divider" /><button class="icon-button" title="Zoom out" onClick={() => setToast("Canvas zoom: 100%")}>−</button><span class="zoom-label">100%</span><button class="icon-button" title="Zoom in" onClick={() => setToast("Canvas zoom: 100%")}>＋</button><button class="icon-button" title="Toggle code view" onClick={() => setShowCode(!showCode)}>{showCode ? "◫" : "▤"}</button></div></div>
        <div class={`editor-workarea ${showCode ? "with-code" : ""}`}>
          <div class="stage-scroll" ref={stageRef} onClick={() => { setSelectedId(null); setContextPoint(null); }} onDragOver={(event) => { event.preventDefault(); setDropTarget("root"); }} onDrop={(event) => { onRootDrop(event); setDropTarget(null); }}>
            <div class={`canvas-page ${dropTarget === "root" && draggingKind ? "root-drop-target" : ""}`}>
              {elements.length ? elements.map((element) => <CanvasElement key={element.id} node={element} selectedId={selectedId} dropTarget={dropTarget} setDropTarget={setDropTarget} mutate={mutate} onPick={pickElement} onPreview={previewBehavior} onDragState={(id, kind) => { setDraggingId(id); setDraggingKind(kind); }} />) : <div class="canvas-empty"><div class="empty-art"><span>＋</span><i /><b /><em /></div><h2>Your canvas is ready</h2><p>Drag an element here or add your first block from the panel.</p><button class="primary-button" onClick={() => void addElement("section")}>＋ Add a section</button></div>}
              {selected && contextPoint && <div class="floating-toolbar" style={{ left: `${contextPoint.x}px`, top: `${contextPoint.y}px` }} onClick={(event) => event.stopPropagation()}><span class="floating-name">{selected.name}</span><button title="Duplicate" onClick={() => void mutate({ type: "duplicate_element", id: selected.id })}>⧉</button><button title="Delete" onClick={() => { void mutate({ type: "delete_element", id: selected.id }); setSelectedId(null); }}>⌫</button><button title="Open behavior settings" onClick={() => setActivePanel("behaviors")}>⌁</button></div>}
              {modalPreview && <div class="modal-preview-backdrop" onClick={() => setModalPreview(null)}><div class="modal-preview" onClick={(event) => event.stopPropagation()}><button class="modal-close" onClick={() => setModalPreview(null)}>×</button><span class="eyebrow">INTERACTION PREVIEW</span><h3>{findElement(elements, modalPreview)?.content || "Modal preview"}</h3><p>This dialog demonstrates the configured modal behavior.</p><button class="primary-button" onClick={() => setModalPreview(null)}>Close</button></div></div>}
            </div>
          </div>
          {showCode && <section class="code-panel"><div class="code-header"><div><span class="eyebrow">GENERATED CODE</span><h2>Page source</h2></div><button class="icon-button" onClick={() => setShowCode(false)} title="Close code view">×</button></div><div class="code-tabs">{(["html", "css", "js"] as const).map((tab) => <button class={codeTab === tab ? "active" : ""} onClick={() => setCodeTab(tab)}>{tab === "html" ? "index.html" : tab === "js" ? "script.js" : "styles.css"}</button>)}</div><pre class="code-source"><code>{code[codeTab]}</code></pre></section>}
        </div>
        <footer class="statusbar"><span><i class="status-dot" /> {page?.name ?? "No page"}</span><span>{elementCount} element{elementCount === 1 ? "" : "s"}</span><span class="status-spacer" /><span>HTML · CSS · JavaScript</span></footer>
      </main>

      <aside class="inspector"><div class="inspector-heading"><div><span class="eyebrow">PROPERTIES</span><h2>{selected?.name ?? "Inspector"}</h2></div>{selected && <button class="icon-button" title="More actions" onClick={() => setActivePanel("behaviors")}>···</button>}</div>
        {selected ? <Inspector element={selected} mutate={mutate} /> : <div class="inspector-empty"><div class="cursor-art">↖</div><strong>Nothing selected</strong><p>Click an element on your canvas to edit its content, style, and behavior.</p><button class="text-action" onClick={() => setActivePanel("add")}>Browse elements <span>→</span></button></div>}
      </aside>
    </div>
    <footer class="app-footer"><span>WeaveCatcher <b>·</b> {documentModel.name}</span><span class="footer-status"><i /> Ready</span><span>Ctrl/Cmd + Z to undo</span></footer>
    {(toast || error) && <div class={`toast ${error ? "toast-error" : ""}`} role="status">{error ? <span>!</span> : <span>✓</span>}{error || toast}<button onClick={() => { setError(""); setToast(""); }}>×</button></div>}
  </div>;
}

function CanvasElement(props: { node: ElementNode; selectedId: string | null; dropTarget: string | null; setDropTarget: (id: string | null) => void; mutate: (intent: EditIntent) => Promise<DocumentModel | undefined>; onPick: (id: string, event: MouseEvent) => void; onPreview: (element: ElementNode) => void; onDragState: (id: string | null, kind: string | null) => void }) {
  const { node, selectedId, dropTarget, setDropTarget, mutate, onPick, onPreview, onDragState } = props;
  const tag = tagFor(node.kind);
  const propsForNode: Record<string, unknown> = { ...node.attributes, class: `canvas-node ${selectedId === node.id ? "is-selected" : ""} ${dropTarget === node.id ? "is-drop-target" : ""} ${node.hidden ? "is-hidden" : ""}`, style: node.styles, "data-node-id": node.id, draggable: true };
  propsForNode.onClick = (event: MouseEvent) => { event.preventDefault(); onPick(node.id, event); void onPreview(node); };
  propsForNode.onDragStart = (event: DragEvent) => { event.dataTransfer?.setData("application/x-vw-element", node.id); event.dataTransfer?.setData("text/plain", node.id); event.stopPropagation(); onDragState(node.id, null); };
  propsForNode.onDragEnd = () => onDragState(null, null);
  propsForNode.onDragOver = (event: DragEvent) => { event.preventDefault(); event.stopPropagation(); setDropTarget(node.id); };
  propsForNode.onDrop = (event: DragEvent) => {
    event.preventDefault(); event.stopPropagation();
    const kind = event.dataTransfer?.getData("application/x-vw-kind");
    const id = event.dataTransfer?.getData("application/x-vw-element");
    if (kind) void mutate({ type: "add_element", kind, parentId: node.id });
    else if (id && id !== node.id) void mutate({ type: "move_element", id, parentId: node.id, index: node.children.length });
    setDropTarget(null);
    onDragState(null, null);
  };
  const children = node.children.map((child) => <CanvasElement key={child.id} node={child} selectedId={selectedId} dropTarget={dropTarget} setDropTarget={setDropTarget} mutate={mutate} onPick={onPick} onPreview={onPreview} onDragState={onDragState} />);
  const content = node.kind === "image" || node.kind === "input" || node.kind === "divider" ? undefined : node.content;
  return h(tag, propsForNode, content, ...children);
}

function LayerItem(props: { element: ElementNode; depth: number; index: number; parentId: string | null; siblingIds: string[]; selectedId: string | null; select: (id: string) => void; mutate: (intent: EditIntent) => Promise<DocumentModel | undefined> }) {
  const { element, depth, index, parentId, siblingIds, selectedId, select, mutate } = props;
  const [expanded, setExpanded] = useState(true);
  return <div class="layer-branch"><div class={`layer-row ${selectedId === element.id ? "active" : ""}`} style={{ paddingLeft: `${10 + depth * 16}px` }} draggable onDragStart={(event) => { event.dataTransfer?.setData("application/x-vw-element", element.id); event.dataTransfer?.setData("text/plain", element.id); event.stopPropagation(); }} onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); event.currentTarget.classList.add("is-drop-target"); }} onDragLeave={(event) => event.currentTarget.classList.remove("is-drop-target")} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); const movingId = event.dataTransfer?.getData("application/x-vw-element"); if (movingId && movingId !== element.id) { const oldIndex = siblingIds.indexOf(movingId); const destination = index - (oldIndex !== -1 && oldIndex < index ? 1 : 0); void mutate({ type: "move_element", id: movingId, parentId, index: destination }); } event.currentTarget.classList.remove("is-drop-target"); }}><button class="layer-expand" onClick={() => setExpanded(!expanded)}>{element.children.length ? expanded ? "⌄" : "›" : "·"}</button><button class="layer-select" onClick={() => select(element.id)}><span class="layer-kind">{PALETTE.find(([kind]) => kind === element.kind)?.[2] ?? "▧"}</span><span class={element.hidden ? "muted" : ""}>{element.name}</span></button><button class="layer-action" title={element.hidden ? "Show element" : "Hide element"} onClick={() => void mutate({ type: "set_hidden", id: element.id, hidden: !element.hidden })}>{element.hidden ? "◉" : "◌"}</button><button class="layer-action" title="Rename" onClick={() => { const name = window.prompt("Layer name", element.name); if (name?.trim()) void mutate({ type: "rename_element", id: element.id, name: name.trim() }); }}>✎</button></div>{expanded && element.children.map((child, childIndex) => <LayerItem key={child.id} element={child} depth={depth + 1} index={childIndex} parentId={element.id} siblingIds={element.children.map((item) => item.id)} selectedId={selectedId} select={select} mutate={mutate} />)}</div>;
}

function Inspector(props: { element: ElementNode; mutate: (intent: EditIntent) => Promise<DocumentModel | undefined> }) {
  const { element, mutate } = props;
  const style = (property: string, value: string) => void mutate({ type: "set_style", id: element.id, property, value });
  const attr = (name: string, value: string) => void mutate({ type: "set_attribute", id: element.id, name, value });
  const showText = !["image", "input", "divider", "spacer"].includes(element.kind);
  return <div class="inspector-content">
    <div class="inspector-section">
      <h3>Content</h3>
      <label class="field-label">Layer name<input value={element.name} onInput={(event) => void mutate({ type: "rename_element", id: element.id, name: event.currentTarget.value })} /></label>
      {showText && <label class="field-label">Text<textarea rows={element.kind === "heading" ? 2 : 4} value={element.content} onInput={(event) => void mutate({ type: "update_content", id: element.id, content: event.currentTarget.value })} /></label>}
      {element.kind === "image" && <><label class="field-label">Image URL<input value={element.attributes.src ?? ""} placeholder="https://…" onInput={(event) => attr("src", event.currentTarget.value)} /></label><label class="field-label">Alternative text<input value={element.attributes.alt ?? ""} onInput={(event) => attr("alt", event.currentTarget.value)} /></label></>}
      {(element.kind === "link" || element.kind === "button") && <label class="field-label">Link URL<input value={element.attributes.href ?? ""} placeholder="https://example.com" onInput={(event) => attr("href", event.currentTarget.value)} /></label>}
      {element.kind === "input" && <><label class="field-label">Placeholder<input value={element.attributes.placeholder ?? ""} onInput={(event) => attr("placeholder", event.currentTarget.value)} /></label><label class="field-label">Input type<select value={element.attributes.type ?? "text"} onChange={(event) => attr("type", event.currentTarget.value)}><option>text</option><option>email</option><option>number</option><option>password</option></select></label></>}
    </div>
    <div class="inspector-section">
      <h3>Appearance</h3>
      <div class="two-fields">
        <label class="field-label">Text color<span class="color-field"><input type="color" value={colorValue(element.styles.color, "#18212f")} onInput={(event) => style("color", event.currentTarget.value)} /><input value={element.styles.color ?? ""} placeholder="#18212f" onInput={(event) => style("color", event.currentTarget.value)} /></span></label>
        <label class="field-label">Background<span class="color-field"><input type="color" value={colorValue(element.styles.backgroundColor, "#ffffff")} onInput={(event) => style("backgroundColor", event.currentTarget.value)} /><input value={element.styles.backgroundColor ?? ""} placeholder="None" onInput={(event) => style("backgroundColor", event.currentTarget.value)} /></span></label>
      </div>
      <label class="field-label">Font<input value={element.styles.fontFamily ?? ""} placeholder="System UI" onInput={(event) => style("fontFamily", event.currentTarget.value)} /></label>
      <div class="two-fields">
        <label class="field-label">Font size<input value={element.styles.fontSize ?? ""} placeholder="16px" onInput={(event) => style("fontSize", event.currentTarget.value)} /></label>
        <label class="field-label">Weight<select value={element.styles.fontWeight ?? "400"} onChange={(event) => style("fontWeight", event.currentTarget.value)}><option value="400">Regular</option><option value="500">Medium</option><option value="600">Semibold</option><option value="700">Bold</option></select></label>
      </div>
      <div class="two-fields">
        <label class="field-label">Width<input value={element.styles.width ?? ""} placeholder="Auto" onInput={(event) => style("width", event.currentTarget.value)} /></label>
        <label class="field-label">Height<input value={element.styles.height ?? ""} placeholder="Auto" onInput={(event) => style("height", event.currentTarget.value)} /></label>
      </div>
      <label class="field-label">Padding<input value={element.styles.padding ?? ""} placeholder="16px" onInput={(event) => style("padding", event.currentTarget.value)} /></label>
      <label class="field-label">Margin<input value={element.styles.margin ?? ""} placeholder="0px" onInput={(event) => style("margin", event.currentTarget.value)} /></label>
      <div class="two-fields">
        <label class="field-label">Border<input value={element.styles.border ?? ""} placeholder="1px solid #ddd" onInput={(event) => style("border", event.currentTarget.value)} /></label>
        <label class="field-label">Radius<input value={element.styles.borderRadius ?? ""} placeholder="0px" onInput={(event) => style("borderRadius", event.currentTarget.value)} /></label>
      </div>
      <label class="field-label">Text alignment<select value={element.styles.textAlign ?? "left"} onChange={(event) => style("textAlign", event.currentTarget.value)}><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></label>
    </div>
    <div class="inspector-section">
      <h3>Layout</h3>
      <label class="field-label">Display<select value={element.styles.display ?? "block"} onChange={(event) => style("display", event.currentTarget.value)}><option value="block">Block</option><option value="flex">Flex</option><option value="grid">Grid</option><option value="inline-flex">Inline flex</option></select></label>
      <div class="two-fields">
        <label class="field-label">Direction<select value={element.styles.flexDirection ?? "row"} onChange={(event) => style("flexDirection", event.currentTarget.value)}><option value="row">Row</option><option value="column">Column</option></select></label>
        <label class="field-label">Gap<input value={element.styles.gap ?? ""} placeholder="12px" onInput={(event) => style("gap", event.currentTarget.value)} /></label>
      </div>
      <label class="field-label">Grid columns<input value={element.styles.gridTemplateColumns ?? ""} placeholder="repeat(2, 1fr)" onInput={(event) => style("gridTemplateColumns", event.currentTarget.value)} /></label>
      <div class="two-fields">
        <label class="field-label">Justify<select value={element.styles.justifyContent ?? "flex-start"} onChange={(event) => style("justifyContent", event.currentTarget.value)}><option value="flex-start">Start</option><option value="center">Center</option><option value="space-between">Space between</option><option value="space-around">Space around</option><option value="flex-end">End</option></select></label>
        <label class="field-label">Align<select value={element.styles.alignItems ?? "stretch"} onChange={(event) => style("alignItems", event.currentTarget.value)}><option value="stretch">Stretch</option><option value="center">Center</option><option value="flex-start">Start</option><option value="flex-end">End</option></select></label>
      </div>
    </div>
    <button class="inspector-link" onClick={() => void mutate({ type: "set_hidden", id: element.id, hidden: !element.hidden })}>{element.hidden ? "Show on page" : "Hide on page"}<span>{element.hidden ? "◉" : "◌"}</span></button>
  </div>;
}

function colorValue(value: string | undefined, fallback: string): string {
  return value && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

function BehaviorEditor(props: { element: ElementNode; elements: ElementNode[]; mutate: (intent: EditIntent) => Promise<DocumentModel | undefined> }) {
  const { element, elements, mutate } = props;
  function update(index: number, changes: Partial<Behavior>) {
    const behaviors = [...element.behaviors]; behaviors[index] = { ...behaviors[index], ...changes };
    void mutate({ type: "set_behaviors", id: element.id, behaviors });
  }
  const add = () => void mutate({ type: "set_behaviors", id: element.id, behaviors: [...element.behaviors, { trigger: "on_click", action: "open_url", target: "", value: "https://" }] });
  return <div class="behavior-editor"><div class="behavior-selected"><span>{element.kind}</span><strong>{element.name}</strong></div>{element.behaviors.map((behavior, index) => <div class="behavior-card" key={`${element.id}-${index}`}><div class="behavior-card-title"><span>WHEN</span><button title="Remove behavior" onClick={() => void mutate({ type: "set_behaviors", id: element.id, behaviors: element.behaviors.filter((_, i) => i !== index) })}>×</button></div><select value={behavior.trigger} onChange={(event) => update(index, { trigger: event.currentTarget.value as Behavior["trigger"] })}><option value="on_click">On click</option><option value="on_submit">On form submit</option><option value="on_scroll">On scroll</option></select><div class="behavior-card-title"><span>THEN</span></div><select value={behavior.action} onChange={(event) => update(index, { action: event.currentTarget.value as Behavior["action"] })}><option value="open_url">Open a URL</option><option value="scroll_to">Scroll to element</option><option value="toggle">Show / hide element</option><option value="open_modal">Open modal</option><option value="close_modal">Close modal</option><option value="validate_form">Validate required fields</option><option value="success_message">Show success message</option><option value="fade_in">Fade in</option></select>{["scroll_to", "toggle", "open_modal", "close_modal"].includes(behavior.action) && <label class="field-label compact-label">Target element<select value={behavior.target} onChange={(event) => update(index, { target: event.currentTarget.value })}><option value="">Choose a layer</option>{elements.filter((item) => item.id !== element.id).map((item) => <option value={item.id}>{item.name} · {item.kind}</option>)}</select></label>}{["open_url", "success_message"].includes(behavior.action) && <label class="field-label compact-label">{behavior.action === "open_url" ? "Destination URL" : "Message"}<input value={behavior.value} placeholder={behavior.action === "open_url" ? "https://example.com" : "Thanks for reaching out!"} onInput={(event) => update(index, { value: event.currentTarget.value })} /></label>}</div>)}<button class="add-behavior" onClick={add}>＋ Add behavior</button><p class="panel-note">Behaviors are previewed on the canvas and compiled to plain JavaScript at export.</p></div>;
}

export default App;
