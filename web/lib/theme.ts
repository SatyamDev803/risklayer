"use client";

import { useCallback, useEffect, useState } from "react";

export type Theme = "system" | "light" | "dark";
const KEY = "risklayer.theme";

function apply(theme: Theme) {
  const root = document.documentElement;
  if (theme === "system") delete root.dataset.theme;
  else root.dataset.theme = theme;
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>("system");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved === "light" || saved === "dark") setThemeState(saved);
    } catch {
      /* storage unavailable: follow the system */
    }
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    apply(next);
    try {
      if (next === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, next);
    } catch {
      /* the choice lasts for this page only */
    }
  }, []);

  return { theme, setTheme };
}
