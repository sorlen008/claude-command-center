import { useEffect, useRef } from "react";
import { useLocation } from "wouter";

const shortcuts: Record<string, string> = {
  d: "/",          // g+d → dashboard
  s: "/sessions",  // g+s → sessions
  a: "/agents",    // g+a → agents
  g: "/graph",     // g+g → graph
  l: "/live",      // g+l → live
  m: "/mcps",      // g+m → mcps
  p: "/projects",  // g+p → projects
  k: "/skills",    // g+k → skills
};

export function useKeyboardShortcuts() {
  const [, setLocation] = useLocation();
  const pendingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      // Don't fire when focused on inputs
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if ((e.target as HTMLElement)?.isContentEditable) return;

      const key = e.key;

      // ? key toggles the keyboard shortcuts overlay
      if (key === "?" || (e.shiftKey && key === "/")) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("toggle-shortcuts-overlay"));
        return;
      }

      const lowerKey = key.toLowerCase();

      if (pendingRef.current) {
        // Second key in the sequence
        pendingRef.current = false;
        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
        const path = shortcuts[lowerKey];
        if (path) {
          e.preventDefault();
          setLocation(path);
        }
        return;
      }

      if (lowerKey === "g" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // First key: start the sequence
        pendingRef.current = true;
        timerRef.current = setTimeout(() => {
          pendingRef.current = false;
          timerRef.current = null;
        }, 500);
      }
    }

    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [setLocation]);
}
