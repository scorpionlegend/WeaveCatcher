import { invoke } from "@tauri-apps/api/core";

// localStorage keys mirrored into the backend settings.json (app config directory),
// so preferences survive webview-profile changes and ship with the machine's config.
const FILE_KEYS: Record<string, string> = {
  "visionweave-theme": "theme",
  "visionweave-layout": "layout",
  "visionweave-dock": "dock",
  "visionweave-split": "split",
  "visionweave-roots": "roots",
  "visionweave-lastroot": "lastRoot",
  "visionweave-autoupdate": "autoUpdate",
};

const pending = new Map<string, unknown>();
let saveTimer: number | undefined;

export function writeAppSetting(key: string, value: unknown) {
  const fileKey = FILE_KEYS[key];
  if (!fileKey) return;
  pending.set(fileKey, value);
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    for (const [settingKey, settingValue] of pending) {
      void invoke("save_app_setting", { key: settingKey, value: settingValue }).catch(() => { /* stay local-only */ });
    }
    pending.clear();
  }, 400);
}

export async function restoreAppSettings() {
  try {
    const settings = await invoke<Record<string, unknown>>("load_app_settings");
    for (const [localKey, fileKey] of Object.entries(FILE_KEYS)) {
      const value = settings[fileKey];
      if (value === undefined || value === null) continue;
      try { localStorage.setItem(localKey, typeof value === "string" ? value : JSON.stringify(value)); } catch { /* ignore */ }
    }
  } catch { /* first run or settings unavailable — localStorage is the fallback */ }
}
