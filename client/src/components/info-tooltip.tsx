import { HelpCircle } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/**
 * Small click-to-open help icon that sits next to a metric label. Keeps the
 * explanation a tap away without cluttering the header row.
 */
export function InfoTooltip({ title, children, width = 320 }: { title?: string; children: React.ReactNode; width?: number }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="What does this mean?"
          className="inline-flex items-center justify-center text-muted-foreground/60 hover:text-foreground/80 transition-colors cursor-pointer"
          onClick={(e) => e.stopPropagation()}
        >
          <HelpCircle className="h-3 w-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="text-xs leading-relaxed" style={{ width }} side="bottom" align="start">
        {title && <div className="font-semibold mb-1 text-foreground">{title}</div>}
        <div className="text-muted-foreground space-y-1.5">{children}</div>
      </PopoverContent>
    </Popover>
  );
}
