import { useEffect, useState } from "preact/hooks";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { getVersion } from "@tauri-apps/api/app";
import { setTheme, themePreference, type Theme } from "./theme";
import type { DocumentModel, EditIntent } from "./types";

const THEME_OPTIONS: { value: Theme; title: string; hint: string }[] = [
  { value: "light", title: "Light", hint: "Always light" },
  { value: "dark", title: "Dark", hint: "Always dark" },
  { value: "system", title: "System", hint: "Match the OS" },
];

export function SettingsApp() {
  const [documentModel, setDocumentModel] = useState<DocumentModel | null>(null);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [updateState, setUpdateState] = useState<"idle" | "checking" | "current" | "available" | "downloading">("idle");
  const [pendingUpdate, setPendingUpdate] = useState<Update | null>(null);
  const [updateProgress, setUpdateProgress] = useState("");
  const [appVersion, setAppVersion] = useState("");
  const [theme, setThemeState] = useState<Theme>(() => themePreference());

  useEffect(() => {
    let mounted = true;
    invoke<DocumentModel>("get_document").then((doc) => { if (mounted) setDocumentModel(doc); })
      .catch((cause: unknown) => { if (mounted) setError(String(cause)); });
    getVersion().then((version) => { if (mounted) setAppVersion(version); }).catch(() => {});
    const timer = window.setTimeout(() => void checkForUpdates(false), 2500);
    return () => { mounted = false; window.clearTimeout(timer); };
  }, []);

  useEffect(() => {
    if (!toast && !error) return;
    const timer = window.setTimeout(() => { setToast(""); setError(""); }, 2600);
    return () => window.clearTimeout(timer);
  }, [toast, error]);

  function showError(cause: unknown) {
    const message = cause instanceof Error ? cause.message : String(cause);
    setError(message);
  }

  async function mutate(intent: EditIntent) {
    try {
      setDocumentModel(await invoke<DocumentModel>("mutate_document", { intent }));
    } catch (cause) { showError(cause); }
  }

  async function openProject() {
    try {
      const path = await open({ multiple: false, filters: [{ name: "WeaveCatcher project", extensions: ["wc", "weavecatcher.json", "visionweave.json", "json"] }] });
      if (typeof path !== "string") return;
      setDocumentModel(await invoke<DocumentModel>("load_project", { path }));
      setToast("Project opened");
    } catch (cause) { showError(cause); }
  }

  async function saveProjectAs() {
    if (!documentModel) return;
    try {
      const picked = await save({ defaultPath: `${documentModel.name}.wc`, filters: [{ name: "WeaveCatcher project", extensions: ["wc"] }] });
      if (!picked) return;
      await invoke<string>("save_project", { path: picked });
      setToast("Project saved");
    } catch (cause) { showError(cause); }
  }

  async function openReleaseNotes() {
    try { await invoke("open_release_notes_window"); } catch (cause) { showError(cause); }
  }

  function pickTheme(next: Theme) {
    setTheme(next);
    setThemeState(next);
  }

  async function checkForUpdates(manual: boolean) {
    if (updateState === "checking" || updateState === "downloading") return;
    setUpdateState("checking");
    try {
      const update = await check();
      if (update) {
        setPendingUpdate(update);
        setUpdateState("available");
        if (manual) setToast(`Version ${update.version} is available`);
      } else {
        setPendingUpdate(null);
        setUpdateState("current");
        if (manual) setToast("Latest version is installed");
      }
    } catch (cause) {
      setUpdateState("idle");
      if (manual) showError(cause);
    }
  }

  async function installUpdate() {
    if (!pendingUpdate) return;
    setUpdateState("downloading");
    let downloaded = 0;
    let total = 0;
    try {
      await pendingUpdate.downloadAndInstall((event) => {
        if (event.event === "Started") total = event.data.contentLength ?? 0;
        else if (event.event === "Progress") downloaded += event.data.chunkLength;
        else if (event.event === "Finished") setUpdateProgress("Installing update…");
        if (event.event !== "Finished") setUpdateProgress(total ? `${Math.round((downloaded / total) * 100)}% of ${(total / 1048576).toFixed(1)} MB` : `${(downloaded / 1048576).toFixed(1)} MB downloaded`);
      });
      setUpdateProgress("Restarting…");
      await relaunch();
    } catch (cause) {
      setUpdateState("available");
      setUpdateProgress("");
      showError(cause);
    }
  }

  if (!documentModel) return <main class="settings-window"><div class="panel-content settings-panel"><p class="muted-copy">{error || "Loading settings…"}</p></div></main>;

  return <main class="settings-window">
    <div class="panel-content settings-panel">
      <p class="section-label">PROJECT</p>
      <label class="field-label">Project name<input value={documentModel.name} onChange={(event) => void mutate({ type: "rename_project", name: event.currentTarget.value })} /></label>
      <button class="wide-row" onClick={() => void openProject()}><span>Open another project</span><b>↗</b></button>
      <button class="wide-row" onClick={() => void saveProjectAs()}><span>Save project as…</span><b>⇩</b></button>
      <p class="section-label separated">APPEARANCE</p>
      <div class="theme-choice">
        {THEME_OPTIONS.map((option) => <button key={option.value} class={theme === option.value ? "chosen" : ""} onClick={() => pickTheme(option.value)}><strong>{option.title}</strong><small>{option.hint}</small></button>)}
      </div>
      <p class="section-label separated">UPDATES</p>
      {pendingUpdate ? <div class="update-card"><strong>Version {pendingUpdate.version} is available{appVersion ? ` · you have ${appVersion}` : ""}</strong>{pendingUpdate.body && <p class="muted-copy">{pendingUpdate.body.length > 220 ? `${pendingUpdate.body.slice(0, 220)}…` : pendingUpdate.body}</p>}<button class="primary-button update-action" disabled={updateState === "downloading"} onClick={() => void installUpdate()}>{updateState === "downloading" ? updateProgress || "Downloading…" : "⇩ Download & restart"}</button></div> : <div class="update-card"><p class="muted-copy">{updateState === "checking" ? "Checking for updates…" : updateState === "current" ? "Latest version is installed." : "WeaveCatcher checks for updates when it starts."}</p><button class="wide-row" disabled={updateState === "checking"} onClick={() => void checkForUpdates(true)}><span>Check for updates</span><b>↻</b></button></div>}
      <button class="wide-row" onClick={() => void openReleaseNotes()}><span>View release — what's new</span><b>▷</b></button>
      <p class="settings-footnote">WeaveCatcher {appVersion || "0.1"} · Project format v1</p>
    </div>
    {(toast || error) && <div class={`toast ${error ? "toast-error" : ""}`} role="status">{error ? <span>!</span> : <span>✓</span>}{error || toast}<button onClick={() => { setError(""); setToast(""); }}>×</button></div>}
  </main>;
}
