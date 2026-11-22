import { useSyncExternalStore } from "react";

export type Theme = "light" | "dark";

const KEY = "travel-anywhere-theme";
const META_COLORS: Record<Theme, string> = { light: "#f4f6f5", dark: "#0f1a23" };

function storedTheme(): Theme | null {
  try {
    const t = localStorage.getItem(KEY);
    return t === "light" || t === "dark" ? t : null;
  } catch {
    return null;
  }
}

const systemQuery = window.matchMedia("(prefers-color-scheme: dark)");
const systemTheme = (): Theme => (systemQuery.matches ? "dark" : "light");

/*
 * The theme lives outside React. Switching it flips the `data-theme` attribute directly (so every CSS colour
 * changes in the same frame as the click), and only components that read `useTheme()` re-render: the toggle
 * and the map. The panel and its long destination list are untouched.
 */
let current: Theme = storedTheme() ?? systemTheme();
const listeners = new Set<() => void>();

function apply(theme: Theme) {
  const root = document.documentElement;
  // Hover/press colour transitions would otherwise make some elements fade while others snap.
  root.classList.add("theme-switching");
  root.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", META_COLORS[theme]);
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove("theme-switching")));
}

function set(theme: Theme, remember: boolean) {
  if (remember) {
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      /* private mode: the choice just won't be remembered */
    }
  }
  if (theme === current) return;
  current = theme;
  apply(theme);
  listeners.forEach((l) => l());
}

// Follow the system setting until the person picks a theme themselves.
systemQuery.addEventListener("change", () => {
  if (!storedTheme()) set(systemTheme(), false);
});

export function toggleTheme(): void {
  set(current === "dark" ? "light" : "dark", true);
}

export function useTheme(): Theme {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    () => current,
  );
}
