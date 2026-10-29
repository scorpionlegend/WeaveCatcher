import { render } from "preact";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import { SettingsApp } from "./Settings";
import { ReleaseNotesApp } from "./ReleaseNotes";
import { applyTheme } from "./theme";
import { restoreAppSettings } from "./appsettings";
import "./style.css";

const windowLabel = (() => {
  try { return getCurrentWindow().label; } catch { return window.location.hash === "#settings" ? "settings" : "main"; }
})();

const root = document.getElementById("app");
// Settings are restored from the machine's settings file before the first render so
// the dock layout and theme are correct from the first paint.
void restoreAppSettings().finally(() => {
  applyTheme();
  if (root) render(windowLabel === "settings" ? <SettingsApp /> : windowLabel === "release" ? <ReleaseNotesApp /> : <App />, root);
});
