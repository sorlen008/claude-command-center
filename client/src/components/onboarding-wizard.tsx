import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAppSettings, useUpdateSettings } from "@/hooks/use-settings";
import { useScanStatus, useRescan } from "@/hooks/use-entities";
import {
  Terminal,
  FolderOpen,
  Server,
  Wand2,
  Puzzle,
  FileText,
  Settings,
  ChevronRight,
  ChevronLeft,
  Sparkles,
  GitBranch,
  Keyboard,
  Search,
  Rocket,
  RefreshCw,
  AlertCircle,
  SlidersHorizontal,
} from "lucide-react";

const TOTAL_STEPS = 3;

const entityConfig: { key: string; label: string; icon: typeof Terminal; countKey: string; hint: string }[] = [
  { key: "project", label: "Projects", icon: FolderOpen, countKey: "project", hint: "Directories with CLAUDE.md or .mcp.json" },
  { key: "mcp", label: "MCP Servers", icon: Server, countKey: "mcp", hint: "Defined in ~/.claude/.mcp.json" },
  { key: "skill", label: "Skills", icon: Wand2, countKey: "skill", hint: "Markdown files in ~/.claude/skills/" },
  { key: "plugin", label: "Plugins", icon: Puzzle, countKey: "plugin", hint: "Installed in ~/.claude/plugins/" },
  { key: "markdown", label: "Markdown", icon: FileText, countKey: "markdown", hint: "CLAUDE.md and docs files" },
  { key: "config", label: "Config", icon: Settings, countKey: "config", hint: "settings.json files" },
];

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-2 justify-center">
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className={`h-2 rounded-full transition-all duration-300 ${
            i === current
              ? "w-8 bg-gradient-to-r from-blue-500 to-purple-500"
              : i < current
              ? "w-2 bg-blue-500/60"
              : "w-2 bg-muted-foreground/20"
          }`}
        />
      ))}
    </div>
  );
}

function StepWelcome({
  appName,
  onAppNameChange,
}: {
  appName: string;
  onAppNameChange: (name: string) => void;
}) {
  return (
    <div className="flex flex-col items-center gap-6 py-2">
      <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-blue-500 via-purple-500 to-indigo-600 flex items-center justify-center shadow-[0_0_40px_rgba(99,102,241,0.3)] ring-1 ring-blue-400/20">
        <Terminal className="h-10 w-10 text-white" />
      </div>
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
          Welcome to Command Center
        </h2>
        <p className="text-sm text-muted-foreground max-w-sm">
          A dashboard for your Claude Code ecosystem. Let's set it up.
        </p>
      </div>
      <div className="w-full max-w-xs space-y-2">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          App Name
        </label>
        <Input
          value={appName}
          onChange={(e) => onAppNameChange(e.target.value)}
          placeholder="Command Center"
          maxLength={50}
          className="text-center"
        />
        <p className="text-[11px] text-muted-foreground/60 text-center">
          Shown in the sidebar and browser tab
        </p>
      </div>
    </div>
  );
}

function StepDiscovered() {
  const { data: status, isLoading } = useScanStatus();
  const rescan = useRescan();
  const counts = (status?.entityCounts || {}) as Record<string, number>;
  const totalEntities = status?.totalEntities || 0;
  const sessionCount = (status as any)?.sessionCount || 0;
  const hasEntities = totalEntities > 0;

  return (
    <div className="flex flex-col items-center gap-5 py-2">
      <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-[0_0_30px_rgba(16,185,129,0.15)] ring-1 ring-emerald-400/20">
        <Search className="h-8 w-8 text-white" />
      </div>
      <div className="text-center space-y-2">
        <h2 className="text-xl font-bold">{hasEntities ? "Here's What We Found" : "No Entities Found Yet"}</h2>
        <p className="text-sm text-muted-foreground max-w-sm">
          {hasEntities
            ? <>Auto-discovered from your <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">~/.claude/</code> directory</>
            : "That's okay! Here's how to get started with Claude Code."
          }
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          Scanning...
        </div>
      ) : hasEntities ? (
        <>
          <div className="w-full grid grid-cols-2 gap-2">
            {entityConfig.map(({ key, label, icon: Icon, countKey }) => {
              const count = counts[countKey] || 0;
              return (
                <div
                  key={key}
                  className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
                    count > 0
                      ? "border-border/50 bg-card"
                      : "border-border/20 bg-muted/10 opacity-50"
                  }`}
                >
                  <Icon className="h-4 w-4 text-blue-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] text-muted-foreground">{label}</div>
                    <div className="text-lg font-semibold tabular-nums font-mono">{count}</div>
                  </div>
                </div>
              );
            })}
            {sessionCount > 0 && (
              <div className="col-span-2 flex items-center gap-3 rounded-lg border border-border/50 bg-card px-3 py-2.5">
                <GitBranch className="h-4 w-4 text-purple-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] text-muted-foreground">Sessions</div>
                  <div className="text-lg font-semibold tabular-nums font-mono">{sessionCount}</div>
                </div>
              </div>
            )}
          </div>
          <p className="text-xs text-muted-foreground/60">
            {totalEntities} entities total
          </p>
        </>
      ) : (
        /* Empty state — guide the user */
        <div className="w-full space-y-3">
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
            <div className="flex items-start gap-2.5">
              <AlertCircle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
              <div className="space-y-2 text-xs text-muted-foreground">
                <p>The scanner looks for Claude Code files in <code className="bg-muted px-1 py-0.5 rounded font-mono">~/.claude/</code>. To populate your dashboard:</p>
                <ul className="space-y-1.5 ml-1">
                  <li className="flex items-start gap-2">
                    <span className="text-blue-400 font-bold mt-0.5">1.</span>
                    <span>Run <code className="bg-muted px-1 py-0.5 rounded font-mono">claude</code> in any project to create a session</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-blue-400 font-bold mt-0.5">2.</span>
                    <span>Add a <code className="bg-muted px-1 py-0.5 rounded font-mono">CLAUDE.md</code> file to your project root</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-blue-400 font-bold mt-0.5">3.</span>
                    <span>Configure MCP servers in <code className="bg-muted px-1 py-0.5 rounded font-mono">~/.claude/.mcp.json</code></span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="w-full gap-2"
            onClick={() => rescan.mutate()}
            disabled={rescan.isPending}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${rescan.isPending ? "animate-spin" : ""}`} />
            {rescan.isPending ? "Scanning..." : "Rescan Now"}
          </Button>
          <p className="text-[11px] text-muted-foreground/50 text-center">
            You can also add extra scan paths later in Settings
          </p>
        </div>
      )}
    </div>
  );
}

function StepReady() {
  const tips = [
    { icon: Keyboard, label: "Press Ctrl+K to search across everything" },
    { icon: GitBranch, label: "Check the Graph page for an ecosystem overview" },
    { icon: Sparkles, label: "Use AI Suggest on Discovery to find infrastructure" },
  ];

  return (
    <div className="flex flex-col items-center gap-5 py-2">
      <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-[0_0_30px_rgba(245,158,11,0.15)] ring-1 ring-amber-400/20">
        <Rocket className="h-8 w-8 text-white" />
      </div>
      <div className="text-center space-y-2">
        <h2 className="text-xl font-bold">You're All Set!</h2>
        <p className="text-sm text-muted-foreground max-w-sm">
          Your command center is ready. Here are some quick tips.
        </p>
      </div>
      <div className="w-full space-y-2">
        {tips.map((tip, i) => (
          <div
            key={i}
            className="flex items-center gap-3 rounded-lg border border-border/50 bg-card px-4 py-3"
          >
            <tip.icon className="h-4 w-4 text-amber-400 shrink-0" />
            <span className="text-sm">{tip.label}</span>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3 rounded-lg border border-blue-500/20 bg-blue-500/5 px-4 py-3 w-full">
        <SlidersHorizontal className="h-4 w-4 text-blue-400 shrink-0" />
        <p className="text-xs text-muted-foreground">
          Want to re-run this later? Go to <span className="font-semibold text-blue-400">Settings</span> and click <span className="font-semibold text-blue-400">Run Onboarding</span>
        </p>
      </div>
    </div>
  );
}

export function OnboardingWizard() {
  const { data: settings, isLoading } = useAppSettings();
  const updateSettings = useUpdateSettings();
  const [step, setStep] = useState(0);
  const [appName, setAppName] = useState("");
  const [initialized, setInitialized] = useState(false);
  const [done, setDone] = useState(false);

  // Initialize appName from settings once loaded
  if (settings && !initialized) {
    setAppName(settings.appName || "Command Center");
    setInitialized(true);
  }

  // Don't show while loading, if already onboarded, or if just completed
  if (isLoading || !settings || settings.onboarded || done) {
    return null;
  }

  const handleFinish = () => {
    const name = appName.trim() || "Command Center";
    updateSettings.mutate(
      { appName: name, onboarded: true },
      { onSuccess: () => setDone(true) },
    );
  };

  const canGoNext = step < TOTAL_STEPS - 1;
  const canGoBack = step > 0;
  const isLastStep = step === TOTAL_STEPS - 1;

  return (
    <Dialog open={true}>
      <DialogContent
        className="sm:max-w-[480px]"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Onboarding</DialogTitle>
          <DialogDescription>Set up your Command Center</DialogDescription>
        </DialogHeader>

        <div className="min-h-[340px] flex flex-col">
          <div className="flex-1">
            {step === 0 && <StepWelcome appName={appName} onAppNameChange={setAppName} />}
            {step === 1 && <StepDiscovered />}
            {step === 2 && <StepReady />}
          </div>

          <div className="pt-4 space-y-4">
            <StepIndicator current={step} total={TOTAL_STEPS} />

            <DialogFooter className="flex sm:flex-row gap-2">
              {canGoBack && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setStep((s) => s - 1)}
                  className="gap-1"
                >
                  <ChevronLeft className="h-4 w-4" />
                  Back
                </Button>
              )}
              <div className="flex-1" />
              {canGoNext && (
                <Button
                  size="sm"
                  onClick={() => setStep((s) => s + 1)}
                  className="gap-1 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 border-0"
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </Button>
              )}
              {isLastStep && (
                <Button
                  size="sm"
                  onClick={handleFinish}
                  disabled={updateSettings.isPending}
                  className="gap-1 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 border-0"
                >
                  {updateSettings.isPending ? "Saving..." : "Get Started"}
                  {!updateSettings.isPending && <Rocket className="h-4 w-4" />}
                </Button>
              )}
            </DialogFooter>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
