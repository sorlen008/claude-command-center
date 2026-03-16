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
import { useScanStatus } from "@/hooks/use-entities";
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
} from "lucide-react";

const TOTAL_STEPS = 3;

const entityConfig: { key: string; label: string; icon: typeof Terminal; countKey: string }[] = [
  { key: "project", label: "Projects", icon: FolderOpen, countKey: "project" },
  { key: "mcp", label: "MCP Servers", icon: Server, countKey: "mcp" },
  { key: "skill", label: "Skills", icon: Wand2, countKey: "skill" },
  { key: "plugin", label: "Plugins", icon: Puzzle, countKey: "plugin" },
  { key: "markdown", label: "Markdown Files", icon: FileText, countKey: "markdown" },
  { key: "config", label: "Config Files", icon: Settings, countKey: "config" },
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
          className="text-center bg-muted/30 border-muted-foreground/20 focus:border-blue-500/50"
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
  const counts = (status?.entityCounts || {}) as Record<string, number>;
  const totalEntities = status?.totalEntities || 0;
  const sessionCount = status?.sessionCount || 0;

  return (
    <div className="flex flex-col items-center gap-6 py-2">
      <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-[0_0_30px_rgba(16,185,129,0.2)] ring-1 ring-emerald-400/20">
        <Search className="h-8 w-8 text-white" />
      </div>
      <div className="text-center space-y-2">
        <h2 className="text-xl font-bold">Here's What We Found</h2>
        <p className="text-sm text-muted-foreground max-w-sm">
          These were auto-discovered from your <code className="text-xs bg-muted px-1.5 py-0.5 rounded">~/.claude/</code> directory
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          Scanning...
        </div>
      ) : (
        <div className="w-full grid grid-cols-2 gap-3">
          {entityConfig.map(({ key, label, icon: Icon, countKey }) => {
            const count = counts[countKey] || 0;
            return (
              <div
                key={key}
                className="flex items-center gap-3 rounded-lg border border-muted-foreground/10 bg-muted/20 px-4 py-3 transition-colors"
              >
                <Icon className="h-4 w-4 text-blue-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-muted-foreground">{label}</div>
                  <div className="text-lg font-semibold tabular-nums">{count}</div>
                </div>
              </div>
            );
          })}
          {sessionCount > 0 && (
            <div className="col-span-2 flex items-center gap-3 rounded-lg border border-muted-foreground/10 bg-muted/20 px-4 py-3">
              <GitBranch className="h-4 w-4 text-purple-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-xs text-muted-foreground">Sessions</div>
                <div className="text-lg font-semibold tabular-nums">{sessionCount}</div>
              </div>
            </div>
          )}
        </div>
      )}

      {!isLoading && totalEntities > 0 && (
        <p className="text-xs text-muted-foreground/60">
          {totalEntities} entities total
        </p>
      )}
    </div>
  );
}

function StepReady() {
  const tips = [
    { icon: Keyboard, label: "Press Ctrl+K to search across everything" },
    { icon: GitBranch, label: "Check the Graph page for an ecosystem overview" },
    { icon: Sparkles, label: "Use AI Suggest on the Discovery page to discover infrastructure" },
  ];

  return (
    <div className="flex flex-col items-center gap-6 py-2">
      <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-[0_0_30px_rgba(245,158,11,0.2)] ring-1 ring-amber-400/20">
        <Rocket className="h-8 w-8 text-white" />
      </div>
      <div className="text-center space-y-2">
        <h2 className="text-xl font-bold">You're All Set!</h2>
        <p className="text-sm text-muted-foreground max-w-sm">
          Your command center is ready. Here are some quick tips to get started.
        </p>
      </div>
      <div className="w-full space-y-2">
        {tips.map((tip, i) => (
          <div
            key={i}
            className="flex items-center gap-3 rounded-lg border border-muted-foreground/10 bg-muted/20 px-4 py-3"
          >
            <tip.icon className="h-4 w-4 text-amber-400 shrink-0" />
            <span className="text-sm">{tip.label}</span>
          </div>
        ))}
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

  // Initialize appName from settings once loaded
  if (settings && !initialized) {
    setAppName(settings.appName || "Command Center");
    setInitialized(true);
  }

  // Don't show while loading or if already onboarded
  if (isLoading || !settings || settings.onboarded) {
    return null;
  }

  const handleFinish = () => {
    const name = appName.trim() || "Command Center";
    updateSettings.mutate({ appName: name, onboarded: true });
  };

  const canGoNext = step < TOTAL_STEPS - 1;
  const canGoBack = step > 0;
  const isLastStep = step === TOTAL_STEPS - 1;

  return (
    <Dialog open={true}>
      <DialogContent
        className="sm:max-w-[480px] bg-gradient-to-b from-[hsl(222_47%_8%)] to-[hsl(222_47%_6%)] border-muted-foreground/10 shadow-2xl"
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
