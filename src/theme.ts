import { writeAppSetting } from "./appsettings";

export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const THEME_KEY = "visionweave-theme";
const SCHEME_QUERY = "(prefers-color-scheme: dark)";

export function themePreference(): Theme {
  const stored = localStorage.getItem(THEME_KEY);
  return stored === "dark" || stored === "light" || stored === "system" ? stored : "system";
}

export function systemTheme(): ResolvedTheme {
  return window.matchMedia?.(SCHEME_QUERY).matches ? "dark" : "light";
}

export function resolveTheme(theme: Theme): ResolvedTheme {
  return theme === "system" ? systemTheme() : theme;
}

export function applyTheme(): ResolvedTheme {
  const resolved = resolveTheme(themePreference());
  document.documentElement.dataset.theme = resolved;
  watchSystemTheme();
  return resolved;
}

export function setTheme(theme: Theme) {
  localStorage.setItem(THEME_KEY, theme);
  writeAppSetting(THEME_KEY, theme);
  applyTheme();
}

// Follows live OS theme changes while running, so "System" tracks without a restart.
let watching = false;
function watchSystemTheme() {
  if (watching || !window.matchMedia) return;
  watching = true;
  window.matchMedia(SCHEME_QUERY).addEventListener("change", () => { applyTheme(); });
}
