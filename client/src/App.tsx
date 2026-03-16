import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Switch, Route } from "wouter";
import { useEffect } from "react";
import { Layout } from "@/components/layout";
import { GlobalSearch } from "@/components/global-search";
import { useAppSettings } from "@/hooks/use-settings";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { useTheme } from "@/hooks/use-theme";
import { OnboardingWizard } from "@/components/onboarding-wizard";
import Dashboard from "@/pages/dashboard";
import Projects from "@/pages/projects";
import ProjectDetail from "@/pages/project-detail";
import MCPs from "@/pages/mcps";
import Skills from "@/pages/skills";
import Plugins from "@/pages/plugins";
import MarkdownFiles from "@/pages/markdown-files";
import MarkdownEdit from "@/pages/markdown-edit";
import GraphPage from "@/pages/graph";
import Discovery from "@/pages/discovery";
import Config from "@/pages/config";
import ActivityPage from "@/pages/activity";
import Sessions from "@/pages/sessions";
import Agents from "@/pages/agents";
import Live from "@/pages/live";
import SettingsPage from "@/pages/settings";
import Stats from "@/pages/stats";
import NotFound from "@/pages/not-found";

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
        <Route path="/discovery" component={Discovery} />
        <Route path="/config" component={Config} />
        <Route path="/activity" component={ActivityPage} />
        <Route path="/sessions" component={Sessions} />
        <Route path="/agents" component={Agents} />
        <Route path="/live" component={Live} />
        <Route path="/settings" component={SettingsPage} />
        <Route path="/stats" component={Stats} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Router />
        <GlobalSearch />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
