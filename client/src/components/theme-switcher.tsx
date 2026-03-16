import { useTheme, type Theme } from "@/hooks/use-theme";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Sun, Moon, Monitor, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

const themeOrder: Theme[] = ["dark", "light", "glass", "system"];

const themeConfig: Record<Theme, { icon: typeof Sun; label: string }> = {
  dark: { icon: Moon, label: "Dark" },
  light: { icon: Sun, label: "Light" },
  glass: { icon: Sparkles, label: "Glass" },
  system: { icon: Monitor, label: "System" },
};

export function ThemeSwitcher({ collapsed }: { collapsed: boolean }) {
  const { theme, setTheme } = useTheme();

  const cycleTheme = () => {
    const currentIndex = themeOrder.indexOf(theme);
    const nextIndex = (currentIndex + 1) % themeOrder.length;
    setTheme(themeOrder[nextIndex]);
  };

  const config = themeConfig[theme];
  const Icon = config.icon;

  const button = (
    <button
      onClick={cycleTheme}
      className={cn(
        "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-all duration-150 cursor-pointer w-full",
        collapsed ? "justify-center" : "",
        "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50"
      )}
      aria-label={`Theme: ${config.label}. Click to cycle.`}
    >
      <Icon className="h-4 w-4 flex-shrink-0" />
      {!collapsed && <span className="flex-1 text-left">{config.label}</span>}
    </button>
  );

  if (collapsed) {
    return (
      <div className="px-2 py-1">
        <Tooltip>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent side="right" className="text-xs">
            Theme: {config.label}
          </TooltipContent>
        </Tooltip>
      </div>
    );
  }

  return <div className="px-2 py-1">{button}</div>;
}
