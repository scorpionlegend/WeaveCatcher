import { writeAppSetting } from "./appsettings";

export type Theme = "light" | "dark";

const THEME_KEY = "visionweave-theme";

export function currentTheme(): Theme {
  return localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light";
}

export function applyTheme(): Theme {
  const theme = currentTheme();
  document.documentElement.dataset.theme = theme;
  return theme;
}

export function setTheme(theme: Theme) {
  localStorage.setItem(THEME_KEY, theme);
  document.documentElement.dataset.theme = theme;
  writeAppSetting(THEME_KEY, theme);
}
