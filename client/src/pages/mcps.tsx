import { useEntities } from "@/hooks/use-entities";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { HealthIndicator } from "@/components/health-indicator";
import { useState } from "react";
import { Search, Server, Copy, Check, ExternalLink, ChevronDown, ChevronRight, Tag } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { ListSkeleton } from "@/components/skeleton";

const CATEGORY_COLORS: Record<string, string> = {
  data: "border-cyan-500/30 text-cyan-400",
  "dev-tools": "border-violet-500/30 text-violet-400",
  integration: "border-pink-500/30 text-pink-400",
  ai: "border-emerald-500/30 text-emerald-400",
  browser: "border-amber-500/30 text-amber-400",
  productivity: "border-sky-500/30 text-sky-400",
};

export default function MCPs() {
  const { data: mcps, isLoading } = useEntities("mcp");
  const [search, setSearch] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [groupByCategory, setGroupByCategory] = useState(false);

  const filtered = (mcps || []).filter(
    (m) =>
      m.name.toLowerCase().includes(search.toLowerCase()) ||
      m.path.toLowerCase().includes(search.toLowerCase()) ||
      m.description?.toLowerCase().includes(search.toLowerCase())
  );

  const handleCopyCommand = (mcp: any, e: React.MouseEvent) => {
    e.stopPropagation();
    const data = mcp.data as any;
    const cmd = data.command ? `${data.command} ${(data.args || []).join(" ")}` : data.url || "";
    navigator.clipboard.writeText(cmd.trim());
    setCopiedId(mcp.id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const handleOpenSource = async (sourcePath: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await apiRequest("POST", "/api/actions/open-file", { path: sourcePath });
    } catch {}
  };

  const basename = (path: string) => {
    const parts = path.replace(/\\/g, "/").split("/");
    return parts.length > 1 ? `${parts[parts.length - 2]}/${parts[parts.length - 1]}` : parts[parts.length - 1];
  };

  // Group by category
  const grouped = groupByCategory
    ? filtered.reduce<Record<string, typeof filtered>>((acc, mcp) => {
        const cat = (mcp.data as any).category || "other";
        (acc[cat] = acc[cat] || []).push(mcp);
        return acc;
      }, {})
    : null;

  const categoryLabel = (cat: string) => {
    const labels: Record<string, string> = {
      data: "Data & Databases",
      "dev-tools": "Developer Tools",
      integration: "Integrations",
      ai: "AI & ML",
      browser: "Browser",
      productivity: "Productivity",
      other: "Other",
    };
    return labels[cat] || cat;
  };

  const renderCard = (mcp: any, i: number) => {
    const data = mcp.data as any;
    const isExpanded = expanded === mcp.id;
    return (
      <Card
        key={mcp.id}
        className="group card-hover animate-fade-in-up cursor-pointer"
        style={{ animationDelay: `${i * 40}ms` }}
        onClick={() => setExpanded(isExpanded ? null : mcp.id)}
      >
        <CardContent className="p-5">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-3">
              <div className="rounded-lg bg-green-500/10 p-2 mt-0.5 relative">
                <Server className="h-5 w-5 text-green-400" />
                <span
                  className={`absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-card ${
                    data.transport === "stdio" ? "bg-green-500 pulse-ring" : "bg-amber-500"
                  }`}
                  style={{ color: data.transport === "stdio" ? "#22c55e40" : "#f59e0b40" }}
                />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{mcp.name}</span>
                  <HealthIndicator health={mcp.health} />
                  <Badge
                    variant="outline"
                    className={`text-[10px] ${data.transport === "stdio" ? "border-blue-500/30 text-blue-400" : "border-amber-500/30 text-amber-400"}`}
                  >
                    {data.transport}
                  </Badge>
                  {data.category && (
                    <Badge
                      variant="outline"
                      className={`text-[10px] ${CATEGORY_COLORS[data.category] || "border-slate-500/30 text-slate-400"}`}
                    >
                      {data.category}
                    </Badge>
                  )}
                </div>
                {mcp.description && (
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{mcp.description}</p>
                )}
                {data.command && (
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <code className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded font-mono">
                      {data.command} {(data.args || []).join(" ")}
                    </code>
                    <button
                      onClick={(e) => handleCopyCommand(mcp, e)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-accent"
                      title="Copy command"
                      aria-label="Copy command"
                    >
                      {copiedId === mcp.id ? (
                        <Check className="h-3 w-3 text-green-400" />
                      ) : (
                        <Copy className="h-3 w-3 text-muted-foreground" />
                      )}
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="text-right space-y-1 flex-shrink-0">
              <button
                onClick={(e) => handleOpenSource(data.sourceFile, e)}
                className="text-xs text-muted-foreground font-mono hover:text-foreground transition-colors flex items-center gap-1 ml-auto"
                title={data.sourceFile}
              >
                {basename(data.sourceFile)}
                <ExternalLink className="h-2.5 w-2.5 opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
              {data.env && (
                <div className="flex gap-1 justify-end flex-wrap">
                  {Object.entries(data.env).map(([k, v]) => (
                    <Badge
                      key={k}
                      variant="secondary"
                      className="text-[10px] px-1.5"
                      title={`${k}=${v}`}
                    >
                      {k}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Expandable capabilities */}
          {data.capabilities && data.capabilities.length > 0 && (
            <div className="flex items-center justify-center mt-2 text-muted-foreground/50">
              {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </div>
          )}
          {isExpanded && data.capabilities && (
            <div className="mt-3 pt-3 border-t border-border/50">
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Capabilities</span>
              <ul className="mt-1.5 space-y-1">
                {data.capabilities.map((cap: string, idx: number) => (
                  <li key={idx} className="text-xs text-muted-foreground flex items-start gap-1.5">
                    <span className="text-green-400 mt-0.5">-</span>
                    {cap}
                  </li>
                ))}
              </ul>
              {data.website && (
                <a
                  href={data.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] text-blue-400 hover:text-blue-300 mt-2"
                  onClick={(e) => e.stopPropagation()}
                >
                  {data.website} <ExternalLink className="h-2.5 w-2.5" />
                </a>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">MCP Servers</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {filtered.length} servers configured — MCP servers give Claude tools to interact with external systems
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setGroupByCategory(!groupByCategory)}
            className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border transition-colors ${
              groupByCategory
                ? "border-blue-500/30 bg-blue-500/10 text-blue-400"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            <Tag className="h-3 w-3" />
            Group
          </button>
          <div className="relative w-64">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search MCPs..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
        </div>
      </div>

      {isLoading ? (
        <ListSkeleton rows={4} />
      ) : grouped ? (
        <div className="space-y-6">
          {Object.entries(grouped)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([category, items]) => (
              <div key={category} className="space-y-3">
                <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                  <Server className="h-3.5 w-3.5" />
                  {categoryLabel(category)}
                  <Badge variant="secondary" className="text-[10px] ml-1">{items.length}</Badge>
                </h2>
                {items.map((mcp, i) => renderCard(mcp, i))}
              </div>
            ))}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((mcp, i) => renderCard(mcp, i))}
          {filtered.length === 0 && <div className="text-muted-foreground text-center py-12">No MCP servers found</div>}
        </div>
      )}
    </div>
  );
}
