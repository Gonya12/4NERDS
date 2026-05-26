export type ThemePreference = "light" | "dark" | "system";

const themeKey = "four_nerds_theme";
const systemQuery = "(prefers-color-scheme: dark)";

export function getStoredTheme(): ThemePreference {
  const stored = localStorage.getItem(themeKey);
  return stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
}

export function saveThemePreference(theme: ThemePreference) {
  localStorage.setItem(themeKey, theme);
}

export function getResolvedTheme(theme: ThemePreference) {
  if (theme === "system") return window.matchMedia(systemQuery).matches ? "dark" : "light";
  return theme;
}

export function applyTheme(theme: ThemePreference) {
  const resolved = getResolvedTheme(theme);
  document.documentElement.classList.toggle("dark", resolved === "dark");
  document.documentElement.style.colorScheme = resolved;
}

export function initializeTheme() {
  applyTheme(getStoredTheme());
}

export function watchSystemTheme(onChange: () => void) {
  const media = window.matchMedia(systemQuery);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}
