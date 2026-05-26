import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { applyTheme, getStoredTheme, saveThemePreference, type ThemePreference, watchSystemTheme } from "./themeService";

type ThemeContextValue = {
  theme: ThemePreference;
  setTheme: (theme: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemePreference>(() => getStoredTheme());

  function setTheme(themePreference: ThemePreference) {
    saveThemePreference(themePreference);
    applyTheme(themePreference);
    setThemeState(themePreference);
  }

  useEffect(() => {
    applyTheme(theme);
    return watchSystemTheme(() => {
      if (getStoredTheme() === "system") applyTheme("system");
    });
  }, [theme]);

  const value = useMemo(() => ({ theme, setTheme }), [theme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used inside ThemeProvider");
  return context;
}
