import { useState, useEffect, useCallback, useMemo } from "react";
import { useLocation } from "wouter";
import { useEntities } from "@/hooks/use-entities";
import { EntityIcon, entityConfig } from "@/components/entity-badge";
import { Badge } from "@/components/ui/badge";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
} from "@/components/ui/command";
import { Search, Clock } from "lucide-react";
import type { Entity, EntityType } from "@shared/types";

function getEntityRoute(entity: Entity): string {
  switch (entity.type) {
    case "project": return `/projects/${entity.id}`;
    case "mcp": return "/mcps";
    case "skill": return "/skills";
    case "plugin": return "/plugins";
    case "markdown": return `/markdown/${entity.id}`;
    case "config": return "/config";
    default: return "/";
  }
}

const RECENT_KEY = "cc-recent-searches";
const MAX_RECENT = 5;

function getRecentSearches(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]").slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

function addRecentSearch(term: string) {
  try {
    const recent = getRecentSearches().filter((r) => r !== term);
    recent.unshift(term);
    localStorage.setItem(RECENT_KEY, JSON.stringify(recent.slice(0, MAX_RECENT)));
  } catch {}
}

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [, setLocation] = useLocation();
  const { data: entities } = useEntities();
  const [recentSearches, setRecentSearches] = useState<string[]>(getRecentSearches);
  const [typeFilter, setTypeFilter] = useState<EntityType | null>(null);

  // Filter results
  const results = useMemo(() => {
    if (query.length === 0) return [];
    const q = query.toLowerCase();
    return (entities || [])
      .filter((e) => {
        if (typeFilter && e.type !== typeFilter) return false;
        return (
          e.name.toLowerCase().includes(q) ||
          (e.description || "").toLowerCase().includes(q) ||
          e.path.toLowerCase().includes(q) ||
          e.type.includes(q)
        );
      })
      .slice(0, 20);
  }, [query, entities, typeFilter]);

  // Group results by type
  const groupedResults = useMemo(() => {
    const groups: Record<string, Entity[]> = {};
    for (const entity of results) {
      if (!groups[entity.type]) groups[entity.type] = [];
      groups[entity.type].push(entity);
    }
    return groups;
  }, [results]);

  // Keyboard shortcut to open
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setOpen(true);
        setQuery("");
        setTypeFilter(null);
        setRecentSearches(getRecentSearches());
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const navigate = useCallback((entity: Entity) => {
    setOpen(false);
    if (query) addRecentSearch(query);
    setQuery("");
    setLocation(getEntityRoute(entity));
  }, [setLocation, query]);

  const allTypes: EntityType[] = ["project", "mcp", "skill", "plugin", "markdown", "config"];

  return (
    <>
      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput
          placeholder="Search entities..."
          value={query}
          onValueChange={setQuery}
        />

        {/* Type filter pills */}
        <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border">
          <button
            className={`text-[10px] px-2 py-0.5 rounded-full transition-colors ${!typeFilter ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/50"}`}
            onClick={() => setTypeFilter(null)}
          >
            All
          </button>
          {allTypes.map((type) => (
            <button
              key={type}
              className={`text-[10px] px-2 py-0.5 rounded-full transition-colors ${typeFilter === type ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/50"}`}
              onClick={() => setTypeFilter(typeFilter === type ? null : type)}
            >
              {entityConfig[type].label}
            </button>
          ))}
        </div>

        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>

          {/* Recent searches */}
          {query.length === 0 && recentSearches.length > 0 && (
            <CommandGroup heading="Recent">
              {recentSearches.map((term) => (
                <CommandItem
                  key={term}
                  value={`recent-${term}`}
                  onSelect={() => setQuery(term)}
                  className="gap-2"
                >
                  <Clock className="h-3 w-3 text-muted-foreground" />
                  <span className="text-sm">{term}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {/* Grouped results */}
          {Object.entries(groupedResults).map(([type, typeEntities]) => (
            <CommandGroup key={type} heading={entityConfig[type as EntityType]?.label + "s"}>
              {typeEntities.map((entity) => (
                <CommandItem
                  key={entity.id}
                  value={`${entity.name} ${entity.description || ""} ${entity.path}`}
                  onSelect={() => navigate(entity)}
                  className="gap-2"
                >
                  <EntityIcon type={entity.type} className="h-4 w-4 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{entity.name}</div>
                    {entity.description && (
                      <div className="text-[11px] text-muted-foreground truncate">{entity.description}</div>
                    )}
                  </div>
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 flex-shrink-0">
                    {entity.type}
                  </Badge>
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>

        {/* Footer */}
        {results.length > 0 && (
          <div className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground flex items-center justify-between">
            <span>{results.length} result{results.length !== 1 ? "s" : ""}</span>
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1"><kbd className="px-1 py-0.5 bg-muted rounded text-[10px]">↑↓</kbd> Navigate</span>
              <span className="flex items-center gap-1"><kbd className="px-1 py-0.5 bg-muted rounded text-[10px]">Enter</kbd> Open</span>
              <span className="flex items-center gap-1"><kbd className="px-1 py-0.5 bg-muted rounded text-[10px]">Esc</kbd> Close</span>
            </div>
          </div>
        )}
      </CommandDialog>
    </>
  );
}

export function SearchTrigger({ collapsed }: { collapsed: boolean }) {
  const trigger = () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));
  };

  return (
    <button
      onClick={trigger}
      className="flex items-center gap-2 w-full rounded-md px-3 py-2 text-sm text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground transition-colors"
      title="Search (Ctrl+K)"
      aria-label="Open search"
    >
      <Search className="h-4 w-4 flex-shrink-0" />
      {!collapsed && (
        <>
          <span className="flex-1 text-left">Search</span>
          <kbd className="text-[10px] font-mono text-muted-foreground bg-muted px-1 py-0.5 rounded">
            Ctrl+K
          </kbd>
        </>
      )}
    </button>
  );
}
