"use client";

import { useEffect } from "react";
import { useApp } from "./AppProvider";

type Theme = "dark" | "light" | "system";

/** Resolve "system" against the OS preference. */
export function resolvedTheme(theme: Theme): "dark" | "light" {
  if (theme !== "system") return theme;
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function applyTheme(theme: Theme) {
  const resolved = resolvedTheme(theme);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
}

/**
 * Inline script that sets the theme before the first paint.
 *
 * It reads the cookie the server writes whenever the saved preference changes,
 * so there is no flash of the wrong theme on load. `localStorage` is the fast
 * path for the same reason; the cookie keeps it working before hydration on a
 * fresh browser.
 */
export const THEME_SCRIPT = `(function(){try{
var m=document.cookie.match(/(?:^|;\\s*)theme=(dark|light|system)/);
var t=m?m[1]:(localStorage.getItem("theme")||"dark");
var r=t==="system"?(window.matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"):t;
document.documentElement.dataset.theme=r;
document.documentElement.style.colorScheme=r;
}catch(e){}})();`;

/**
 * Keeps the document in step with the saved preference: applies it, follows the
 * OS while the mode is "system", and mirrors it into the cookie + localStorage
 * so the next load paints correctly before React runs.
 */
export function ThemeSync() {
  const app = useApp();
  const theme = app.settings.theme ?? "dark";

  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem("theme", theme);
      document.cookie = `theme=${theme}; path=/; max-age=31536000; samesite=lax`;
    } catch {
      // Private mode with storage blocked: the attribute is still correct.
    }
  }, [theme]);

  useEffect(() => {
    if (theme !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => applyTheme("system");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [theme]);

  return null;
}
