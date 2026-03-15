import { useRuntimeConfig, useConfigSettings } from "@/hooks/use-entities";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Settings, FileJson, Cpu, HardDrive, FolderOpen, Clock, Database, Shield, Copy, Check } from "lucide-react";
import { useState } from "react";

function formatUptime(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hrs > 0) return `${hrs}h ${mins}m`;
  return `${mins}m`;
}

// Basic JSON syntax coloring
function colorizeJson(json: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let i = 0;
  const lines = json.split("\n");

  return lines.map((line, lineIdx) => {
    const colored = line.replace(
      /("(?:\\.|[^"\\])*")\s*:/g,
      '<key>$1</key>:'
    ).replace(
      /:\s*("(?:\\.|[^"\\])*")/g,
      ': <str>$1</str>'
    ).replace(
      /:\s*(\d+(?:\.\d+)?)/g,
      ': <num>$1</num>'
    ).replace(
      /:\s*(true|false|null)/g,
      ': <bool>$1</bool>'
    );

    const segments: React.ReactNode[] = [];
    let remaining = colored;
    let segIdx = 0;

    while (remaining.length > 0) {
      const tagMatch = remaining.match(/^([\s\S]*?)<(key|str|num|bool)>([\s\S]*?)<\/\2>([\s\S]*)/);
      if (tagMatch) {
        if (tagMatch[1]) segments.push(<span key={`${lineIdx}-${segIdx++}`}>{tagMatch[1]}</span>);
        const tag = tagMatch[2];
        const content = tagMatch[3];
        const colorClass = tag === "key" ? "text-cyan-400" : tag === "str" ? "text-green-400" : tag === "num" ? "text-blue-400" : "text-purple-400";
        segments.push(<span key={`${lineIdx}-${segIdx++}`} className={colorClass}>{content}</span>);
        remaining = tagMatch[4];
      } else {
        segments.push(<span key={`${lineIdx}-${segIdx++}`}>{remaining}</span>);
        break;
      }
    }

    return <div key={lineIdx}>{segments}</div>;
  });
}

export default function Config() {
  const { data: runtime } = useRuntimeConfig();
  const { data: configs } = useConfigSettings();
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopy = (content: any, id: string) => {
    navigator.clipboard.writeText(JSON.stringify(content, null, 2));
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Configuration</h1>

      <Tabs defaultValue="runtime">
        <TabsList>
          <TabsTrigger value="runtime">Runtime</TabsTrigger>
          <TabsTrigger value="settings">Settings ({configs?.length || 0})</TabsTrigger>
        </TabsList>

        <TabsContent value="runtime" className="mt-4">
          {runtime ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[
                { icon: Cpu, color: "emerald", label: "Node.js", value: runtime.nodeVersion },
                { icon: HardDrive, color: "blue", label: "Platform", value: `${runtime.platform} (${runtime.arch})` },
                { icon: Clock, color: "amber", label: "Uptime", value: formatUptime(runtime.uptime) },
                { icon: Database, color: "purple", label: "Memory (RSS)", value: `${Math.round(runtime.memoryUsage?.rss / 1048576)} MB` },
                { icon: FolderOpen, color: "teal", label: "Home Directory", value: runtime.homeDir, mono: true, small: true },
                { icon: Settings, color: "indigo", label: "Claude Directory", value: runtime.claudeDir, mono: true, small: true },
              ].map((item, i) => (
                <Card key={item.label} className="card-hover animate-fade-in-up" style={{ animationDelay: `${i * 50}ms` }}>
                  <CardContent className="p-5">
                    <div className="flex items-center gap-3 mb-3">
                      <div className={`rounded-lg bg-${item.color}-500/10 p-2`}>
                        <item.icon className={`h-5 w-5 text-${item.color}-400`} />
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">{item.label}</p>
                        <p className={`font-mono font-semibold ${item.small ? "text-sm" : ""}`}>{item.value}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <div className="text-muted-foreground">Loading...</div>
          )}
        </TabsContent>

        <TabsContent value="settings" className="mt-4 space-y-4">
          {(configs || []).map((config, i) => {
            const data = config.data as any;
            const content = data.content || {};
            const permCount = content.permissions?.allow?.length || 0;
            const hasHooks = !!content.hooks;
            const jsonStr = JSON.stringify(data.content, null, 2);

            return (
              <Card key={config.id} className="animate-fade-in-up" style={{ animationDelay: `${i * 50}ms` }}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base flex items-center gap-2">
                      <FileJson className="h-4 w-4" />
                      {config.name}
                    </CardTitle>
                    <div className="flex gap-2 items-center">
                      <Badge variant="secondary" className="text-xs">{data.configType}</Badge>
                      {permCount > 0 && (
                        <Badge variant="outline" className="text-[10px] border-green-500/30 text-green-400 gap-1">
                          <Shield className="h-2.5 w-2.5" />
                          {permCount} permissions
                        </Badge>
                      )}
                      {hasHooks && (
                        <Badge variant="outline" className="text-[10px] border-amber-500/30 text-amber-400">
                          hooks
                        </Badge>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => handleCopy(data.content, config.id)}
                        aria-label="Copy JSON"
                      >
                        {copiedId === config.id ? (
                          <Check className="h-3 w-3 text-green-400" />
                        ) : (
                          <Copy className="h-3 w-3 text-muted-foreground" />
                        )}
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <pre className="bg-muted/50 border border-border/50 p-4 rounded-lg text-[11px] overflow-x-auto max-h-96 font-mono leading-relaxed">
                    {colorizeJson(jsonStr)}
                  </pre>
                </CardContent>
              </Card>
            );
          })}
          {(!configs || configs.length === 0) && (
            <div className="text-muted-foreground text-center py-12">No configuration files found</div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
