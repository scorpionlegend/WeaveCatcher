import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { h } from "preact";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import type { Behavior, DocumentModel, EditIntent, ElementNode, ExportBundle } from "./types";
import { applyTheme } from "./theme";
import { writeAppSetting } from "./appsettings";

type CodeTab = "html" | "css" | "js";
type ViewMode = "canvas" | "split" | "code";
type FileEntry = { name: string; path: string; isDir: boolean; size: number; children: FileEntry[] };
type OpenFile = { path: string; name: string };
const EDITABLE_EXTENSIONS = ["html", "htm", "css", "scss", "js", "mjs", "ts", "json", "txt", "md", "svg", "xml", "csv", "wc"];
type PanelId = "add" | "pages" | "layers" | "behaviors" | "theme" | "files" | "properties";
type DockZone = "left" | "right" | "bottom";
type FloatWindow = { id: PanelId; x: number; y: number; w: number; h: number };
type DockGroup = { id: string; tabs: PanelId[]; active: PanelId | null };
type DropHint = { zone: DockZone; kind: "tab" | "stack" | "append"; groupId?: string; index?: number; before?: boolean };
type DockState = {
  left: DockGroup[]; right: DockGroup[]; bottom: DockGroup[]; floating: FloatWindow[];
  flex: Record<string, number>; collapsed: string[]; closed: PanelId[];
  leftWidth: number; rightWidth: number; bottomHeight: number;
};
const DOCK_PANELS: Record<PanelId, { title: string; icon: string }> = {
  add: { title: "Add", icon: "+" }, pages: { title: "Pages", icon: "▤" }, layers: { title: "Layers", icon: "☷" },
  behaviors: { title: "Behaviors", icon: "⌁" }, theme: { title: "Theme", icon: "◒" },
  files: { title: "Files", icon: "◫" }, properties: { title: "Properties", icon: "⌗" },
};
const ALL_PANELS = Object.keys(DOCK_PANELS) as PanelId[];

let groupCounter = 0;
function newGroup(panel: PanelId): DockGroup {
  groupCounter += 1;
  return { id: `g${Date.now().toString(36)}${groupCounter.toString(36)}`, tabs: [panel], active: panel };
}

function defaultDock(): DockState {
  return { left: (["add", "pages", "layers", "behaviors", "theme"] as PanelId[]).map(newGroup), right: (["files", "properties"] as PanelId[]).map(newGroup), bottom: [], floating: [], flex: {}, collapsed: [], closed: [], leftWidth: 302, rightWidth: 292, bottomHeight: 220 };
}

function normalizeGroups(groups: unknown, seen: Set<string>): DockGroup[] {
  const out: DockGroup[] = [];
  for (const raw of Array.isArray(groups) ? groups : []) {
    const rawTabs: unknown[] = typeof raw === "string" ? [raw] : Array.isArray(raw?.tabs) ? raw.tabs : [];
    const tabs = rawTabs.filter((tab): tab is PanelId => typeof tab === "string" && !!DOCK_PANELS[tab as PanelId] && !seen.has(tab) && !!seen.add(tab));
    if (!tabs.length) continue;
    out.push({ id: raw && typeof raw === "object" && typeof raw.id === "string" ? raw.id : `g${Math.random().toString(36).slice(2)}`, tabs, active: tabs.includes(raw?.active as PanelId) ? (raw.active as PanelId) : tabs[0] });
  }
  return out;
}

function loadDock(): DockState {
  try {
    const dock = { ...defaultDock(), ...JSON.parse(localStorage.getItem("visionweave-dock") ?? "") } as DockState;
    const seen = new Set<string>();
    dock.left = normalizeGroups(dock.left, seen);
    dock.right = normalizeGroups(dock.right, seen);
    dock.bottom = normalizeGroups(dock.bottom, seen);
    dock.floating = (Array.isArray(dock.floating) ? dock.floating : []).filter((item) => item && !!DOCK_PANELS[item.id as PanelId] && !seen.has(item.id) && !!seen.add(item.id));
    const closedSeen = new Set<string>();
    dock.closed = (Array.isArray(dock.closed) ? dock.closed : []).filter((item) => typeof item === "string" && !!DOCK_PANELS[item as PanelId] && !seen.has(item) && !closedSeen.has(item) && !!closedSeen.add(item)) as PanelId[];
    for (const id of ALL_PANELS) if (!seen.has(id) && !closedSeen.has(id)) dock.right.push(newGroup(id));
    dock.flex = dock.flex && typeof dock.flex === "object" ? dock.flex : {};
    dock.collapsed = Array.isArray(dock.collapsed) ? dock.collapsed.filter((item) => typeof item === "string") : [];
    return dock;
  } catch { return defaultDock(); }
}

function findPanel(dock: DockState, id: PanelId): { zone: DockZone; groupId: string; index: number } | null {
  for (const zone of ["left", "right", "bottom"] as const) {
    for (const group of dock[zone]) {
      const index = group.tabs.indexOf(id);
      if (index !== -1) return { zone, groupId: group.id, index };
    }
  }
  return null;
}

function stripPanel(groups: DockGroup[], id: PanelId): DockGroup[] {
  return groups
    .map((group) => ({ ...group, tabs: group.tabs.filter((tab) => tab !== id) }))
    .filter((group) => group.tabs.length > 0)
    .map((group) => ({ ...group, active: group.active && group.tabs.includes(group.active) ? group.active : group.tabs[0] }));
}

const PALETTE_GROUPS: { label: string; items: readonly (readonly [string, string, string])[] }[] = [
  { label: "LAYOUT", items: [["section", "Section", "▱"], ["container", "Container", "▧"], ["grid", "Grid", "▦"], ["spacer", "Spacer", "↕"], ["divider", "Divider", "―"]] },
  { label: "MEDIA", items: [["image", "Image", "▧"], ["rollover", "Rollover image", "⇄"], ["gallery", "Gallery", "⊞"], ["video", "Video", "▶"], ["audio", "Audio", "♪"]] },
  { label: "LISTS", items: [["ul", "Unordered list", "•"], ["ol", "Ordered list", "1."]] },
  { label: "HTML", items: [["heading", "Heading", "T"], ["paragraph", "Paragraph", "¶"], ["iframe", "iframe", "◫"], ["link", "Link", "↗"]] },
  { label: "NAVIGATION", items: [["navbar", "Navbar", "☰"], ["footer", "Footer", "▂"]] },
  { label: "FORMS", items: [["form", "Form", "▤"], ["input", "Input", "▭"], ["checkbox", "Checkbox", "☑"], ["radio", "Radio button", "◉"]] },
  { label: "INTERACTIVE", items: [["button", "Button", "▰"], ["modal", "Modal", "▣"]] },
  { label: "WIDGETS", items: [["calendar", "Event calendar", "▦"], ["textbox", "Text box", "▭"], ["richtext", "Rich text", "B"], ["dropdown", "Dropdown", "▾"], ["datetime", "Date & time", "◷"], ["table", "Table", "⚏"], ["strip", "Strip", "▬"]] },
];
const ELEMENT_INFO = PALETTE_GROUPS.flatMap((group) => group.items);
const VIEW_MODES: readonly ViewMode[] = ["canvas", "split", "code"];
const RESIZABLE_KINDS = ["image", "rollover", "video", "section", "container", "grid"];
const HEIGHT_ONLY_KINDS = ["section", "container", "grid"];

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
    section: "section", container: "div", heading: "h2", paragraph: "p", image: "img", rollover: "img", gallery: "div", iframe: "iframe",
    video: "video", audio: "audio",
    button: "a", link: "a", list: "ul", ul: "ul", ol: "ol", list_item: "li", form: "form", input: "input", checkbox: "label", radio: "label",
    divider: "hr", spacer: "div", modal: "div", navbar: "nav", footer: "footer", grid: "div",
  };
  return tags[kind] ?? "div";
}

function isRemoteMedia(value: string) { return value === "" || /^(https?:|data:|blob:|asset:)/i.test(value); }

const CALENDAR_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const CALENDAR_DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type CalendarEventEntry = { date: string; title: string };

function parseCalendarEvents(raw: string | undefined): CalendarEventEntry[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item: unknown) => {
      const record = (item ?? {}) as { date?: unknown; title?: unknown };
      return { date: typeof record.date === "string" ? record.date : "", title: typeof record.title === "string" ? record.title : "" };
    }).filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item.date));
  } catch { return []; }
}

function calendarIsoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/// The visible month for the shared year/month: leading blanks plus one entry per day.
function calendarDays(mondayStart: boolean): { key: string; day: number | null; today: boolean; iso: string }[] {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1).getDay();
  const pad = mondayStart ? (first + 6) % 7 : first;
  const total = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const days: { key: string; day: number | null; today: boolean; iso: string }[] = [];
  for (let i = 0; i < pad; i++) days.push({ key: `pad-${i}`, day: null, today: false, iso: "" });
  for (let day = 1; day <= total; day++) {
    const iso = calendarIsoDate(new Date(now.getFullYear(), now.getMonth(), day));
    days.push({ key: String(day), day, today: day === now.getDate(), iso });
  }
  return days;
}

/// The table's cell texts resized to exactly rows×cols (same contract as the Rust side).
function parseTableCells(raw: string | undefined, rows: number, cols: number): string[][] {
  let stored: string[][] = [];
  try {
    const parsed: unknown = JSON.parse(raw ?? "[]");
    if (Array.isArray(parsed)) stored = parsed.map((row: unknown) => Array.isArray(row) ? row.map((value: unknown) => String(value ?? "")) : []);
  } catch { /* broken attribute → empty grid */ }
  return Array.from({ length: rows }, (_, row) => Array.from({ length: cols }, (_, col) => stored[row]?.[col] ?? ""));
}

function tableSize(element: ElementNode): { rows: number; cols: number } {
  const clamp = (value: number, min: number, max: number) => Number.isFinite(value) ? Math.min(max, Math.max(min, Math.trunc(value))) : min;
  return {
    rows: clamp(parseInt(element.attributes.rows ?? "3", 10), 1, 30),
    cols: clamp(parseInt(element.attributes.cols ?? "3", 10), 1, 10),
  };
}

/// Offline strip backgrounds (CSS gradients — no download needed), plus the GitHub
/// gallery is fetched on top of these in the strip picker.
const STRIP_PRESETS: { name: string; value: string }[] = [
  { name: "Midnight", value: "linear-gradient(120deg, #101425, #2b2f45)" },
  { name: "Paper", value: "linear-gradient(120deg, #f4f6f8, #e8ebf1)" },
  { name: "Sunset", value: "linear-gradient(120deg, #ff9966, #ff5e62)" },
  { name: "Ocean", value: "linear-gradient(120deg, #2193b0, #6dd5ed)" },
  { name: "Meadow", value: "linear-gradient(120deg, #8bb57e, #3e8e5a)" },
];

// The strip gallery lives in a GitHub repository: manifest.json lists the image
// filenames and the picker loads them from raw.githubusercontent.com.
const STRIP_REPO_URL = "https://raw.githubusercontent.com/scorpionlegend/WeaveCatcher-Strips/main/";

function mediaDisplayUrl(value: string | undefined): string | undefined {
  if (!value || isRemoteMedia(value)) return value;
  try { return convertFileSrc(value); } catch { return value; }
}

function findLocation(elements: ElementNode[], id: string, parentId: string | null = null): { parentId: string | null; index: number; count: number } | undefined {
  for (let index = 0; index < elements.length; index++) {
    if (elements[index].id === id) return { parentId, index, count: elements.length };
    const nested = findLocation(elements[index].children, id, elements[index].id);
    if (nested) return nested;
  }
  return undefined;
}

function App() {
  const [documentModel, setDocumentModel] = useState<DocumentModel | null>(null);
  const [dirty, setDirty] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dock, setDock] = useState<DockState>(loadDock);
  const dockRef = useRef(dock);
  dockRef.current = dock;
  const [dragPanel, setDragPanel] = useState<PanelId | null>(null);
  const [dropHint, setDropHint] = useState<DropHint | null>(null);
  const [tabMenu, setTabMenu] = useState<{ x: number; y: number; kind: "tab" | "group"; zone: DockZone; groupId: string; panelId?: PanelId } | null>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const dragPanelRef = useRef<PanelId | null>(null);
  const dropHintRef = useRef<DropHint | null>(null);
  dropHintRef.current = dropHint;
  const [viewMode, setViewMode] = useState<ViewMode>("canvas");
  const [liveView, setLiveView] = useState(false);
  const [codeTab, setCodeTab] = useState<CodeTab>("html");
  const [savedCode, setSavedCode] = useState<ExportBundle>({ html: "", css: "", js: "" });
  const [draftCode, setDraftCode] = useState<ExportBundle>({ html: "", css: "", js: "" });
  const draftDirtyRef = useRef(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [draggingKind, setDraggingKind] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [lastExportDir, setLastExportDir] = useState<string | null>(null);
  const [contextPoint, setContextPoint] = useState<{ x: number; y: number } | null>(null);
  const [resizeFrame, setResizeFrame] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [modalPreview, setModalPreview] = useState<string | null>(null);
  const [splitSettings, setSplitSettings] = useState<{ orientation: "side" | "stacked"; codeFirst: boolean }>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("visionweave-split") ?? "");
      if (stored?.orientation === "side" || stored?.orientation === "stacked") return { orientation: stored.orientation, codeFirst: stored.codeFirst === true };
    } catch { /* first launch */ }
    return { orientation: "side", codeFirst: false };
  });
  const [fileTree, setFileTree] = useState<FileEntry[] | null>(null);
  const [workspacePath, setWorkspacePath] = useState("");
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [openFile, setOpenFile] = useState<OpenFile | null>(null);
  const [fileSaved, setFileSaved] = useState("");
  const [fileDraft, setFileDraft] = useState("");
  const [quickLocations, setQuickLocations] = useState<{ name: string; path: string }[]>([]);
  const [savedRoots, setSavedRoots] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("visionweave-roots") ?? "[]") as string[]; } catch { return []; }
  });
  const stageRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);

  useEffect(() => { const snapshot = JSON.stringify(dock); localStorage.setItem("visionweave-dock", snapshot); writeAppSetting("visionweave-dock", JSON.parse(snapshot)); }, [dock]);

  useEffect(() => {
    if (!openMenu) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target || target.closest(".menu-pop")) { setOpenMenu(null); return; }
      if (target.closest("summary")) return;
      setOpenMenu(null);
    };
    window.addEventListener("click", closeOnOutsideClick);
    return () => window.removeEventListener("click", closeOnOutsideClick);
  }, [openMenu]);

  const page = useMemo(() => documentModel?.pages.find((item) => item.id === documentModel.activePageId), [documentModel]);
  const selected = useMemo(() => page && findElement(page.elements, selectedId), [page, selectedId]);
  const selectedLocation = useMemo(() => (page && selectedId ? findLocation(page.elements, selectedId) : undefined), [page, selectedId]);
  const [paletteSearch, setPaletteSearch] = useState("");
  const liveDocument = useMemo(() => savedCode.html
    .replace('<link rel="stylesheet" href="styles.css">', `<style>${savedCode.css}</style>`)
    .replace('<script src="script.js" defer></script>', `<script>${savedCode.js}<\/script>`), [savedCode]);

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
    const refetch = () => { applyTheme(); invoke<DocumentModel>("get_document").then((doc) => setDocumentModel(doc)).catch(() => { /* keep current view */ }); };
    window.addEventListener("focus", refetch);
    return () => window.removeEventListener("focus", refetch);
  }, []);

  useEffect(() => {
    invoke<{ name: string; path: string }[]>("list_quick_locations").then((locations) => setQuickLocations(locations)).catch(() => { /* picker just stays minimal */ });
    const lastRoot = localStorage.getItem("visionweave-lastroot");
    if (lastRoot) void loadTreeAt(lastRoot);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const resizable = selected && RESIZABLE_KINDS.includes(selected.kind);
    if (!resizable || !selected) { setResizeFrame(null); return; }
    const update = () => {
      const stage = stageRef.current;
      const node = stage?.querySelector(`[data-node-id="${selected.id}"]`);
      const page = stage?.querySelector(".canvas-page");
      if (!(node instanceof HTMLElement) || !(page instanceof HTMLElement)) { setResizeFrame(null); return; }
      const box = node.getBoundingClientRect();
      const frame = page.getBoundingClientRect();
      setResizeFrame({ left: box.left - frame.left, top: box.top - frame.top, width: box.width, height: box.height });
    };
    update();
    const node = stageRef.current?.querySelector(`[data-node-id="${selected.id}"]`);
    const observer = new ResizeObserver(update);
    if (node instanceof HTMLElement) observer.observe(node);
    return () => observer.disconnect();
  }, [selected, documentModel, viewMode, liveView]);

  useEffect(() => {
    if (viewMode === "canvas" && !liveView) return;
    invoke<ExportBundle>("get_export_preview").then((bundle) => {
      setSavedCode(bundle);
      if (!draftDirtyRef.current) setDraftCode(bundle);
    }).catch(showError);
  }, [documentModel, viewMode, liveView]);

  useEffect(() => {
    const onKeyDown = async (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editing = target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (openFile) await saveOpenFile();
        else await saveProject();
        return;
      }
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
      } else if ((event.key === "Delete" || event.key === "Backspace") && selectedId && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        await mutate({ type: "delete_element", id: selectedId });
        setSelectedId(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedId, documentModel, openFile, fileDraft, workspacePath]);

  function showError(cause: unknown) {
    const message = cause instanceof Error ? cause.message : String(cause);
    setError(message);
    window.setTimeout(() => setError(""), 5000);
  }

  async function openSettingsWindow() {
    try {
      await invoke("open_settings_window");
    } catch (cause) {
      showError(cause);
    }
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

  function rememberRoot(path: string) {
    localStorage.setItem("visionweave-lastroot", path);
    writeAppSetting("visionweave-lastroot", path);
    setSavedRoots((previous) => {
      const next = [path, ...previous.filter((item) => item !== path)].slice(0, 8);
      localStorage.setItem("visionweave-roots", JSON.stringify(next));
      writeAppSetting("visionweave-roots", next);
      return next;
    });
  }

  async function loadTreeAt(path: string) {
    try {
      setFileTree(await invoke<FileEntry[]>("open_project_folder", { path }));
      setWorkspacePath(path);
      setSelectedFile(null);
      setOpenFile(null);
      rememberRoot(path);
    } catch (cause) { showError(cause); }
  }

  async function chooseRoot(value: string) {
    if (!value) return;
    if (value === "__browse__") { await openProjectFolder(); return; }
    await loadTreeAt(value);
  }

  async function openProjectFolder() {
    const picked = await open({ directory: true, multiple: false, title: "Choose a project folder" });
    if (typeof picked !== "string") return;
    await loadTreeAt(picked);
    setToast("Folder opened in the Files panel");
  }

  async function refreshFileTree() {
    if (!workspacePath) return;
    try { setFileTree(await invoke<FileEntry[]>("open_project_folder", { path: workspacePath })); }
    catch (cause) { showError(cause); }
  }

  async function selectFile(entry: FileEntry) {
    setSelectedFile(entry.path);
    const extension = entry.name.slice(entry.name.lastIndexOf(".") + 1).toLowerCase();
    if (!EDITABLE_EXTENSIONS.includes(extension)) return;
    if (openFile?.path === entry.path) return;
    try {
      const content = await invoke<string>("read_workspace_file", { root: workspacePath, relative: entry.path });
      setOpenFile({ path: entry.path, name: entry.name });
      setFileSaved(content);
      setFileDraft(content);
      if (viewMode === "canvas") setViewMode("split");
    } catch (cause) { showError(cause); }
  }

  async function saveOpenFile() {
    if (!openFile) return;
    try {
      await invoke("write_workspace_file", { root: workspacePath, relative: openFile.path, content: fileDraft });
      setFileSaved(fileDraft);
      setToast("File saved");
      void refreshFileTree();
    } catch (cause) { showError(cause); }
  }

  function openFileInSystem(entry: FileEntry) {
    if (!workspacePath) return;
    const separator = workspacePath.includes("\\") ? "\\" : "/";
    const root = workspacePath.replace(/[\\/]$/, "");
    void invoke("open_in_system", { path: `${root}${separator}${entry.path.replaceAll("/", separator)}` }).catch(showError);
  }

  function patchDock(changes: Partial<DockState>) { setDock((previous) => ({ ...previous, ...changes })); }

  function dockPanel(id: PanelId, zone: DockZone, hint?: DropHint) {
    setDock((d) => {
      const from = findPanel(d, id);
      const stripped: DockState = { ...d, left: stripPanel(d.left, id), right: stripPanel(d.right, id), bottom: stripPanel(d.bottom, id), floating: d.floating.filter((item) => item.id !== id), closed: d.closed.filter((item) => item !== id) };
      const groups = [...stripped[zone]];
      const apply = (next: DockGroup[]) => ({ ...stripped, [zone]: next });
      if (hint?.kind === "tab" && hint.groupId) {
        const groupIndex = groups.findIndex((group) => group.id === hint.groupId);
        if (groupIndex === -1) return apply([...groups, newGroup(id)]);
        const group = groups[groupIndex];
        let target = Math.max(0, Math.min(hint.index ?? group.tabs.length, group.tabs.length));
        if (from && from.zone === zone && from.groupId === hint.groupId && from.index < target) target -= 1;
        const tabs = [...group.tabs];
        tabs.splice(target, 0, id);
        const next = [...groups];
        next[groupIndex] = { ...group, tabs, active: id };
        return apply(next);
      }
      if (hint?.kind === "stack" && hint.groupId) {
        const groupIndex = groups.findIndex((group) => group.id === hint.groupId);
        if (groupIndex === -1) return apply([...groups, newGroup(id)]);
        const next = [...groups];
        next.splice(hint.before ? groupIndex : groupIndex + 1, 0, newGroup(id));
        return apply(next);
      }
      return apply([...groups, newGroup(id)]);
    });
  }

  function floatPanelAt(id: PanelId, x: number, y: number) {
    setDock((d) => ({ ...d, left: stripPanel(d.left, id), right: stripPanel(d.right, id), bottom: stripPanel(d.bottom, id), floating: [...d.floating.filter((item) => item.id !== id), { id, x, y, w: 320, h: 400 }], closed: d.closed.filter((item) => item !== id) }));
  }

  function revealPanel(id: PanelId) {
    setDock((d) => {
      const next = { ...d, collapsed: [...d.collapsed] };
      for (const zone of ["left", "right", "bottom"] as const) {
        for (const group of d[zone]) {
          if (group.tabs.includes(id)) {
            next.collapsed = next.collapsed.filter((item) => item !== group.id);
            next[zone] = next[zone].map((item) => (item.id === group.id ? { ...item, active: id } : item));
            return next;
          }
        }
      }
      return next;
    });
  }

  function toggleGroupCollapse(groupId: string) { setDock((d) => ({ ...d, collapsed: d.collapsed.includes(groupId) ? d.collapsed.filter((item) => item !== groupId) : [...d.collapsed, groupId] })); }

  function activateTab(zone: DockZone, groupId: string, id: PanelId) {
    setDock((d) => ({ ...d, [zone]: d[zone].map((group) => (group.id === groupId ? { ...group, active: id } : group)) }));
  }

  function closePanel(id: PanelId) {
    setDock((d) => ({ ...d, left: stripPanel(d.left, id), right: stripPanel(d.right, id), bottom: stripPanel(d.bottom, id), floating: d.floating.filter((item) => item.id !== id), closed: d.closed.includes(id) ? d.closed : [...d.closed, id] }));
  }

  function closeGroup(zone: DockZone, groupId: string) {
    setDock((d) => {
      const group = d[zone].find((item) => item.id === groupId);
      if (!group) return d;
      const closed = [...d.closed];
      for (const tab of group.tabs) if (!closed.includes(tab)) closed.push(tab);
      return { ...d, [zone]: d[zone].filter((item) => item.id !== groupId), closed };
    });
  }

  function isPanelOpen(id: PanelId) { return !!findPanel(dock, id); }

  function togglePanelOpen(id: PanelId) {
    if (isPanelOpen(id)) {
      closePanel(id);
      setToast(`${DOCK_PANELS[id].title} panel closed — reopen it from the View menu`);
    } else {
      setDock((d) => ({ ...d, closed: d.closed.filter((item) => item !== id), right: [...stripPanel(d.right, id), newGroup(id)] }));
      setToast(`${DOCK_PANELS[id].title} panel opened`);
    }
  }

  function onPanelDragStart(event: DragEvent, id: PanelId) {
    event.dataTransfer?.setData("application/x-vw-panel", id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    dragPanelRef.current = id;
    setDragPanel(id);
  }

  function onPanelDragEnd() { dragPanelRef.current = null; setDragPanel(null); setDropHint(null); }

  function zoneDragOver(event: DragEvent, zone: DockZone) {
    if (!dragPanelRef.current) return;
    event.preventDefault(); event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    const hint: DropHint = { zone, kind: "append" };
    dropHintRef.current = hint;
    setDropHint(hint);
  }

  function groupDragOver(event: DragEvent, zone: DockZone, groupId: string) {
    if (!dragPanelRef.current) return;
    event.preventDefault(); event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const hint: DropHint = { zone, kind: "stack", groupId, before: event.clientY < rect.top + rect.height / 2 };
    dropHintRef.current = hint;
    setDropHint(hint);
  }

  function tabDragOver(event: DragEvent, zone: DockZone, groupId: string, index: number) {
    if (!dragPanelRef.current) return;
    event.preventDefault(); event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const hint: DropHint = { zone, kind: "tab", groupId, index: event.clientX < rect.left + rect.width / 2 ? index : index + 1 };
    dropHintRef.current = hint;
    setDropHint(hint);
  }

  function zoneDrop(event: DragEvent, zone: DockZone) {
    const id = dragPanelRef.current;
    if (!id) return;
    event.preventDefault(); event.stopPropagation();
    dockPanel(id, zone, dropHintRef.current?.zone === zone ? dropHintRef.current : undefined);
    onPanelDragEnd();
  }

  function workspaceDragOver(event: DragEvent) {
    if (!dragPanelRef.current) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  }

  function workspaceDrop(event: DragEvent) {
    const id = dragPanelRef.current;
    if (!id) return;
    event.preventDefault();
    const rect = workspaceRef.current?.getBoundingClientRect();
    if (rect) {
      const x = Math.max(4, Math.min(event.clientX - rect.left, rect.width - 328));
      const y = Math.max(4, Math.min(event.clientY - rect.top, rect.height - 80));
      floatPanelAt(id, Math.round(x), Math.round(y));
    }
    onPanelDragEnd();
  }

  function startZoneWidthResize(event: PointerEvent, zone: "left" | "right") {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = zone === "left" ? dockRef.current.leftWidth : dockRef.current.rightWidth;
    const direction = zone === "left" ? 1 : -1;
    const move = (moveEvent: PointerEvent) => {
      const width = Math.max(200, Math.min(startWidth + direction * (moveEvent.clientX - startX), Math.round(window.innerWidth * 0.55)));
      patchDock(zone === "left" ? { leftWidth: width } : { rightWidth: width });
    };
    const finish = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", finish); document.body.style.userSelect = ""; };
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
  }

  function startBottomResize(event: PointerEvent) {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = dockRef.current.bottomHeight;
    const move = (moveEvent: PointerEvent) => {
      patchDock({ bottomHeight: Math.max(120, Math.min(startHeight - (moveEvent.clientY - startY), Math.round(window.innerHeight * 0.6))) });
    };
    const finish = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", finish); document.body.style.userSelect = ""; };
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
  }

  function startFlexResize(event: PointerEvent, beforeGroupId: string, afterGroupId: string) {
    event.preventDefault();
    const resizer = event.currentTarget as HTMLElement;
    const before = resizer.previousElementSibling as HTMLElement | null;
    const after = resizer.nextElementSibling as HTMLElement | null;
    const total = (before?.getBoundingClientRect().height ?? 0) + (after?.getBoundingClientRect().height ?? 0);
    if (!total) return;
    const startY = event.clientY;
    const startBefore = dockRef.current.flex[beforeGroupId] ?? 1;
    const startAfter = dockRef.current.flex[afterGroupId] ?? 1;
    const flexPerPx = (startBefore + startAfter) / total;
    const move = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientY - startY;
      patchDock({ flex: { ...dockRef.current.flex, [beforeGroupId]: Math.max(0.15, startBefore + delta * flexPerPx), [afterGroupId]: Math.max(0.15, startAfter - delta * flexPerPx) } });
    };
    const finish = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", finish); document.body.style.userSelect = ""; };
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
  }

  function bringFloatToFront(id: PanelId) {
    setDock((d) => {
      const moving = d.floating.find((item) => item.id === id);
      if (!moving || d.floating[d.floating.length - 1]?.id === id) return d;
      return { ...d, floating: [...d.floating.filter((item) => item.id !== id), moving] };
    });
  }

  function startFloatResize(event: PointerEvent, id: PanelId) {
    event.preventDefault(); event.stopPropagation();
    const start = { x: event.clientX, y: event.clientY };
    const current = dockRef.current.floating.find((item) => item.id === id);
    if (!current) return;
    const move = (moveEvent: PointerEvent) => {
      const width = Math.max(230, current.w + moveEvent.clientX - start.x);
      const height = Math.max(150, current.h + moveEvent.clientY - start.y);
      setDock((d) => ({ ...d, floating: d.floating.map((item) => (item.id === id ? { ...item, w: width, h: height } : item)) }));
    };
    const finish = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", finish); document.body.style.userSelect = ""; };
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
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
      await invoke("open_in_system", { path: `${folder.replace(/[\\/]$/, "")}${separator}index.html` });
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
    writeAppSetting("visionweave-layout", layout);
    void mutate({ type: "set_layout", layout });
  }

  function updateSplit(changes: Partial<{ orientation: "side" | "stacked"; codeFirst: boolean }>) {
    setSplitSettings((previous) => {
      const next = { ...previous, ...changes };
      localStorage.setItem("visionweave-split", JSON.stringify(next));
      writeAppSetting("visionweave-split", next);
      return next;
    });
  }

  function customCodeFor(tab: CodeTab): string {
    if (!documentModel) return "";
    if (tab === "html") return page?.customHtml ?? "";
    return tab === "css" ? documentModel.customCss : documentModel.customJs;
  }

  function editCode(tab: CodeTab, value: string) {
    const next = { ...draftCode, [tab]: value };
    const changed = (["html", "css", "js"] as const).some((key) => next[key] !== savedCode[key]);
    draftDirtyRef.current = changed;
    setDraftCode(next);
  }

  async function applyCode(bundle = draftCode) {
    const next = await mutate({ type: "set_custom_code", html: bundle.html, css: bundle.css, js: bundle.js });
    if (next) {
      draftDirtyRef.current = false;
      setToast("Code saved — exports now use these files");
    }
  }

  async function resetCodeTab() {
    if (customCodeFor(codeTab)) {
      const bundle = { ...draftCode, [codeTab]: "" };
      setDraftCode(bundle);
      await applyCode(bundle);
      setToast("This file is generated from the canvas again");
      return;
    }
    draftDirtyRef.current = false;
    setDraftCode((previous) => ({ ...previous, [codeTab]: savedCode[codeTab] }));
    setToast("Unsaved edits discarded");
  }

  function pickElement(id: string, event: MouseEvent) {
    event.stopPropagation();
    setSelectedId(id);
    const stage = stageRef.current?.getBoundingClientRect();
    const target = (event.currentTarget as HTMLElement).getBoundingClientRect();
    if (stage) setContextPoint({ x: Math.max(12, Math.min(target.left - stage.left, stage.width - 168)), y: Math.max(12, target.top - stage.top - 44) });
  }

  function startCanvasResize(event: PointerEvent, handle: string) {
    event.preventDefault(); event.stopPropagation();
    if (!selected || !resizeFrame) return;
    const heightOnly = HEIGHT_ONLY_KINDS.includes(selected.kind);
    const start = { x: event.clientX, y: event.clientY };
    const startBox = { ...resizeFrame };
    const node = stageRef.current?.querySelector(`[data-node-id="${selected.id}"]`);
    if (!(node instanceof HTMLElement)) return;
    const move = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - start.x;
      const dy = moveEvent.clientY - start.y;
      let width = startBox.width;
      let height = startBox.height;
      if (!heightOnly && handle.includes("e")) width = startBox.width + dx;
      if (!heightOnly && handle.includes("w")) width = startBox.width - dx;
      if (handle.includes("s")) height = startBox.height + dy;
      if (handle.includes("n")) height = startBox.height - dy;
      width = Math.max(24, Math.round(width));
      height = Math.max(24, Math.round(height));
      if (!heightOnly) node.style.width = `${width}px`;
      node.style.height = `${height}px`;
      setResizeFrame({ ...startBox, width: heightOnly ? startBox.width : width, height });
    };
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      document.body.style.userSelect = "";
      const width = node.style.width;
      const height = node.style.height;
      if (!selected) return;
      if (!heightOnly) void mutate({ type: "set_style", id: selected.id, property: "width", value: width });
      void mutate({ type: "set_style", id: selected.id, property: "height", value: height });
      if (!heightOnly && selected.styles.maxWidth) void mutate({ type: "set_style", id: selected.id, property: "maxWidth", value: "" });
    };
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
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

  function panelBody(id: PanelId) {
    if (!documentModel) return null;
    const doc = documentModel;
    if (id === "add") return <div class="panel-content palette-panel">
      <label class="search-box"><span>⌕</span><input placeholder="Find an element" aria-label="Find an element" value={paletteSearch} onInput={(event) => setPaletteSearch(event.currentTarget.value.toLowerCase())} /></label>
      {PALETTE_GROUPS.map((group) => {
        const items = group.items.filter(([, label]) => label.toLowerCase().includes(paletteSearch));
        if (!items.length) return null;
        return <div class="palette-group" key={group.label}>
          <p class="section-label">{group.label}</p>
          <div class="palette-grid">{items.map(([kind, label, icon]) => <button key={kind} class="palette-item" data-label={label.toLowerCase()} draggable onDragStart={(event) => { event.dataTransfer?.setData("application/x-vw-kind", kind); setDraggingKind(kind); }} onDragEnd={() => setDraggingKind(null)} onClick={() => addElement(kind)}><span class="palette-icon">{icon}</span><span>{label}</span><span class="drag-grip">⠿</span></button>)}</div>
        </div>;
      })}
      {!ELEMENT_INFO.some(([, label]) => label.toLowerCase().includes(paletteSearch)) && <div class="empty-panel"><span>⌕</span><strong>No elements found</strong><p>Try a different search term.</p></div>}
      <div class="tip-card"><span>✦</span><div><strong>Build with blocks</strong><p>Drag an element onto the canvas, or click to add it.</p></div></div>
    </div>;
    if (id === "pages") return <div class="panel-content pages-panel"><div class="panel-section-title"><span>YOUR PAGES</span><button class="icon-button small accent" title="Add page" onClick={() => void mutate({ type: "add_page", name: `Page ${doc.pages.length + 1}` })}>＋</button></div>
      <div class="page-list">{doc.pages.map((item, index) => <div key={item.id} class={`page-item ${page?.id === item.id ? "active" : ""}`}><button class="page-main" onClick={() => { void mutate({ type: "set_active_page", id: item.id }); setSelectedId(null); }}><span class="page-icon">{index === 0 ? "⌂" : "▤"}</span><span><strong>{item.name}</strong><small>/{index === 0 ? "" : item.slug}</small></span>{index === 0 && <em>HOME</em>}</button><button class="icon-button small page-menu" title={`Rename ${item.name}`} onClick={() => { const name = window.prompt("Page name", item.name); if (name?.trim()) void mutate({ type: "rename_page", id: item.id, name: name.trim() }); }}>···</button><button class="icon-button small page-delete" title="Delete page" onClick={() => { if (doc.pages.length > 1 && window.confirm(`Delete ${item.name}?`)) void mutate({ type: "delete_page", id: item.id }); }}>×</button></div>)}</div>
      <button class="dashed-button" onClick={() => void mutate({ type: "add_page", name: `Page ${doc.pages.length + 1}` })}>＋ Add page</button>
    </div>;
    if (id === "layers") return <div class="panel-content layers-panel"><div class="panel-section-title"><span>PAGE STRUCTURE</span><span class="tiny-count">{elementCount} items</span></div>{elements.length ? <div class="layer-tree">{elements.map((element, index) => <LayerItem key={element.id} element={element} depth={0} index={index} parentId={null} siblingIds={elements.map((item) => item.id)} selectedId={selectedId} select={setSelectedId} mutate={mutate} />)}</div> : <div class="empty-panel"><span>☷</span><strong>Nothing here yet</strong><p>Add an element to see your page structure.</p></div>}</div>;
    if (id === "behaviors") return <div class="panel-content behavior-panel"><div class="behavior-intro"><span class="behavior-symbol">⌁</span><div><strong>Make it interactive</strong><p>Choose what happens when visitors interact with this element.</p></div></div>{selected ? <BehaviorEditor element={selected} elements={page ? allElements(page.elements) : []} mutate={mutate} /> : <div class="empty-panel"><span>↖</span><strong>Select an element</strong><p>Choose an element on the canvas to add behavior.</p></div>}</div>;
    if (id === "theme") return <div class="panel-content theme-panel"><p class="section-label">QUICK STYLE PRESETS</p><p class="muted-copy">Select an element on your page, then choose a preset.</p>{selected ? <div class="preset-list"><button onClick={() => { void mutate({ type: "set_style", id: selected.id, property: "borderRadius", value: "12px" }); void mutate({ type: "set_style", id: selected.id, property: "boxShadow", value: "0 8px 24px rgba(31, 41, 55, .12)" }); }}>Soft card <span>▢</span></button><button onClick={() => { void mutate({ type: "set_style", id: selected.id, property: "backgroundColor", value: "#f4f6ff" }); void mutate({ type: "set_style", id: selected.id, property: "padding", value: "24px" }); }}>Lavender surface <span>◒</span></button><button onClick={() => { void mutate({ type: "set_style", id: selected.id, property: "color", value: "#ffffff" }); void mutate({ type: "set_style", id: selected.id, property: "backgroundColor", value: "#25324b" }); }}>Midnight <span>●</span></button><button onClick={() => { void mutate({ type: "set_style", id: selected.id, property: "color", value: "#18212f" }); void mutate({ type: "set_style", id: selected.id, property: "backgroundColor", value: "#ffffff" }); }}>Reset colors <span>↺</span></button></div> : <div class="empty-panel"><span>◒</span><strong>Select an element</strong><p>Choose an element to apply a style preset.</p></div>}</div>;
    if (id === "files") return <div class="file-tree">
      <div class="file-tree-picker">
        {(() => {
          const knownPaths = new Set([...quickLocations.map((location) => location.path), ...savedRoots]);
          return <select class="root-picker" aria-label="Root folder" value={workspacePath} onChange={(event) => void chooseRoot(event.currentTarget.value)}>
            {!workspacePath && <option value="">Choose a folder…</option>}
            {workspacePath && !knownPaths.has(workspacePath) && <option value={workspacePath}>{workspacePath.split(/[\\/]/).filter(Boolean).pop()}</option>}
            {quickLocations.map((location) => <option key={location.path} value={location.path}>{location.name}</option>)}
            {savedRoots.filter((path) => !quickLocations.some((location) => location.path === path)).map((path) => <option key={path} value={path}>{path.split(/[\\/]/).filter(Boolean).pop()}</option>)}
            <option value="__browse__">Browse for folder…</option>
          </select>;
        })()}
      </div>
      {workspacePath && <div class="file-tree-columns"><span>Local Files</span><span>Size</span></div>}
      <div class="file-tree-body">
        {fileTree && workspacePath ? <FileNode key={workspacePath} entry={{ name: workspacePath.split(/[\\/]/).filter(Boolean).pop() ?? "Files", path: "\0root", isDir: true, size: 0, children: fileTree }} depth={0} selectedFile={selectedFile} select={selectFile} onOpen={openFileInSystem} /> : <div class="file-tree-hint">Pick a folder above to browse and edit its files.</div>}
      </div>
      <div class="file-tree-foot">
        <button class="icon-button small" title="Refresh file tree" onClick={() => void refreshFileTree()}>↻</button>
        <button class="icon-button small" title="Open folder in Explorer" onClick={() => workspacePath && void invoke("open_in_system", { path: workspacePath })}>⌂</button>
      </div>
    </div>;
    return <div class="panel-content properties-body">
      {selected ? <Inspector element={selected} mutate={mutate} onError={showError} /> : <div class="inspector-empty"><div class="cursor-art">↖</div><strong>Nothing selected</strong><p>Click an element on your canvas to edit its content, style, and behavior.</p><button class="text-action" onClick={() => revealPanel("add")}>Browse elements <span>→</span></button></div>}
    </div>;
  }

  function renderGroup(zone: DockZone, group: DockGroup, index: number) {
    const collapsedNow = dock.collapsed.includes(group.id);
    const hintClass = dropHint?.zone === zone && dropHint.kind === "stack" && dropHint.groupId === group.id ? (dropHint.before ? " hint-before" : " hint-after") : "";
    const nextGroup = dock[zone][index + 1];
    return [
      <section key={group.id} class={`dock-group${collapsedNow ? " collapsed" : ""}${hintClass}`} style={collapsedNow ? undefined : { flexGrow: dock.flex[group.id] ?? 1 }}
        onDragOver={(event) => groupDragOver(event, zone, group.id)} onDrop={(event) => zoneDrop(event, zone)}>
        <div class="dock-tabs" onContextMenu={(event) => { event.preventDefault(); setTabMenu({ x: event.clientX, y: event.clientY, kind: "group", zone, groupId: group.id }); }}>
          <button class="dock-caret" title={collapsedNow ? "Expand section" : "Collapse section"} onClick={() => toggleGroupCollapse(group.id)}>{collapsedNow ? "›" : "⌄"}</button>
          {group.tabs.map((id, tabIndex) => {
            const tabHint = dropHint?.zone === zone && dropHint.kind === "tab" && dropHint.groupId === group.id && dropHint.index === tabIndex ? " tab-hint-before" : dropHint?.zone === zone && dropHint.kind === "tab" && dropHint.groupId === group.id && dropHint.index === tabIndex + 1 ? " tab-hint-after" : "";
            return <button key={id} class={`${group.active === id ? "active" : ""}${tabHint}`} draggable={true} title="Click to show · drag to another zone, tab row, or above/below a section" onDragStart={(event) => onPanelDragStart(event, id)} onDragEnd={onPanelDragEnd} onDragOver={(event) => tabDragOver(event, zone, group.id, tabIndex)} onDrop={(event) => zoneDrop(event, zone)} onClick={() => activateTab(zone, group.id, id)} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); setTabMenu({ x: event.clientX, y: event.clientY, kind: "tab", zone, groupId: group.id, panelId: id }); }}><span>{DOCK_PANELS[id].icon}</span> {DOCK_PANELS[id].title}</button>;
          })}
        </div>
        {!collapsedNow && group.active && <div class="dock-panel-body">{panelBody(group.active)}</div>}
      </section>,
      !collapsedNow && nextGroup && !dock.collapsed.includes(nextGroup.id) ? <div key={`${group.id}-resizer`} class="zone-resizer horizontal" onPointerDown={(event) => startFlexResize(event, group.id, nextGroup.id)} /> : null,
    ];
  }

  function renderZone(zone: "left" | "right") {
    const width = zone === "left" ? dock.leftWidth : dock.rightWidth;
    return <aside class={`dock-zone dock-${zone}${dropHint?.zone === zone ? " zone-hint" : ""}`} style={{ flex: `0 0 ${dock[zone].length ? width : 96}px` }}
      onDragOver={(event) => zoneDragOver(event, zone)} onDrop={(event) => zoneDrop(event, zone)}>
      {dock[zone].length ? dock[zone].map((group, index) => renderGroup(zone, group, index)) : <div class="dock-empty">Drag panels here</div>}
      <div class={`zone-width-resizer ${zone === "left" ? "edge-right" : "edge-left"}`} title="Drag to resize" onPointerDown={(event) => startZoneWidthResize(event, zone)} />
    </aside>;
  }

  if (!documentModel) return <main class="loading-screen"><div class="brand-mark">wc</div><strong>WeaveCatcher</strong><span>{error || "Connecting to the editor…"}</span></main>;

  const elements = page?.elements ?? [];
  const elementCount = page ? allElements(page.elements).length : 0;

return <div class="app-shell">
        <header class="topbar">
          <div class="brand-lockup"><div class="brand-mark">wc</div><span>WeaveCatcher</span><i class="brand-divider" /></div>
          <nav class="menu-row" aria-label="Main menu">
            <details class="menu" open={openMenu === "file" ? true : undefined} onToggle={(event) => { const isOpen = event.currentTarget.open; setOpenMenu((previous) => (isOpen ? "file" : previous === "file" ? null : previous)); }}><summary onMouseEnter={() => { if (openMenu && openMenu !== "file") setOpenMenu("file"); }}>File</summary><div class="menu-pop"><button onClick={newProject}>New project</button><button onClick={openProject}>Open project…</button><button onClick={() => void openProjectFolder()}>Open folder…</button><button onClick={() => void saveProject()}>Save</button><button onClick={() => void saveProject(true)}>Save as…</button><hr /><button onClick={exportToFolder}>Export website…</button></div></details>
            <details class="menu" open={openMenu === "edit" ? true : undefined} onToggle={(event) => { const isOpen = event.currentTarget.open; setOpenMenu((previous) => (isOpen ? "edit" : previous === "edit" ? null : previous)); }}><summary onMouseEnter={() => { if (openMenu && openMenu !== "edit") setOpenMenu("edit"); }}>Edit</summary><div class="menu-pop"><button onClick={() => void travelHistory("undo_document")}>Undo <kbd>⌘Z</kbd></button><button onClick={() => void travelHistory("redo_document")}>Redo <kbd>⇧⌘Z</kbd></button><button onClick={() => selectedId && void mutate({ type: "duplicate_element", id: selectedId })}>Duplicate</button><button onClick={() => void pasteElement()}>Paste</button></div></details>
            <details class="menu" open={openMenu === "insert" ? true : undefined} onToggle={(event) => { const isOpen = event.currentTarget.open; setOpenMenu((previous) => (isOpen ? "insert" : previous === "insert" ? null : previous)); }}><summary onMouseEnter={() => { if (openMenu && openMenu !== "insert") setOpenMenu("insert"); }}>Insert</summary><div class="menu-pop">{ELEMENT_INFO.map(([kind, label]) => <button key={kind} onClick={() => addElement(kind)}>{label}</button>)}</div></details>
            <details class="menu" open={openMenu === "format" ? true : undefined} onToggle={(event) => { const isOpen = event.currentTarget.open; setOpenMenu((previous) => (isOpen ? "format" : previous === "format" ? null : previous)); }}><summary onMouseEnter={() => { if (openMenu && openMenu !== "format") setOpenMenu("format"); }}>Format</summary><div class="menu-pop"><button onClick={() => revealPanel("theme")}>Style presets</button><button onClick={() => revealPanel("behaviors")}>Behaviors…</button></div></details>
            <details class="menu" open={openMenu === "view" ? true : undefined} onToggle={(event) => { const isOpen = event.currentTarget.open; setOpenMenu((previous) => (isOpen ? "view" : previous === "view" ? null : previous)); }}><summary onMouseEnter={() => { if (openMenu && openMenu !== "view") setOpenMenu("view"); }}>View</summary><div class="menu-pop"><button onClick={() => setViewMode("canvas")}>Canvas only{viewMode === "canvas" ? " ✓" : ""}</button><button onClick={() => setViewMode("split")}>Split view{viewMode === "split" ? " ✓" : ""}</button><button onClick={() => setViewMode("code")}>Code only{viewMode === "code" ? " ✓" : ""}</button><hr />{ALL_PANELS.map((panelId) => <button key={panelId} onClick={() => togglePanelOpen(panelId)}>{DOCK_PANELS[panelId].title}{isPanelOpen(panelId) ? <span class="menu-check">✓</span> : null}</button>)}<hr /><button onClick={() => setLayout(documentModel.settings.layout === "classic" ? "modern" : "classic")}>Switch toolbar style</button></div></details>
            <details class="menu" open={openMenu === "help" ? true : undefined} onToggle={(event) => { const isOpen = event.currentTarget.open; setOpenMenu((previous) => (isOpen ? "help" : previous === "help" ? null : previous)); }}><summary onMouseEnter={() => { if (openMenu && openMenu !== "help") setOpenMenu("help"); }}>Help</summary><div class="menu-pop"><button onClick={() => void invoke("open_help_window", { topic: "tour" }).catch(showError)}>How to use WeaveCatcher</button><hr /><button onClick={() => void invoke("open_help_window", { topic: "html" }).catch(showError)}>Learn HTML</button><button onClick={() => void invoke("open_help_window", { topic: "css" }).catch(showError)}>Learn CSS</button><button onClick={() => void invoke("open_help_window", { topic: "js" }).catch(showError)}>Learn JavaScript</button></div></details>
          </nav>
          <div class="top-actions">
            <button class="quiet-button" onClick={() => void saveProject()} title="Save project">Save</button>
            <button class="quiet-button export-action" onClick={exportToFolder} title="Export website files">Export</button>
            <button class="primary-button" onClick={() => void previewSite()}><span>▷</span> Preview</button>
            <button class="avatar-button" title="WeaveCatcher settings" onClick={() => openSettingsWindow()}>⚙</button>
          </div>
        </header>

    {documentModel.settings.layout === "classic" && <div class="classic-toolbar">
      <div class="toolbar-group"><button title="New project" onClick={newProject}>＋ <span>New</span></button><button title="Open project" onClick={openProject}>↗ <span>Open</span></button><button title="Save project" onClick={() => void saveProject()}>▣ <span>Save</span></button><i /></div>
      <div class="toolbar-group"><button title="Undo" onClick={() => void travelHistory("undo_document")}>↶</button><button title="Redo" onClick={() => void travelHistory("redo_document")}>↷</button><i /><button title="Export" onClick={exportToFolder}>⇩ <span>Export</span></button></div>
      <span class="toolbar-spacer" />
      <div class="device-toggle"><button class="active">Desktop</button><button title="Responsive editing is planned for v2" onClick={() => setToast("Tablet preview is coming in a future release.")}>Tablet</button><button title="Responsive editing is planned for v2" onClick={() => setToast("Mobile preview is coming in a future release.")}>Mobile</button></div>
    </div>}

    <div class="workspace" ref={workspaceRef} onDragOver={workspaceDragOver} onDrop={workspaceDrop}>
      {renderZone("left")}
      <main class="canvas-area">
        <div class="canvas-toolbar"><div class="breadcrumb"><button onClick={() => setSelectedId(null)}>{documentModel.name}</button><span>/</span><button onClick={() => setSelectedId(null)}>{page?.name}</button>{selected && <><span>/</span><strong>{selected.name}</strong></>}</div><div class="canvas-tools"><span class={`saved-state ${dirty ? "unsaved" : ""}`}><i /> {dirty ? "Unsaved changes" : "All changes saved"}</span><i class="tool-divider" /><div class="view-switch" role="tablist" aria-label="Editor view">{VIEW_MODES.map((mode) => <button key={mode} role="tab" aria-selected={viewMode === mode} class={viewMode === mode ? "active" : ""} onClick={() => setViewMode(mode)}>{mode === "canvas" ? (liveView ? "Live" : "Canvas") : mode === "split" ? "Split" : "Code"}</button>)}</div>
<details class="menu view-live-menu" open={openMenu === "live" ? true : undefined} onToggle={(event) => { const isOpen = event.currentTarget.open; setOpenMenu((previous) => (isOpen ? "live" : previous === "live" ? null : previous)); }}><summary title="Switch the stage between Design and Live view" onMouseEnter={() => { if (openMenu && openMenu !== "live") setOpenMenu("live"); }}>▾</summary><div class="menu-pop"><button onClick={() => { setLiveView(true); if (viewMode === "code") setViewMode("split"); }}>{liveView ? "✓ " : ""}Live</button><button onClick={() => setLiveView(false)}>{!liveView ? "✓ " : ""}Design</button></div></details>
<i class="tool-divider" /><button class="icon-button" title="Zoom out" onClick={() => setToast("Canvas zoom: 100%")}>−</button><span class="zoom-label">100%</span><button class="icon-button" title="Zoom in" onClick={() => setToast("Canvas zoom: 100%")}>＋</button></div></div>
        <div class={`editor-workarea ${viewMode !== "canvas" ? "with-code" : ""} ${viewMode === "code" ? "mode-code" : ""} ${viewMode === "split" && splitSettings.orientation === "stacked" ? "split-stacked" : ""} ${splitSettings.codeFirst ? "code-first" : ""}`}>
          <div class="stage-scroll" ref={stageRef} onClick={() => { setSelectedId(null); setContextPoint(null); }} onDragOver={(event) => { event.preventDefault(); setDropTarget("root"); }} onDrop={(event) => { onRootDrop(event); setDropTarget(null); }}>
            {liveView ? <div class="canvas-page live-page"><iframe class="live-frame" title="Live preview" srcdoc={liveDocument} /></div> : <div class={`canvas-page ${dropTarget === "root" && draggingKind ? "root-drop-target" : ""}`}>
              {elements.length ? elements.map((element) => <CanvasElement key={element.id} node={element} selectedId={selectedId} dropTarget={dropTarget} setDropTarget={setDropTarget} mutate={mutate} onPick={pickElement} onPreview={previewBehavior} onDragState={(id, kind) => { setDraggingId(id); setDraggingKind(kind); }} />) : <div class="canvas-empty"><div class="empty-art"><span>＋</span><i /><b /><em /></div><h2>Your canvas is ready</h2><p>Drag an element here or add your first block from the panel.</p><button class="primary-button" onClick={() => void addElement("section")}>＋ Add a section</button></div>}
              {selected && contextPoint && <div class="floating-toolbar" style={{ left: `${contextPoint.x}px`, top: `${contextPoint.y}px` }} onClick={(event) => event.stopPropagation()}><span class="floating-name">{selected.name}</span><button title="Move up" disabled={!selectedLocation || selectedLocation.index === 0} onClick={() => selectedLocation && void mutate({ type: "move_element", id: selected.id, parentId: selectedLocation.parentId, index: selectedLocation.index - 1 })}>↑</button><button title="Move down" disabled={!selectedLocation || selectedLocation.index >= selectedLocation.count - 1} onClick={() => selectedLocation && void mutate({ type: "move_element", id: selected.id, parentId: selectedLocation.parentId, index: selectedLocation.index + 1 })}>↓</button><button title="Duplicate" onClick={() => void mutate({ type: "duplicate_element", id: selected.id })}>⧉</button><button title="Delete" onClick={() => { void mutate({ type: "delete_element", id: selected.id }); setSelectedId(null); }}>⌫</button><button title="Open behavior settings" onClick={() => revealPanel("behaviors")}>⌁</button></div>}
              {selected && RESIZABLE_KINDS.includes(selected.kind) && resizeFrame && <div class="resize-frame" style={{ left: `${resizeFrame.left}px`, top: `${resizeFrame.top}px`, width: `${resizeFrame.width}px`, height: `${resizeFrame.height}px` }}>
                {(HEIGHT_ONLY_KINDS.includes(selected.kind) ? ["n", "s"] : ["n", "s", "e", "w", "ne", "nw", "se", "sw"]).map((dir) => <div key={dir} class={`resize-handle dir-${dir}`} onPointerDown={(event) => startCanvasResize(event, dir)} />)}
              </div>}
              {modalPreview && <div class="modal-preview-backdrop" onClick={() => setModalPreview(null)}><div class="modal-preview" onClick={(event) => event.stopPropagation()}><button class="modal-close" onClick={() => setModalPreview(null)}>×</button><span class="eyebrow">INTERACTION PREVIEW</span><h3>{findElement(elements, modalPreview)?.content || "Modal preview"}</h3><p>This dialog demonstrates the configured modal behavior.</p><button class="primary-button" onClick={() => setModalPreview(null)}>Close</button></div></div>}
            </div>}
          </div>
          {viewMode !== "canvas" && <section class="code-panel">
            {openFile ? <>
              <div class="code-header">
                <div><span class="eyebrow">FILE</span><h2>{openFile.name}{fileDraft !== fileSaved ? " •" : ""}</h2></div>
                <div class="code-header-actions">
                  <button class="icon-button" title="Close file" onClick={() => setOpenFile(null)}>×</button>
                </div>
              </div>
              <textarea class="code-source" spellcheck={false} aria-label={`Edit ${openFile.name}`} value={fileDraft} onInput={(event) => setFileDraft(event.currentTarget.value)} />
              <div class="code-footer">
                <span class="code-state">{fileDraft !== fileSaved ? "Unsaved changes on disk" : "Saved on disk"}</span>
                <button class="text-action" disabled={fileDraft === fileSaved} title="Discard unsaved edits" onClick={() => setFileDraft(fileSaved)}>Discard</button>
                <button class="primary-button apply-code" disabled={fileDraft === fileSaved} title="Write the file back to the opened folder" onClick={() => void saveOpenFile()}>Save file</button>
              </div>
            </> : <>
              <div class="code-header">
                <div><span class="eyebrow">CODE</span><h2>{customCodeFor(codeTab) ? "Custom code" : "Page source"}</h2></div>
                <div class="code-header-actions">
                  {viewMode === "split" && <div class="split-controls" role="group" aria-label="Split layout">
                    <button class={splitSettings.orientation === "side" ? "active" : ""} title="Split side by side" onClick={() => updateSplit({ orientation: "side" })}>◫</button>
                    <button class={splitSettings.orientation === "stacked" ? "active" : ""} title="Split top and bottom" onClick={() => updateSplit({ orientation: "stacked" })}>▥</button>
                    <button title={splitSettings.codeFirst ? "Show the canvas first" : "Show the code first"} onClick={() => updateSplit({ codeFirst: !splitSettings.codeFirst })}>⇄</button>
                  </div>}
                  <button class="icon-button" onClick={() => setViewMode("canvas")} title="Close code view">×</button>
                </div>
              </div>
              {customCodeFor(codeTab) && <div class="custom-code-notice"><span>ⓘ</span><p>{codeTab === "html" ? "The canvas is built from the element panels — this custom HTML replaces the page only in the exported site. Delete elements on the canvas itself; use Reset to export the canvas version again." : codeTab === "css" ? "This custom stylesheet overrides the generated styles in the exported site." : "This custom script is added to the exported site."}</p></div>}
              <div class="code-tabs">{(["html", "css", "js"] as const).map((tab) => <button key={tab} class={codeTab === tab ? "active" : ""} onClick={() => setCodeTab(tab)}>{tab === "html" ? "index.html" : tab === "js" ? "script.js" : "styles.css"}{draftCode[tab] !== savedCode[tab] ? " •" : ""}</button>)}</div>
              <textarea class="code-source" spellcheck={false} aria-label={`Edit ${codeTab} code`} value={draftCode[codeTab]} onInput={(event) => editCode(codeTab, event.currentTarget.value)} />
              <div class="code-footer">
                <span class="code-state">{customCodeFor(codeTab) ? "Custom code is used at export" : draftCode[codeTab] !== savedCode[codeTab] ? "Unsaved edits" : "Generated from the canvas"}</span>
                <button class="text-action" disabled={!customCodeFor(codeTab) && draftCode[codeTab] === savedCode[codeTab]} title={customCodeFor(codeTab) ? "Go back to code generated from the canvas" : "Discard unsaved edits"} onClick={() => void resetCodeTab()}>Reset</button>
                <button class="primary-button apply-code" disabled={!(["html", "css", "js"] as const).some((key) => draftCode[key] !== savedCode[key])} title="Use the edited code when the site is exported" onClick={() => void applyCode()}>Apply code</button>
              </div>
            </>}
          </section>}
        </div>
        <footer class="statusbar"><span><i class="status-dot" /> {page?.name ?? "No page"}</span><span>{elementCount} element{elementCount === 1 ? "" : "s"}</span><span class="status-spacer" /><span>HTML · CSS · JavaScript</span></footer>
      </main>

      {renderZone("right")}
      {dock.floating.map((f) => (
        <div key={f.id} class="dock-float" style={{ left: f.x, top: f.y, width: f.w, height: f.h }} onPointerDown={() => bringFloatToFront(f.id)}>
          <header class="dock-panel-head" draggable={true} title="Drag to move · drop on a dock zone to re-dock" onDragStart={(event) => onPanelDragStart(event, f.id)} onDragEnd={onPanelDragEnd}>
            <span class="dock-icon">{DOCK_PANELS[f.id].icon}</span><span class="dock-title">{DOCK_PANELS[f.id].title}</span>
            <button class="dock-close" title="Dock this panel to the right column" onClick={() => dockPanel(f.id, "right")}>×</button>
          </header>
          <div class="dock-panel-body">{panelBody(f.id)}</div>
          <div class="float-resize" onPointerDown={(event) => startFloatResize(event, f.id)} />
        </div>
      ))}
    </div>
    {dock.bottom.length > 0 ? <div class="dock-bottom" style={{ flex: `0 0 ${dock.bottomHeight}px` }} onDragOver={(event) => zoneDragOver(event, "bottom")} onDrop={(event) => zoneDrop(event, "bottom")}>
      <div class="zone-resizer top-edge" onPointerDown={startBottomResize} />
      <div class="dock-bottom-groups">{dock.bottom.map((group, index) => renderGroup("bottom", group, index))}</div>
    </div> : dragPanel && <div class="dock-bottom-empty" onDragOver={(event) => zoneDragOver(event, "bottom")} onDrop={(event) => zoneDrop(event, "bottom")}><span>⌄ Drop a panel here to dock it as a bottom section</span></div>}
    <footer class="app-footer"><span>WeaveCatcher <b>·</b> {documentModel.name}</span><span class="footer-status"><i /> Ready</span><span>Ctrl/Cmd + Z to undo</span></footer>
    {tabMenu && (() => {
      const menu = tabMenu;
      const closing = menu.panelId;
      return <div class="menu-backdrop" onClick={() => setTabMenu(null)} onContextMenu={(event) => { event.preventDefault(); setTabMenu(null); }}>
        <div class="menu-pop context-pop" style={{ left: `${menu.x}px`, top: `${menu.y}px` }} onClick={(event) => event.stopPropagation()}>
          {menu.kind === "tab" && closing && <button onClick={() => { closePanel(closing); setTabMenu(null); }}>Close {DOCK_PANELS[closing].title}</button>}
          <button onClick={() => { closeGroup(menu.zone, menu.groupId); setTabMenu(null); }}>Close tab row</button>
        </div>
      </div>;
    })()}
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
  if (["image", "rollover", "video", "audio"].includes(node.kind)) {
    for (const key of ["src", "poster", "data-rollover"]) {
      const raw = node.attributes[key];
      if (raw) propsForNode[key] = mediaDisplayUrl(String(raw));
    }
  }
  if (node.kind === "iframe") {
    // The embedded page swallows every pointer event, so wrap it and cap it with an
    // overlay that lets clicks, drags and selection reach the editor instead.
    const iframeProps: Record<string, unknown> = { ...node.attributes, class: "iframe-embed", style: { width: "100%", height: "100%" } };
    return h("div", propsForNode, h("iframe", iframeProps), h("div", { class: "iframe-overlay" }));
  }
  if (node.kind === "calendar") {
    // Same structure the export produces; the strip color rides in as a CSS custom
    // property on the element's inline style so it reaches the inner strip.
    const strip = node.styles["--vw-calendar-strip"] ?? "#5f65e8";
    const mondayStart = node.attributes.weekStart === "monday";
    const events = parseCalendarEvents(node.attributes.events);
    const now = new Date();
    const dowOrder = mondayStart ? [1, 2, 3, 4, 5, 6, 0] : [0, 1, 2, 3, 4, 5, 6];
    return h("div", propsForNode,
      h("div", { class: "vw-cal-strip", style: { background: strip } },
        h("p", { class: "vw-cal-month" }, `${CALENDAR_MONTHS[now.getMonth()]} ${now.getFullYear()}`),
        h("h3", { class: "vw-cal-title" }, node.content),
        node.attributes.subtitle ? h("p", { class: "vw-cal-sub" }, node.attributes.subtitle) : null),
      h("div", { class: "vw-cal-week" }, dowOrder.map((day) => h("div", { class: "vw-cal-cell", key: day }, CALENDAR_DOW[day]))),
      h("div", { class: "vw-cal-days" }, calendarDays(mondayStart).map((cell) => {
        const title = cell.day === null ? undefined : events.find((event) => event.date === cell.iso)?.title;
        return h("div", { class: `vw-cal-cell${cell.day === null ? " pad" : ""}${title !== undefined ? " event" : ""}${cell.today ? " today" : ""}`, key: cell.key, title }, cell.day ?? "");
      })));
  }
  if (node.kind === "textbox") {
    const fieldProps: Record<string, unknown> = { name: node.attributes.name, placeholder: node.attributes.placeholder, rows: node.attributes.rows ?? "4" };
    if (node.attributes.required !== undefined) fieldProps.required = true;
    return h("label", propsForNode, h("textarea", fieldProps), node.content, node.attributes.required !== undefined ? h("span", { class: "vw-required" }, "*") : null);
  }
  if (node.kind === "dropdown") {
    const options = (node.attributes.options ?? "").split("\n").map((option) => option.trim()).filter(Boolean);
    return h("label", propsForNode,
      h("select", { name: node.attributes.name, required: node.attributes.required !== undefined }, options.map((option) => h("option", { key: option }, option))),
      node.content,
      node.attributes.required !== undefined ? h("span", { class: "vw-required" }, "*") : null);
  }
  if (node.kind === "datetime") {
    const required = node.attributes.required !== undefined;
    return h("div", propsForNode,
      node.content ? h("span", { class: "vw-dt-label" }, node.content) : null,
      h("label", null, "Date ", h("input", { type: "date", name: `${node.attributes.name ?? "appt"}-date`, required })),
      h("label", null, "Time ", h("input", { type: "time", name: `${node.attributes.name ?? "appt"}-time`, required })));
  }
  if (node.kind === "table") {
    const { rows, cols } = tableSize(node);
    const header = node.attributes.header === "on";
    const cells = parseTableCells(node.attributes.cells, rows, cols);
    const bodyRows = header ? cells.slice(1) : cells;
    return h("table", propsForNode,
      header ? h("thead", null, h("tr", null, cells[0].map((value, index) => h("th", { key: index }, value)))) : null,
      h("tbody", null, bodyRows.map((row, rowIndex) => h("tr", { key: rowIndex }, row.map((value, colIndex) => h("td", { key: colIndex }, value))))));
  }
  if (node.kind === "richtext") {
    return h("div", { ...propsForNode, class: `${propsForNode.class} richtext-node`, dangerouslySetInnerHTML: { __html: node.content || "<p></p>" } });
  }
  if (node.kind === "strip") {
    const src = node.attributes.src;
    const image = src ? mediaDisplayUrl(src) : undefined;
    const stripStyle: Record<string, string> = { ...node.styles };
    if (image) { stripStyle.backgroundImage = `url("${image}")`; stripStyle.backgroundSize = "cover"; stripStyle.backgroundPosition = "center"; }
    return h("div", { ...propsForNode, class: `${propsForNode.class} vw-strip`, style: stripStyle },
      node.content ? h("span", { class: "vw-strip-text" }, node.content) : null);
  }
  if (node.kind === "input" && (node.attributes.required !== undefined || node.content)) {
    // A required flag or visible label upgrades the bare input to a label-wrapped field
    // with the same structure the export produces.
    const fieldProps: Record<string, unknown> = { ...node.attributes };
    if (node.attributes.required !== undefined) fieldProps.required = true;
    const nested = node.children.map((child) => <CanvasElement key={child.id} node={child} selectedId={selectedId} dropTarget={dropTarget} setDropTarget={setDropTarget} mutate={mutate} onPick={onPick} onPreview={onPreview} onDragState={onDragState} />);
    return h("label", propsForNode, h("input", fieldProps), node.content, node.attributes.required !== undefined ? h("span", { class: "vw-required" }, "*") : null, ...nested);
  }
  if (node.kind === "checkbox" || node.kind === "radio") {
    // Rendered as a label wrapping the real input so the caption text is part of the element.
    const inputProps: Record<string, unknown> = { type: node.kind, name: node.attributes.name ?? "option" };
    if (node.attributes.checked !== undefined) inputProps.checked = true;
    if (node.attributes.required !== undefined) inputProps.required = true;
    const nested = node.children.map((child) => <CanvasElement key={child.id} node={child} selectedId={selectedId} dropTarget={dropTarget} setDropTarget={setDropTarget} mutate={mutate} onPick={onPick} onPreview={onPreview} onDragState={onDragState} />);
    return h("label", propsForNode, h("input", inputProps), node.content, node.attributes.required !== undefined ? h("span", { class: "vw-required" }, "*") : null, ...nested);
  }
  if (node.kind === "rollover") {
    const base = String(mediaDisplayUrl(String(node.attributes.src ?? "")) ?? "");
    const hover = String(mediaDisplayUrl(String(node.attributes["data-rollover"] ?? node.attributes.src ?? "")) ?? base);
    propsForNode.onPointerEnter = (event: PointerEvent) => { (event.currentTarget as HTMLImageElement).src = hover; };
    propsForNode.onPointerLeave = (event: PointerEvent) => { (event.currentTarget as HTMLImageElement).src = base; };
  }
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
  const content = ["image", "rollover", "iframe", "video", "audio", "gallery", "input", "divider"].includes(node.kind) ? undefined : node.content;
  return h(tag, propsForNode, content, ...children);
}

function fileIconFor(name: string): string {
  const extension = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "ico"].includes(extension)) return "▧";
  if (["html", "htm", "wc", "json"].includes(extension)) return "◇";
  if (["css", "scss"].includes(extension)) return "◒";
  if (["js", "ts", "mjs"].includes(extension)) return "⌁";
  if (["mp4", "webm", "mov", "mp3", "wav", "ogg"].includes(extension)) return "▷";
  return "▫";
}

function formatFileSize(size: number): string {
  if (size >= 1048576) return `${(size / 1048576).toFixed(1)} MB`;
  if (size >= 1024) return `${Math.round(size / 1024)} KB`;
  return `${size} B`;
}

function FileNode(props: { entry: FileEntry; depth: number; selectedFile: string | null; select: (entry: FileEntry) => void; onOpen: (entry: FileEntry) => void }) {
  const { entry, depth, selectedFile, select, onOpen } = props;
  const [expanded, setExpanded] = useState(depth < 2);
  if (entry.isDir) return <div class="file-branch">
    <button class={`file-row dir ${expanded ? "open" : ""}`} style={{ paddingLeft: `${8 + depth * 14}px` }} onClick={() => setExpanded(!expanded)}>
      <span class="file-caret">{expanded ? "⌄" : "›"}</span><span class="file-icon">▤</span><span class="file-name">{entry.name}</span>
    </button>
    {expanded && entry.children.map((child) => <FileNode key={child.path} entry={child} depth={depth + 1} selectedFile={selectedFile} select={select} onOpen={onOpen} />)}
  </div>;
  return <button class={`file-row ${selectedFile === entry.path ? "active" : ""}`} title="Click to edit here · double-click to open with the default app" style={{ paddingLeft: `${8 + depth * 14}px` }} onClick={() => select(entry)} onDblClick={() => onOpen(entry)}>
    <span class="file-icon">{fileIconFor(entry.name)}</span><span class="file-name">{entry.name}</span><small>{formatFileSize(entry.size)}</small>
  </button>;
}

function LayerItem(props: { element: ElementNode; depth: number; index: number; parentId: string | null; siblingIds: string[]; selectedId: string | null; select: (id: string) => void; mutate: (intent: EditIntent) => Promise<DocumentModel | undefined> }) {
  const { element, depth, index, parentId, siblingIds, selectedId, select, mutate } = props;
  const [expanded, setExpanded] = useState(true);
  return <div class="layer-branch"><div class={`layer-row ${selectedId === element.id ? "active" : ""}`} style={{ paddingLeft: `${10 + depth * 16}px` }} draggable onDragStart={(event) => { event.dataTransfer?.setData("application/x-vw-element", element.id); event.dataTransfer?.setData("text/plain", element.id); event.stopPropagation(); }} onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); event.currentTarget.classList.add("is-drop-target"); }} onDragLeave={(event) => event.currentTarget.classList.remove("is-drop-target")} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); const movingId = event.dataTransfer?.getData("application/x-vw-element"); if (movingId && movingId !== element.id) { const oldIndex = siblingIds.indexOf(movingId); const destination = index - (oldIndex !== -1 && oldIndex < index ? 1 : 0); void mutate({ type: "move_element", id: movingId, parentId, index: destination }); } event.currentTarget.classList.remove("is-drop-target"); }}><button class="layer-expand" onClick={() => setExpanded(!expanded)}>{element.children.length ? expanded ? "⌄" : "›" : "·"}</button><button class="layer-select" onClick={() => select(element.id)}><span class="layer-kind">{ELEMENT_INFO.find(([kind]) => kind === (element.kind === "list" ? "ul" : element.kind))?.[2] ?? "▧"}</span><span class={element.hidden ? "muted" : ""}>{element.name}</span></button><button class="layer-action" title={element.hidden ? "Show element" : "Hide element"} onClick={() => void mutate({ type: "set_hidden", id: element.id, hidden: !element.hidden })}>{element.hidden ? "◉" : "◌"}</button><button class="layer-action" title="Rename" onClick={() => { const name = window.prompt("Layer name", element.name); if (name?.trim()) void mutate({ type: "rename_element", id: element.id, name: name.trim() }); }}>✎</button></div>{expanded && element.children.map((child, childIndex) => <LayerItem key={child.id} element={child} depth={depth + 1} index={childIndex} parentId={element.id} siblingIds={element.children.map((item) => item.id)} selectedId={selectedId} select={select} mutate={mutate} />)}</div>;
}

function Inspector(props: { element: ElementNode; mutate: (intent: EditIntent) => Promise<DocumentModel | undefined>; onError: (cause: unknown) => void }) {
  const { element, mutate, onError } = props;
  const style = (property: string, value: string) => void mutate({ type: "set_style", id: element.id, property, value });
  const attr = (name: string, value: string) => void mutate({ type: "set_attribute", id: element.id, name, value });
  const showText = !["image", "rollover", "iframe", "gallery", "input", "divider", "spacer", "calendar", "textbox", "richtext", "dropdown", "datetime", "table", "strip"].includes(element.kind);
  const customBullet = element.styles.listStyleType?.startsWith("\"") ? element.styles.listStyleType.slice(1, -1) : undefined;
  const [managePanel, setManagePanel] = useState<"events" | "settings" | null>(null);
  const [stripPicker, setStripPicker] = useState(false);
  return <div class="inspector-content">
    <div class="inspector-section">
      <h3>Content</h3>
      <label class="field-label">Layer name<input value={element.name} onInput={(event) => void mutate({ type: "rename_element", id: element.id, name: event.currentTarget.value })} /></label>
      <label class="field-label">CSS class<input value={element.attributes.class ?? ""} placeholder="e.g. hero-banner" onInput={(event) => attr("class", event.currentTarget.value)} /></label>
      {showText && <label class="field-label">Text<textarea rows={element.kind === "heading" ? 2 : 4} value={element.content} onInput={(event) => void mutate({ type: "update_content", id: element.id, content: event.currentTarget.value })} /></label>}
      {element.kind === "image" && <><label class="field-label">Image URL<span class="browse-field"><input value={element.attributes.src ?? ""} placeholder="https://… or a local file" onInput={(event) => attr("src", event.currentTarget.value)} /><button class="browse-button" title="Browse for an image file" onClick={() => void browseMediaFile("image", (picked) => attr("src", picked)).catch(onError)}>…</button></span></label><label class="field-label">Alternative text<input value={element.attributes.alt ?? ""} onInput={(event) => attr("alt", event.currentTarget.value)} /></label></>}
      {element.kind === "rollover" && <><label class="field-label">Image URL<span class="browse-field"><input value={element.attributes.src ?? ""} placeholder="https://… or a local file" onInput={(event) => attr("src", event.currentTarget.value)} /><button class="browse-button" title="Browse for an image file" onClick={() => void browseMediaFile("image", (picked) => attr("src", picked)).catch(onError)}>…</button></span></label><label class="field-label">Rollover image URL<span class="browse-field"><input value={element.attributes["data-rollover"] ?? ""} placeholder="https://… (shown on hover)" onInput={(event) => attr("data-rollover", event.currentTarget.value)} /><button class="browse-button" title="Browse for the rollover image file" onClick={() => void browseMediaFile("image", (picked) => attr("data-rollover", picked)).catch(onError)}>…</button></span></label><label class="field-label">Alternative text<input value={element.attributes.alt ?? ""} onInput={(event) => attr("alt", event.currentTarget.value)} /></label></>}
      {(element.kind === "video" || element.kind === "audio") && <label class="field-label">Media URL<span class="browse-field"><input value={element.attributes.src ?? ""} placeholder="https://… or a local file" onInput={(event) => attr("src", event.currentTarget.value)} /><button class="browse-button" title={element.kind === "video" ? "Browse for a video file" : "Browse for an audio file"} onClick={() => void browseMediaFile(element.kind === "video" ? "video" : "audio", (picked) => attr("src", picked)).catch(onError)}>…</button></span></label>}
      {element.kind === "iframe" && <><label class="field-label">Embed URL<input value={element.attributes.src ?? ""} placeholder="https://www.youtube.com/embed/…" onInput={(event) => attr("src", event.currentTarget.value)} /></label><label class="field-label">Title<input value={element.attributes.title ?? ""} placeholder="Embedded content" onInput={(event) => attr("title", event.currentTarget.value)} /></label></>}
      {element.kind === "video" && <label class="field-label">Poster image<input value={element.attributes.poster ?? ""} placeholder="https://…/poster.jpg" onInput={(event) => attr("poster", event.currentTarget.value)} /></label>}
      {(element.kind === "link" || element.kind === "button") && <label class="field-label">Link URL<input value={element.attributes.href ?? ""} placeholder="https://example.com" onInput={(event) => attr("href", event.currentTarget.value)} /></label>}
      {element.kind === "input" && <><label class="field-label">Placeholder<input value={element.attributes.placeholder ?? ""} onInput={(event) => attr("placeholder", event.currentTarget.value)} /></label><label class="field-label">Input type<select value={element.attributes.type ?? "text"} onChange={(event) => attr("type", event.currentTarget.value)}><option>text</option><option>email</option><option>number</option><option>password</option></select></label><label class="field-label">Field label<input value={element.content} placeholder="Shown next to the field" onInput={(event) => void mutate({ type: "update_content", id: element.id, content: event.currentTarget.value })} /></label><label class="check-row"><input type="checkbox" checked={element.attributes.required !== undefined} onChange={(event) => attr("required", event.currentTarget.checked ? "required" : "")} />Required</label></>}
      {(element.kind === "checkbox" || element.kind === "radio") && <><label class="field-label">Field name<input value={element.attributes.name ?? ""} onInput={(event) => attr("name", event.currentTarget.value)} /></label><label class="check-row"><input type="checkbox" checked={element.attributes.checked !== undefined} onChange={(event) => attr("checked", event.currentTarget.checked ? "checked" : "")} />Checked by default</label><label class="check-row"><input type="checkbox" checked={element.attributes.required !== undefined} onChange={(event) => attr("required", event.currentTarget.checked ? "required" : "")} />Required</label></>}
      {element.kind === "calendar" && <><label class="field-label">Section background<span class="color-field"><input type="color" value={colorValue(element.styles.backgroundColor, "#ffffff")} onInput={(event) => style("backgroundColor", event.currentTarget.value)} /><input value={element.styles.backgroundColor ?? ""} placeholder="#ffffff" onInput={(event) => style("backgroundColor", event.currentTarget.value)} /></span></label><label class="field-label">Strip background<span class="color-field"><input type="color" value={colorValue(element.styles["--vw-calendar-strip"], "#5f65e8")} onInput={(event) => style("--vw-calendar-strip", event.currentTarget.value)} /><input value={element.styles["--vw-calendar-strip"] ?? ""} placeholder="#5f65e8" onInput={(event) => style("--vw-calendar-strip", event.currentTarget.value)} /></span></label><label class="field-label">Title<input value={element.content} placeholder="Event Calendar" onInput={(event) => void mutate({ type: "update_content", id: element.id, content: event.currentTarget.value })} /></label><label class="field-label">Subtitle<input value={element.attributes.subtitle ?? ""} onInput={(event) => attr("subtitle", event.currentTarget.value)} /></label></>}
      {element.kind === "textbox" && <><label class="field-label">Label<input value={element.content} onInput={(event) => void mutate({ type: "update_content", id: element.id, content: event.currentTarget.value })} /></label><label class="field-label">Placeholder<input value={element.attributes.placeholder ?? ""} onInput={(event) => attr("placeholder", event.currentTarget.value)} /></label><label class="field-label">Field name<input value={element.attributes.name ?? ""} onInput={(event) => attr("name", event.currentTarget.value)} /></label><label class="check-row"><input type="checkbox" checked={element.attributes.required !== undefined} onChange={(event) => attr("required", event.currentTarget.checked ? "required" : "")} />Required</label></>}
      {element.kind === "dropdown" && <><label class="field-label">Label<input value={element.content} onInput={(event) => void mutate({ type: "update_content", id: element.id, content: event.currentTarget.value })} /></label><label class="field-label">Options (one per line)<textarea rows={4} value={element.attributes.options ?? ""} onInput={(event) => attr("options", event.currentTarget.value)} /></label><label class="field-label">Field name<input value={element.attributes.name ?? ""} onInput={(event) => attr("name", event.currentTarget.value)} /></label><label class="check-row"><input type="checkbox" checked={element.attributes.required !== undefined} onChange={(event) => attr("required", event.currentTarget.checked ? "required" : "")} />Required</label></>}
      {element.kind === "datetime" && <><label class="field-label">Label<input value={element.content} onInput={(event) => void mutate({ type: "update_content", id: element.id, content: event.currentTarget.value })} /></label><label class="field-label">Field name<input value={element.attributes.name ?? ""} onInput={(event) => attr("name", event.currentTarget.value)} /></label><label class="check-row"><input type="checkbox" checked={element.attributes.required !== undefined} onChange={(event) => attr("required", event.currentTarget.checked ? "required" : "")} />Required</label></>}
      {element.kind === "strip" && <><label class="field-label">Overlay text<input value={element.content} placeholder="Optional headline over the strip" onInput={(event) => void mutate({ type: "update_content", id: element.id, content: event.currentTarget.value })} /></label><label class="field-label">Height<input value={element.styles.height ?? ""} placeholder="320px" onInput={(event) => style("height", event.currentTarget.value)} /></label></>}
    </div>
    {element.kind === "calendar" && <div class="inspector-section">
      <h3>Event Calendar</h3>
      <p class="panel-note">Manage the content of the Event Calendar here — events show as highlighted days on the calendar, with the title on hover.</p>
      <div class="manage-row">
        <button class={managePanel === "events" ? "manage-primary open" : "manage-primary"} onClick={() => setManagePanel(managePanel === "events" ? null : "events")}>Manage Events</button>
        <button class={managePanel === "settings" ? "manage-ghost open" : "manage-ghost"} onClick={() => setManagePanel(managePanel === "settings" ? null : "settings")}>Settings</button>
      </div>
      {managePanel === "events" && <div class="manage-events">
        {parseCalendarEvents(element.attributes.events).map((event, index) => <div class="manage-event" key={index}>
          <input type="date" value={event.date} onChange={(e) => attr("events", JSON.stringify(parseCalendarEvents(element.attributes.events).map((item, i) => i === index ? { ...item, date: e.currentTarget.value } : item)))} />
          <input value={event.title} placeholder="Event title" onInput={(e) => attr("events", JSON.stringify(parseCalendarEvents(element.attributes.events).map((item, i) => i === index ? { ...item, title: e.currentTarget.value } : item)))} />
          <button class="manage-remove" title="Remove event" onClick={() => attr("events", JSON.stringify(parseCalendarEvents(element.attributes.events).filter((_, i) => i !== index)))}>×</button>
        </div>)}
        <button class="manage-add" onClick={() => attr("events", JSON.stringify([...parseCalendarEvents(element.attributes.events), { date: calendarIsoDate(new Date()), title: "" }]))}>＋ Add event</button>
      </div>}
      {managePanel === "settings" && <div class="manage-settings">
        <label class="check-row"><input type="checkbox" checked={element.attributes.weekStart === "monday"} onChange={(event) => attr("weekStart", event.currentTarget.checked ? "monday" : "")} />Start week on Monday</label>
        <label class="check-row"><input type="checkbox" checked={element.attributes.subtitle !== undefined} onChange={(event) => attr("subtitle", event.currentTarget.checked ? "Click a highlighted day to see what's on." : "")} />Show subtitle</label>
      </div>}
    </div>}
    {element.kind === "table" && <div class="inspector-section">
      <h3>Table</h3>
      <TableEditor element={element} attr={attr} />
    </div>}
    {element.kind === "richtext" && <div class="inspector-section">
      <h3>Rich text</h3>
      <RichTextEditor key={element.id} element={element} mutate={mutate} />
    </div>}
    {element.kind === "strip" && <div class="inspector-section">
      <h3>Strip background</h3>
      <p class="panel-note">Pick a gallery image from the strip library, upload your own picture, or use an offline gradient.</p>
      <div class="manage-row">
        <button class="manage-primary" onClick={() => setStripPicker(true)}>Strip gallery…</button>
        <button class="manage-ghost" onClick={() => void browseMediaFile("image", (picked) => { attr("src", picked); style("backgroundImage", ""); }).catch(onError)}>Upload image…</button>
      </div>
      {(element.attributes.src || element.styles.backgroundImage) && <button class="manage-add" onClick={() => { attr("src", ""); style("backgroundImage", ""); }} style="margin-top: 8px">Remove background image</button>}
      {stripPicker && <StripPicker attr={attr} style={style} close={() => setStripPicker(false)} />}
    </div>}
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
      {["ul", "list"].includes(element.kind) && <>
        <label class="field-label">Bullet symbol<select value={customBullet !== undefined ? "custom" : (element.styles.listStyleType ?? "disc")} onChange={(event) => style("listStyleType", event.currentTarget.value === "custom" ? '"•"' : event.currentTarget.value)}><option value="disc">Filled disc •</option><option value="circle">Open circle ○</option><option value="square">Square ▪</option><option value="none">No bullet</option><option value="custom">Custom symbol…</option></select></label>
        {customBullet !== undefined && <label class="field-label">Custom bullet character<input value={customBullet} placeholder="★" onInput={(event) => style("listStyleType", event.currentTarget.value ? `"${event.currentTarget.value}"` : "disc")} /></label>}
      </>}
    </div>
    <div class="inspector-section">
      <h3>Layout</h3>
      <label class="field-label">Display<select value={element.styles.display ?? "block"} onChange={(event) => style("display", event.currentTarget.value)}><option value="block">Block</option><option value="flex">Flex</option><option value="grid">Grid</option><option value="inline-flex">Inline flex</option></select></label>
      <div class="two-fields">
        <label class="field-label">Direction<select value={element.styles.flexDirection ?? "row"} onChange={(event) => style("flexDirection", event.currentTarget.value)}><option value="row">Row</option><option value="column">Column</option></select></label>
        <label class="field-label">Gap<input value={element.styles.gap ?? ""} placeholder="12px" onInput={(event) => style("gap", event.currentTarget.value)} /></label>
      </div>
      <label class="field-label">Grid columns<input value={element.styles.gridTemplateColumns ?? ""} placeholder="repeat(2, 1fr)" onInput={(event) => style("gridTemplateColumns", event.currentTarget.value)} /></label>
      {element.kind === "grid" && <>
        <label class="field-label">Columns<div class="preset-chips">{[1, 2, 3, 4].map((count) => <button class={element.styles.gridTemplateColumns === `repeat(${count}, 1fr)` ? "active" : ""} onClick={() => style("gridTemplateColumns", `repeat(${count}, 1fr)`)}>{count}</button>)}</div></label>
        <label class="field-label">Spacing between cells<div class="preset-chips">{["0px", "8px", "16px", "24px", "32px"].map((gap) => <button class={element.styles.gap === gap ? "active" : ""} onClick={() => style("gap", gap)}>{parseInt(gap) || 0}</button>)}</div></label>
      </>}
      <div class="two-fields">
        <label class="field-label">Justify<select value={element.styles.justifyContent ?? "flex-start"} onChange={(event) => style("justifyContent", event.currentTarget.value)}><option value="flex-start">Start</option><option value="center">Center</option><option value="space-between">Space between</option><option value="space-around">Space around</option><option value="flex-end">End</option></select></label>
        <label class="field-label">Align<select value={element.styles.alignItems ?? "stretch"} onChange={(event) => style("alignItems", event.currentTarget.value)}><option value="stretch">Stretch</option><option value="center">Center</option><option value="flex-start">Start</option><option value="flex-end">End</option></select></label>
      </div>
    </div>
    <button class="inspector-link" onClick={() => void mutate({ type: "set_hidden", id: element.id, hidden: !element.hidden })}>{element.hidden ? "Show on page" : "Hide on page"}<span>{element.hidden ? "◉" : "◌"}</span></button>
  </div>;
}

function TableEditor(props: { element: ElementNode; attr: (name: string, value: string) => void }) {
  const { element, attr } = props;
  const { rows, cols } = tableSize(element);
  const cells = parseTableCells(element.attributes.cells, rows, cols);
  const write = (next: string[][]) => attr("cells", JSON.stringify(next));
  const resize = (nextRows: number, nextCols: number) => {
    const current = parseTableCells(element.attributes.cells, rows, cols);
    attr("rows", String(nextRows));
    attr("cols", String(nextCols));
    write(Array.from({ length: nextRows }, (_, row) => Array.from({ length: nextCols }, (_, col) => current[row]?.[col] ?? "")));
  };
  return <>
    <div class="two-fields">
      <label class="field-label">Rows<input type="number" min={1} max={30} value={rows} onChange={(event) => resize(Math.min(30, Math.max(1, parseInt(event.currentTarget.value, 10) || 1)), cols)} /></label>
      <label class="field-label">Columns<input type="number" min={1} max={10} value={cols} onChange={(event) => resize(rows, Math.min(10, Math.max(1, parseInt(event.currentTarget.value, 10) || 1)))} /></label>
    </div>
    <label class="check-row"><input type="checkbox" checked={element.attributes.header === "on"} onChange={(event) => attr("header", event.currentTarget.checked ? "on" : "")} />First row is a header</label>
    <div class="table-editor">
      {cells.map((row, rowIndex) => <div class="table-editor-row" key={rowIndex}>
        {row.map((value, colIndex) => <input key={colIndex} value={value} placeholder={element.attributes.header === "on" && rowIndex === 0 ? `Column ${colIndex + 1}` : ""} onInput={(event) => write(cells.map((tableRow, i) => i === rowIndex ? tableRow.map((cell, j) => j === colIndex ? event.currentTarget.value : cell) : tableRow))} />)}
      </div>)}
    </div>
  </>;
}

function RichTextEditor(props: { element: ElementNode; mutate: (intent: EditIntent) => Promise<DocumentModel | undefined> }) {
  const { element, mutate } = props;
  const boxRef = useRef<HTMLDivElement | null>(null);
  // Fill the editable box only when switching elements — writing innerHTML on every
  // keystroke would reset the caret mid-sentence.
  useEffect(() => { if (boxRef.current) boxRef.current.innerHTML = element.content; }, [element.id]);
  const commit = () => void mutate({ type: "update_content", id: element.id, content: boxRef.current?.innerHTML ?? "" });
  const command = (name: string, value?: string) => {
    boxRef.current?.focus();
    document.execCommand(name, false, value);
    commit();
  };
  const tools: [string, string, string?][] = [["B", "bold"], ["I", "italic"], ["U", "underline"], ["H2", "formatBlock", "<h2>"], ["H3", "formatBlock", "<h3>"], ["¶", "formatBlock", "<p>"], ["• List", "insertUnorderedList"]];
  return <>
    <div class="rich-toolbar">
      {tools.map(([label, name, value]) => <button key={label} title={label} onMouseDown={(event) => { event.preventDefault(); command(name, value); }}>{label}</button>)}
    </div>
    <div class="rich-box" contentEditable ref={boxRef} onInput={commit} spellcheck={false} />
    <p class="panel-note">Formatting is stored as HTML and exported exactly as shown.</p>
  </>;
}

function StripPicker(props: { attr: (name: string, value: string) => void; style: (property: string, value: string) => void; close: () => void }) {
  const [remote, setRemote] = useState<{ name: string; url: string }[] | null>(null);
  const [message, setMessage] = useState("Loading the gallery from GitHub…");
  useEffect(() => {
    let mounted = true;
    fetch(`${STRIP_REPO_URL}manifest.json`)
      .then((response) => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); })
      .then((data: unknown) => {
        const list = Array.isArray(data) ? data : (data as { strips?: unknown } | null)?.strips;
        if (!Array.isArray(list)) throw new Error("manifest format not recognised");
        const strips = list.filter((item): item is string => typeof item === "string").map((name) => ({ name, url: `${STRIP_REPO_URL}${name}` }));
        if (!strips.length) throw new Error("manifest has no images");
        if (mounted) { setRemote(strips); setMessage("Click a picture to apply it to the strip."); }
      })
      .catch((cause: unknown) => { if (mounted) setMessage(`Gallery unavailable (${String(cause)}). Upload an image or use a preset below.`); });
    return () => { mounted = false; };
  }, []);
  const applyImage = (url: string) => { props.attr("src", url); props.style("backgroundImage", ""); props.close(); };
  return <div class="modal-preview-backdrop" onClick={props.close}>
    <div class="modal-preview strip-picker" onClick={(event) => event.stopPropagation()}>
      <button class="modal-close" onClick={props.close}>×</button>
      <span class="eyebrow">STRIP GALLERY</span>
      <h3>Strip background</h3>
      <p class="panel-note">{message}</p>
      {remote && <div class="strip-grid">{remote.map((item) => <button key={item.url} class="strip-thumb" title={item.name} style={{ backgroundImage: `url("${item.url}")` }} onClick={() => applyImage(item.url)} />)}</div>}
      <p class="panel-note">Offline presets</p>
      <div class="strip-grid">
        {STRIP_PRESETS.map((preset) => <button key={preset.name} class="strip-thumb" title={preset.name} style={{ backgroundImage: preset.value }} onClick={() => { props.attr("src", ""); props.style("backgroundImage", preset.value); props.close(); }} />)}
      </div>
      <div class="manage-row">
        <button class="manage-primary" onClick={() => void browseMediaFile("image", (picked) => { props.attr("src", picked); props.style("backgroundImage", ""); props.close(); })}>Upload from computer…</button>
      </div>
    </div>
  </div>;
}

async function browseMediaFile(kind: "image" | "video" | "audio", apply: (picked: string) => void) {
  const filters = {
    image: [{ name: "Image files", extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "ico", "bmp"] }],
    video: [{ name: "Video files", extensions: ["mp4", "webm", "mov", "avi", "mkv"] }],
    audio: [{ name: "Audio files", extensions: ["mp3", "wav", "ogg", "m4a", "flac", "aac"] }],
  }[kind];
  const picked = await open({ multiple: false, filters });
  if (typeof picked === "string") apply(picked);
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
