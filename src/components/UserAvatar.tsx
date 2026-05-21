import { cn } from "@/lib/utils";
import { useDataStore } from "@/lib/dataStore";

interface UserAvatarProps {
  userId?: string;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  className?: string;
}

const sizes = {
  xs: "h-5 w-5 text-[9px]",
  sm: "h-7 w-7 text-[11px]",
  md: "h-9 w-9 text-xs",
  lg: "h-12 w-12 text-sm",
  xl: "h-20 w-20 text-xl",
};

// Deterministic warm/calm color from id
function colorFor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return `hsl(${h}, 45%, 88%)`;
}
function inkFor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return `hsl(${h}, 60%, 30%)`;
}

export function UserAvatar({ userId, size = "sm", className }: UserAvatarProps) {
  const { getUser } = useDataStore();
  const user = getUser(userId);
  if (!user) {
    return (
      <span className={cn("inline-flex items-center justify-center rounded-full bg-muted text-muted-foreground font-medium", sizes[size], className)}>
        ??
      </span>
    );
  }
  return (
    <span
      className={cn("inline-flex items-center justify-center rounded-full font-semibold ring-1 ring-inset ring-black/5", sizes[size], className)}
      style={{ backgroundColor: colorFor(user.id), color: inkFor(user.id) }}
      title={user.name}
    >
      {user.initials}
    </span>
  );
}

export function UserAvatarStack({ userIds, max = 4, size = "sm" }: { userIds: string[]; max?: number; size?: "xs" | "sm" | "md" }) {
  const shown = userIds.slice(0, max);
  const remaining = userIds.length - shown.length;
  return (
    <div className="flex -space-x-1.5">
      {shown.map((id) => (
        <UserAvatar key={id} userId={id} size={size} className="ring-2 ring-background" />
      ))}
      {remaining > 0 && (
        <span className={cn("inline-flex items-center justify-center rounded-full bg-muted text-muted-foreground font-medium ring-2 ring-background", sizes[size])}>
          +{remaining}
        </span>
      )}
    </div>
  );
}
