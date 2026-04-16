import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

export const SHORTCUT_SECTIONS = [
  {
    title: "Navigation",
    description: "Press G then a letter",
    shortcuts: [
      { keys: ["G", "D"], label: "Dashboard" },
      { keys: ["G", "S"], label: "Sessions" },
      { keys: ["G", "A"], label: "Agents" },
      { keys: ["G", "G"], label: "Graph" },
      { keys: ["G", "L"], label: "Live" },
      { keys: ["G", "M"], label: "MCP Servers" },
      { keys: ["G", "P"], label: "Projects" },
      { keys: ["G", "K"], label: "Skills" },
    ],
  },
  {
    title: "Global",
    shortcuts: [
      { keys: ["Ctrl", "K"], label: "Search" },
      { keys: ["Ctrl", "L"], label: "Toggle sidebar" },
      { keys: ["?"], label: "Keyboard shortcuts" },
    ],
  },
];

function KeyBadge({ children }: { children: string }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[24px] h-6 px-1.5 rounded-md border border-border/60 bg-muted/50 text-[11px] font-mono font-medium text-muted-foreground shadow-[0_1px_0_1px_hsl(var(--border)/0.4)]">
      {children}
    </kbd>
  );
}

export function KeyboardShortcutsOverlay() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function handler(e: CustomEvent) {
      setOpen((prev) => !prev);
    }
    window.addEventListener("toggle-shortcuts-overlay" as any, handler);
    return () => window.removeEventListener("toggle-shortcuts-overlay" as any, handler);
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">Keyboard Shortcuts</DialogTitle>
          <DialogDescription className="sr-only">Available keyboard shortcuts</DialogDescription>
        </DialogHeader>
        <div className="space-y-5 mt-2">
          {SHORTCUT_SECTIONS.map((section) => (
            <div key={section.title}>
              <div className="flex items-center gap-2 mb-2.5">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  {section.title}
                </h3>
                {section.description && (
                  <span className="text-[10px] text-muted-foreground/50">{section.description}</span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                {section.shortcuts.map((shortcut) => (
                  <div
                    key={shortcut.label}
                    className="flex items-center justify-between gap-3"
                  >
                    <span className="text-sm text-foreground/80">{shortcut.label}</span>
                    <div className="flex items-center gap-1 shrink-0">
                      {shortcut.keys.map((key, i) => (
                        <span key={i} className="flex items-center gap-1">
                          {i > 0 && <span className="text-[10px] text-muted-foreground/40">+</span>}
                          <KeyBadge>{key}</KeyBadge>
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
