import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Switch, Route } from "wouter";
import { Suspense, lazy, useEffect } from "react";
import { Layout } from "@/components/layout";
import { ErrorBoundary } from "@/components/error-boundary";
import { GlobalSearch } from "@/components/global-search";
import { useAppSettings } from "@/hooks/use-settings";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { useTheme } from "@/hooks/use-theme";
import { OnboardingWizard } from "@/components/onboarding-wizard";
import { KeyboardShortcutsOverlay } from "@/components/keyboard-shortcuts";
const Dashboard = lazy(() => import("@/pages/dashboard"));
const Projects = lazy(() => import("@/pages/projects"));
const ProjectDetail = lazy(() => import("@/pages/project-detail"));
const MCPs = lazy(() => import("@/pages/mcps"));
const Skills = lazy(() => import("@/pages/skills"));
const Plugins = lazy(() => import("@/pages/plugins"));
const MarkdownFiles = lazy(() => import("@/pages/markdown-files"));
const MarkdownEdit = lazy(() => import("@/pages/markdown-edit"));
const GraphPage = lazy(() => import("@/pages/graph"));
// Discovery merged into Activity page
// Config merged into Settings page
const ActivityPage = lazy(() => import("@/pages/activity"));
const Sessions = lazy(() => import("@/pages/sessions"));
const Agents = lazy(() => import("@/pages/agents"));
const Live = lazy(() => import("@/pages/live"));
const SettingsPage = lazy(() => import("@/pages/settings"));
const Stats = lazy(() => import("@/pages/stats"));
// Rules page removed — content covered by Markdown "What Claude Loads" + individual entity pages
// Costs merged into Stats (Analytics) page
const MessageHistory = lazy(() => import("@/pages/message-history"));
const APIs = lazy(() => import("@/pages/apis"));
const Prompts = lazy(() => import("@/pages/prompts"));
import NotFound from "@/pages/not-found";

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-screen animate-fade-in-up">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-muted-foreground/30 border-t-blue-500" />
    </div>
  );
}

function DynamicTitle() {
  const { data: settings } = useAppSettings();
  useEffect(() => {
    document.title = settings?.appName || "Command Center";
  }, [settings?.appName]);
  return null;
}

function Router() {
  useKeyboardShortcuts();
  useTheme();
  return (
    <Layout>
      <DynamicTitle />
      <OnboardingWizard />
      <ErrorBoundary>
        <Suspense fallback={<PageLoader />}>
          <Switch>
            <Route path="/" component={Dashboard} />
            <Route path="/projects" component={Projects} />
            <Route path="/projects/:id" component={ProjectDetail} />
            <Route path="/mcps" component={MCPs} />
            <Route path="/skills" component={Skills} />
            <Route path="/plugins" component={Plugins} />
            <Route path="/markdown" component={MarkdownFiles} />
            <Route path="/markdown/:id" component={MarkdownEdit} />
            <Route path="/graph" component={GraphPage} />
            <Route path="/discovery" component={ActivityPage} />
            <Route path="/config" component={SettingsPage} />
            <Route path="/activity" component={ActivityPage} />
            <Route path="/sessions" component={Sessions} />
            <Route path="/agents" component={Agents} />
            <Route path="/live" component={Live} />
            <Route path="/settings" component={SettingsPage} />
            <Route path="/stats" component={Stats} />
            <Route path="/costs" component={Stats} />
            <Route path="/messages" component={MessageHistory} />
            <Route path="/apis" component={APIs} />
            <Route path="/prompts" component={Prompts} />
            <Route component={NotFound} />
          </Switch>
        </Suspense>
      </ErrorBoundary>
    </Layout>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Router />
        <GlobalSearch />
        <KeyboardShortcutsOverlay />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
