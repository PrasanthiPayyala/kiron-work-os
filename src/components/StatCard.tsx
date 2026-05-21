import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface StatCardProps {
  label: string;
  value: ReactNode;
  delta?: string;
  trend?: "up" | "down" | "flat";
  icon?: ReactNode;
  hint?: string;
  className?: string;
  accent?: "primary" | "accent" | "info" | "warning" | "destructive";
}

const accentMap = {
  primary: "bg-primary-soft text-primary",
  accent: "bg-accent-soft text-accent",
  info: "bg-info/10 text-info",
  warning: "bg-warning/10 text-warning-foreground",
  destructive: "bg-destructive/10 text-destructive",
};

export function StatCard({ label, value, delta, trend, icon, hint, className, accent = "primary" }: StatCardProps) {
  return (
    <div className={cn("rounded-xl border border-border bg-surface p-4 shadow-card transition hover:shadow-elevated", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="mt-1.5 font-display text-2xl font-semibold text-foreground">{value}</p>
          {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
        </div>
        {icon && <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", accentMap[accent])}>{icon}</div>}
      </div>
      {delta && (
        <div className="mt-3 flex items-center gap-1.5 text-xs">
          <span className={cn(
            "rounded px-1.5 py-0.5 font-medium",
            trend === "up" && "bg-success/10 text-success",
            trend === "down" && "bg-destructive/10 text-destructive",
            trend === "flat" && "bg-muted text-muted-foreground",
          )}>
            {delta}
          </span>
          <span className="text-muted-foreground">vs last week</span>
        </div>
      )}
    </div>
  );
}
