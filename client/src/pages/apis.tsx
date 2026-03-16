import { useApis, useApiStats } from "@/hooks/use-apis";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { useLocation } from "wouter";
import {
  Search,
  Globe,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  Tag,
  RefreshCw,
  Shield,
  Key,
  Wifi,
  WifiOff,
} from "lucide-react";
import { useRescan } from "@/hooks/use-entities";
import { ListSkeleton } from "@/components/skeleton";
import type { ApiDefinition } from "@shared/types";

const CATEGORY_COLORS: Record<string, string> = {
  voice: "border-emerald-500/30 text-emerald-400",
  communication: "border-sky-500/30 text-sky-400",
  google: "border-blue-500/30 text-blue-400",
  infrastructure: "border-orange-500/30 text-orange-400",
  "ai-llm": "border-violet-500/30 text-violet-400",
  design: "border-pink-500/30 text-pink-400",
  database: "border-amber-500/30 text-amber-400",
};

const CATEGORY_LABELS: Record<string, string> = {
  voice: "Voice",
  communication: "Communication",
  google: "Google Services",
  infrastructure: "Infrastructure",
  "ai-llm": "AI / LLM",
  design: "Design & Dev Tools",
  database: "Database",
};

const CATEGORY_BG: Record<string, string> = {
  voice: "bg-emerald-500/10 text-emerald-400",
  communication: "bg-sky-500/10 text-sky-400",
  google: "bg-blue-500/10 text-blue-400",
  infrastructure: "bg-orange-500/10 text-orange-400",
  "ai-llm": "bg-violet-500/10 text-violet-400",
  design: "bg-pink-500/10 text-pink-400",
  database: "bg-amber-500/10 text-amber-400",
};

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-500",
  configured: "bg-amber-500",
  inactive: "bg-slate-500",
  "via-proxy": "bg-blue-500",
};

const AUTH_LABELS: Record<string, string> = {
  "api-key": "API Key",
  oauth2: "OAuth 2.0",
  sdk: "SDK",
  none: "None",
  cdp: "CDP",
  mcp: "MCP",
};

export default function APIs() {
  const { data: apis, isLoading } = useApis();
  const { data: stats } = useApiStats();
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [groupByCategory, setGroupByCategory] = useState(true);
  const rescan = useRescan();
  const [, setLocation] = useLocation();

  const filtered = (apis || []).filter(
    (a) =>
      a.name.toLowerCase().includes(search.toLowerCase()) ||
      a.description?.toLowerCase().includes(search.toLowerCase()) ||
      a.category.toLowerCase().includes(search.toLowerCase()) ||
      (a.baseUrl || "").toLowerCase().includes(search.toLowerCase())
  );

  const grouped = groupByCategory
    ? filtered.reduce<Record<string, ApiDefinition[]>>((acc, api) => {
        const cat = api.category || "other";
        (acc[cat] = acc[cat] || []).push(api);
        return acc;
      }, {})
    : null;

  const categoryOrder = ["voice", "communication", "google", "infrastructure", "database", "design", "ai-llm"];

  const renderCard = (api: ApiDefinition, i: number) => {
    const isExpanded = expanded === api.id;
    return (
      <Card
        key={api.id}
        className="group card-hover animate-fade-in-up cursor-pointer"
        style={{ animationDelay: `${i * 40}ms` }}
        onClick={() => setExpanded(isExpanded ? null : api.id)}
      >
        <CardContent className="p-5">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-3">
              <div
                className="rounded-lg p-2 mt-0.5 transition-shadow group-hover:shadow-[0_0_12px_rgba(245,158,11,0.15)]"
                style={{ backgroundColor: `${api.color || "#f97316"}20` }}
              >
                <Globe className="h-5 w-5" style={{ color: api.color || "#f97316" }} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{api.name}</span>
                  <span
                    className={`w-2 h-2 rounded-full ${STATUS_COLORS[api.status] || "bg-slate-500"}`}
                    title={api.status}
                  />
                  <Badge
                    variant="outline"
                    className={`text-[10px] ${CATEGORY_COLORS[api.category] || "border-slate-500/30 text-slate-400"}`}
                  >
                    {CATEGORY_LABELS[api.category] || api.category}
                  </Badge>
                  <Badge variant="outline" className="text-[10px] border-slate-500/30 text-slate-400">
                    <Key className="h-2.5 w-2.5 mr-1" />
                    {AUTH_LABELS[api.authMethod] || api.authMethod}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{api.description}</p>
                {api.baseUrl && (
                  <code className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded font-mono mt-1.5 inline-block">
                    {api.baseUrl}
                  </code>
                )}
              </div>
            </div>

            <div className="text-right space-y-1.5 flex-shrink-0">
              {api.envKeys && api.envKeys.length > 0 && (
                <div className="flex gap-1 justify-end flex-wrap">
                  {api.envKeys.map((key) => (
                    <Badge key={key} variant="secondary" className="text-[10px] px-1.5 font-mono">
                      {key}
                    </Badge>
                  ))}
                </div>
              )}
              {api.consumers.length > 0 && (
                <div className="flex gap-1 justify-end flex-wrap">
                  {api.consumers.map((c) => (
                    <Badge
                      key={c}
                      variant="outline"
                      className="text-[10px] px-1.5 border-blue-500/30 text-blue-400 cursor-pointer hover:bg-blue-500/10"
                      onClick={(e) => {
                        e.stopPropagation();
                        setLocation("/graph");
                      }}
                    >
                      {c.replace("config-", "")}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Expand indicator */}
          {(api.notes || api.website) && (
            <div className="flex items-center justify-center mt-2 text-muted-foreground/50">
              {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </div>
          )}

          {/* Expanded details */}
          {isExpanded && (
            <div className="mt-3 pt-3 border-t border-border/50 space-y-2">
              {api.notes && (
                <p className="text-xs text-muted-foreground">{api.notes}</p>
              )}
              <div className="flex items-center gap-3">
                {api.website && (
                  <a
                    href={api.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] text-blue-400 hover:text-blue-300"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {api.website} <ExternalLink className="h-2.5 w-2.5" />
                  </a>
                )}
                <button
                  className="inline-flex items-center gap-1 text-[11px] text-amber-400 hover:text-amber-300"
                  onClick={(e) => {
                    e.stopPropagation();
                    setLocation("/graph");
                  }}
                >
                  View in Graph <ExternalLink className="h-2.5 w-2.5" />
                </button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">APIs</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {filtered.length} external APIs and services powering the ecosystem
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setGroupByCategory(!groupByCategory)}
            className={`flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border font-medium transition-colors ${
              groupByCategory
                ? "border-blue-500/40 bg-blue-500/10 text-blue-400"
                : "border-border text-muted-foreground hover:text-foreground hover:bg-muted/50"
            }`}
          >
            <Tag className="h-3.5 w-3.5" />
            {groupByCategory ? "Grouped by Category" : "Group by Category"}
          </button>
          <div className="relative w-64">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search APIs..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>
      </div>

      {/* Category stat cards */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          {categoryOrder.map((cat) => {
            const count = stats.byCategory[cat] || 0;
            if (count === 0) return null;
            return (
              <Card key={cat} className="card-hover">
                <CardContent className="p-3 text-center">
                  <div className={`text-2xl font-bold ${CATEGORY_BG[cat]?.split(" ")[1] || "text-foreground"}`}>
                    {count}
                  </div>
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider mt-0.5">
                    {CATEGORY_LABELS[cat] || cat}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Status summary */}
      {stats && (
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Wifi className="h-3.5 w-3.5 text-green-400" />
            {stats.byStatus.active || 0} active
          </span>
          <span className="flex items-center gap-1.5">
            <Shield className="h-3.5 w-3.5 text-amber-400" />
            {stats.byStatus.configured || 0} configured
          </span>
          {stats.byStatus.inactive > 0 && (
            <span className="flex items-center gap-1.5">
              <WifiOff className="h-3.5 w-3.5 text-slate-400" />
              {stats.byStatus.inactive} inactive
            </span>
          )}
        </div>
      )}

      {/* Content */}
      {isLoading ? (
        <ListSkeleton rows={6} />
      ) : grouped ? (
        <div className="space-y-6">
          {categoryOrder
            .filter((cat) => grouped[cat]?.length > 0)
            .map((category) => (
              <div key={category} className="space-y-3">
                <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-2 section-header">
                  <Globe className="h-3.5 w-3.5" />
                  {CATEGORY_LABELS[category] || category}
                  <Badge variant="secondary" className="text-[10px] ml-1">
                    {grouped[category].length}
                  </Badge>
                </h2>
                {grouped[category].map((api, i) => renderCard(api, i))}
              </div>
            ))}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((api, i) => renderCard(api, i))}
          {filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 space-y-4">
              <Globe className="h-12 w-12 text-muted-foreground/30" />
              <div className="text-center space-y-1">
                <p className="text-muted-foreground font-medium">No APIs found</p>
                <p className="text-xs text-muted-foreground/70">
                  Configure APIs in ~/apis-config.yaml
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => rescan.mutate()}
                disabled={rescan.isPending}
                className="gap-1.5"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${rescan.isPending ? "animate-spin" : ""}`} />
                Rescan
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
