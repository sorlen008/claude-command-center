import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useScanStatus } from "@/hooks/use-entities";
import { useAppSettings, useUpdateSettings } from "@/hooks/use-settings";
import { SearchTrigger } from "@/components/global-search";
import { SyncIndicator } from "@/components/sync-indicator";
import { UpdateIndicator } from "@/components/update-indicator";
import { ThemeSwitcher } from "@/components/theme-switcher";
import {
  LayoutDashboard,
  FolderOpen,
  Server,
  Wand2,
  Puzzle,
  FileText,
  GitBranch,
  Search,
  Settings,
  SlidersHorizontal,
  Terminal,
  ChevronLeft,
  ChevronRight,
  Activity,
  MessageSquare,
  Bot,
  Radio,
  BarChart3,
} from "lucide-react";
import { useState, useEffect, useRef } from "react";

const navSections = [
  {
    label: "Overview",
    items: [
      { path: "/", label: "Dashboard", icon: LayoutDashboard, countKey: null },
    ],
  },
  {
    label: "Entities",
    items: [
      { path: "/projects", label: "Projects", icon: FolderOpen, countKey: "project" as const },
      { path: "/mcps", label: "MCP Servers", icon: Server, countKey: "mcp" as const },
      { path: "/skills", label: "Skills", icon: Wand2, countKey: "skill" as const },
      { path: "/plugins", label: "Plugins", icon: Puzzle, countKey: "plugin" as const },
      { path: "/markdown", label: "Markdown", icon: FileText, countKey: "markdown" as const },
    ],
  },
  {
    label: "Tools",
    items: [
      { path: "/sessions", label: "Sessions", icon: MessageSquare, countKey: "session" as const },
      { path: "/agents", label: "Agents", icon: Bot, countKey: "agent" as const },
      { path: "/live", label: "Live", icon: Radio, countKey: null },
      { path: "/graph", label: "Graph", icon: GitBranch, countKey: null },
      { path: "/discovery", label: "Discovery", icon: Search, countKey: null },
      { path: "/config", label: "Config", icon: Settings, countKey: "config" as const },
      { path: "/activity", label: "Activity", icon: Activity, countKey: null },
      { path: "/stats", label: "Stats", icon: BarChart3, countKey: null },
      { path: "/settings", label: "Settings", icon: SlidersHorizontal, countKey: null },
    ],
  },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { data: status } = useScanStatus();
  const { data: settings } = useAppSettings();
  const updateSettings = useUpdateSettings();
  const [collapsed, setCollapsed] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [editName, setEditName] = useState("");
  const nameInputRef = useRef<HTMLInputElement>(null);
  const counts = (status?.entityCounts || {}) as Record<string, number>;
  const isScanning = status?.scanning;
  const appName = settings?.appName || "Command Center";

  const startEditing = () => {
    setEditName(appName);
    setEditingName(true);
    setTimeout(() => nameInputRef.current?.select(), 0);
  };

  const saveName = () => {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== appName) {
      updateSettings.mutate({ appName: trimmed });
    }
    setEditingName(false);
  };

  // Keyboard shortcut for collapse
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "l") {
        e.preventDefault();
        setCollapsed((c) => !c);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className={cn(
        "border-r flex flex-col transition-all duration-200 relative bg-sidebar",
        collapsed ? "w-14" : "w-56"
      )}>
        {/* Top gradient accent line */}
        <div className="h-px bg-gradient-to-r from-blue-500/40 via-purple-500/30 to-transparent" />
        {/* Scan progress bar */}
        {isScanning && (
          <div className="absolute top-0 left-0 right-0 h-0.5 z-10">
            <div className="h-full bg-blue-500 animate-shimmer" style={{ width: "100%", backgroundSize: "200% 100%", background: "linear-gradient(90deg, transparent, hsl(217 91% 60%), transparent)" }} />
          </div>
        )}

        {/* Brand */}
        <div className={cn("flex items-center gap-2.5 h-14", collapsed ? "px-3 justify-center" : "px-4")}>
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shrink-0 shadow-[0_0_12px_rgba(99,102,241,0.3)] ring-1 ring-blue-400/20">
            <Terminal className="h-4 w-4 text-white" />
          </div>
          {!collapsed && (
            editingName ? (
              <input
                ref={nameInputRef}
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onBlur={saveName}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveName();
                  if (e.key === "Escape") setEditingName(false);
                }}
                maxLength={50}
                className="font-semibold text-sm bg-transparent border-b border-blue-500 outline-none flex-1 min-w-0"
              />
            ) : (
              <span
                className="font-semibold text-sm whitespace-nowrap flex-1 cursor-pointer hover:text-blue-400 transition-colors"
                onClick={startEditing}
                title="Click to rename"
              >
                {appName}
              </span>
            )
          )}
        </div>
        <div className="mx-3 h-px bg-gradient-to-r from-transparent via-border/40 to-transparent" />

        {/* Search trigger */}
        <div className="p-2">
          <SearchTrigger collapsed={collapsed} />
        </div>

        <ScrollArea className="flex-1">
          <nav className="px-2 space-y-4 pb-2">
            {navSections.map((section) => (
              <div key={section.label}>
                {!collapsed && (
                  <div className="px-3 py-1.5 text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-widest section-header">
                    {section.label}
                  </div>
                )}
                {collapsed && <div className="h-2" />}
                <div className="space-y-0.5">
                  {section.items.map((item) => {
                    const isActive =
                      item.path === "/"
                        ? location === "/"
                        : location.startsWith(item.path);
                    const count = item.countKey === "session"
                      ? (status as any)?.sessionCount
                      : item.countKey === "agent"
                      ? (status as any)?.agentCount
                      : item.countKey ? counts[item.countKey] : null;

                    const navContent = (
                      <Link key={item.path} href={item.path}>
                        <div
                          className={cn(
                            "flex items-center rounded-md px-3 py-2 text-sm transition-all duration-150 cursor-pointer group relative",
                            collapsed ? "justify-center" : "gap-2.5",
                            isActive
                              ? "bg-gradient-to-r from-blue-500/15 via-purple-500/10 to-transparent text-sidebar-accent-foreground font-medium"
                              : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground hover:translate-x-0.5 hover:shadow-[inset_0_0_12px_rgba(59,130,246,0.06)]"
                          )}
                        >
                          {/* Active indicator pill */}
                          {isActive && (
                            <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-gradient-to-b from-blue-400 to-purple-500 shadow-[0_0_8px_rgba(99,102,241,0.4)]" />
                          )}
                          <item.icon className={cn("h-4 w-4 flex-shrink-0", isActive && "text-blue-400")} />
                          {!collapsed && (
                            <>
                              <span className="flex-1">{item.label}</span>
                              {count != null && count > 0 && (
                                <span className="text-[10px] font-mono text-muted-foreground tabular-nums">
                                  {count}
                                </span>
                              )}
                            </>
                          )}
                          {collapsed && isActive && (
                            <div className="absolute -right-0.5 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-blue-400" />
                          )}
                        </div>
                      </Link>
                    );

                    if (collapsed) {
                      return (
                        <Tooltip key={item.path}>
                          <TooltipTrigger asChild>
                            {navContent}
                          </TooltipTrigger>
                          <TooltipContent side="right" className="text-xs">
                            {item.label}
                            {count != null && count > 0 && (
                              <span className="ml-1.5 font-mono text-muted-foreground">({count})</span>
                            )}
                          </TooltipContent>
                        </Tooltip>
                      );
                    }
                    return navContent;
                  })}
                </div>
              </div>
            ))}
          </nav>
        </ScrollArea>
        <div className="mx-3 h-px bg-gradient-to-r from-transparent via-border/40 to-transparent" />
        <UpdateIndicator collapsed={collapsed} />
        <div className="mx-3 h-px bg-gradient-to-r from-transparent via-border/40 to-transparent" />
        <SyncIndicator collapsed={collapsed} />
        <div className="mx-3 h-px bg-gradient-to-r from-transparent via-border/40 to-transparent" />
        <ThemeSwitcher collapsed={collapsed} />
        <div className="mx-3 h-px bg-gradient-to-r from-transparent via-border/40 to-transparent" />
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center justify-center h-10 text-muted-foreground hover:text-foreground transition-colors"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <div className="page-enter">
          {children}
        </div>
      </main>
    </div>
  );
}
