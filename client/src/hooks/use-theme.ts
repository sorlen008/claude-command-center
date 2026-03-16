import { useState, useEffect, useCallback } from "react";

const STORAGE_KEY = "cc-theme";
const THEMES = ["dark", "light", "glass", "system"] as const;
export type Theme = (typeof THEMES)[number];

function getSystemTheme(): "dark" | "light" {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function getStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && THEMES.includes(stored as Theme)) {
      return stored as Theme;
    }
  } catch {
    // localStorage unavailable
  }
  return "dark";
}

function resolveTheme(theme: Theme): "dark" | "light" | "glass" {
  if (theme === "system") {
    return getSystemTheme();
  }
  return theme;
}

function applyTheme(theme: Theme) {
  const resolved = resolveTheme(theme);
  const root = document.documentElement;

  // Set data-theme attribute
  root.setAttribute("data-theme", resolved);

  // Manage the .dark class for tailwind darkMode: ["class"] compatibility
  if (resolved === "dark" || resolved === "glass") {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(getStoredTheme);

  const setTheme = useCallback((newTheme: Theme) => {
    setThemeState(newTheme);
    try {
      localStorage.setItem(STORAGE_KEY, newTheme);
    } catch {
      // localStorage unavailable
    }
    applyTheme(newTheme);
  }, []);

  // Apply theme on mount
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Listen for system preference changes when theme is "system"
  useEffect(() => {
    if (theme !== "system") return;

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme("system");

    mediaQuery.addEventListener("change", handler);
    return () => mediaQuery.removeEventListener("change", handler);
  }, [theme]);

  return {
    theme,
    setTheme,
    themes: THEMES,
    resolvedTheme: resolveTheme(theme),
  };
}
