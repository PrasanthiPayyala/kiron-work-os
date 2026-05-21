import { cn } from "@/lib/utils";
import { useDataStore } from "@/lib/dataStore";

interface CompanyBadgeProps {
  companyId: string;
  size?: "xs" | "sm" | "md";
  showName?: boolean;
  className?: string;
}

export function CompanyBadge({ companyId, size = "sm", showName = true, className }: CompanyBadgeProps) {
  const { getCompany } = useDataStore();
  const company = getCompany(companyId);
  if (!company) return null;

  const sizeMap = {
    xs: "h-5 text-[10px] px-1.5 gap-1",
    sm: "h-6 text-xs px-2 gap-1.5",
    md: "h-7 text-sm px-2.5 gap-2",
  };
  const dotMap = { xs: "h-1.5 w-1.5", sm: "h-2 w-2", md: "h-2.5 w-2.5" };

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border border-border bg-surface-muted font-medium text-foreground/80",
        sizeMap[size],
        className,
      )}
    >
      <span
        className={cn("rounded-full", dotMap[size])}
        style={{ backgroundColor: `hsl(${company.color})` }}
      />
      {showName && <span className="truncate">{company.shortName}</span>}
    </span>
  );
}
