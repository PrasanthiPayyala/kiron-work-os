import { NavLink, useLocation, useNavigate, Outlet } from "react-router-dom";
import { useState } from "react";
import { useAuth, roleNavAccess, roleLabel, type NavKey } from "@/lib/auth";
import { useDataStore } from "@/lib/dataStore";
import { UserAvatar } from "@/components/UserAvatar";
import { CompanyBadge } from "@/components/CompanyBadge";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard, Briefcase, FolderKanban, ListChecks, CalendarCheck, Plane,
  MessageSquare, ShieldCheck, BarChart3, Users, Crown, Settings, Mail,
  Search, Bell, Plus, ChevronLeft, ChevronRight, LogOut, ChevronDown,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useUnreadMailCount } from "@/hooks/useUnreadMailCount";

const navItems: { key: NavKey; label: string; to: string; icon: typeof LayoutDashboard }[] = [
  { key: "dashboard",      label: "Dashboard",      to: "/dashboard",       icon: LayoutDashboard },
  { key: "my_work",        label: "My Work",        to: "/my-work",         icon: Briefcase },
  { key: "projects",       label: "Projects",       to: "/projects",        icon: FolderKanban },
  { key: "tasks",          label: "Tasks",          to: "/tasks",           icon: ListChecks },
  { key: "mail",           label: "Mail",           to: "/mail",            icon: Mail },
  { key: "attendance",     label: "Attendance",     to: "/attendance",      icon: CalendarCheck },
  { key: "leave",          label: "Leave",          to: "/leave",           icon: Plane },
  { key: "chat",           label: "Team Chat",      to: "/chat",            icon: MessageSquare },
  { key: "approvals",      label: "Approvals",      to: "/approvals",       icon: ShieldCheck },
  { key: "reports",        label: "Reports",        to: "/reports",         icon: BarChart3 },
  { key: "people",         label: "People",         to: "/people",          icon: Users },
  { key: "founder_office", label: "Founder Office", to: "/founder-office",  icon: Crown },
  { key: "settings",       label: "Settings",       to: "/settings",        icon: Settings },
];

export default function AppShell() {
  const { user, signOut } = useAuth();
  const { getCompany, notifications } = useDataStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);

  if (!user) {
    // Should be guarded by route, but be safe
    navigate("/login", { replace: true });
    return null;
  }

  const allowed = new Set(roleNavAccess[user.role]);
  const visibleNav = navItems.filter((n) => allowed.has(n.key));
  const company = getCompany(user.homeCompanyId);
  const myNotifs = notifications.filter((n) => n.userId === user.id);
  const unreadNotifs = myNotifs.filter((n) => !n.read).length;
  const unreadMail = useUnreadMailCount();

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background font-body">
      {/* Sidebar */}
      <aside
        className={cn(
          "flex shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-all duration-200",
          collapsed ? "w-16" : "w-60",
        )}
      >
        <div className="flex h-14 items-center justify-between border-b border-sidebar-border px-3">
          <div className="flex items-center gap-2.5 overflow-hidden">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg gradient-brand text-primary-foreground shadow-card">
              <span className="font-display text-sm font-bold">K</span>
            </div>
            {!collapsed && (
              <div className="min-w-0">
                <p className="truncate font-display text-sm font-semibold leading-tight">Kiron Work OS</p>
                <p className="truncate text-[10px] text-muted-foreground">Kiron Group</p>
              </div>
            )}
          </div>
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
            aria-label="Toggle sidebar"
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto scrollbar-quiet px-2 py-3">
          <ul className="space-y-0.5">
            {visibleNav.map((item) => {
              const Icon = item.icon;
              const active = location.pathname === item.to || (item.to !== "/dashboard" && location.pathname.startsWith(item.to));
              return (
                <li key={item.key}>
                  <NavLink
                    to={item.to}
                    className={cn(
                      "group flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm font-medium transition",
                      active
                        ? "bg-primary-soft text-primary"
                        : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                      collapsed && "justify-center px-0",
                    )}
                    title={collapsed ? item.label : undefined}
                  >
                    <Icon className={cn("h-[18px] w-[18px] shrink-0", active && "text-primary")} />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                    {!collapsed && item.key === "mail" && unreadMail > 0 && (
                      <span className="ml-auto rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">{unreadMail}</span>
                    )}
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="border-t border-sidebar-border p-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-md p-1.5 text-left transition hover:bg-sidebar-accent",
                  collapsed && "justify-center",
                )}
              >
                <UserAvatar userId={user.id} size="md" />
                {!collapsed && (
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{user.name}</p>
                    <p className="truncate text-[11px] text-muted-foreground">{roleLabel(user.role)}</p>
                  </div>
                )}
                {!collapsed && <ChevronDown className="h-4 w-4 text-muted-foreground" />}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" className="w-56">
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                Signed in as
                <p className="mt-0.5 text-sm font-medium text-foreground">{user.name}</p>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => navigate(`/people/${user.id}`)}>
                View profile
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate("/settings")}>
                Settings
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={async () => { await signOut(); navigate("/login"); }} className="text-destructive focus:text-destructive">
                <LogOut className="mr-2 h-4 w-4" /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Topbar */}
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface px-4 md:px-6">
          <div className="relative hidden max-w-md flex-1 md:block">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search tasks, projects, people..."
              className="h-9 pl-8 bg-background"
            />
          </div>

          <div className="ml-auto flex items-center gap-1.5">
            {company && (
              <div className="hidden items-center gap-2 rounded-md border border-border bg-surface-muted px-2.5 py-1 lg:flex">
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Active</span>
                <CompanyBadge companyId={company.id} size="xs" />
              </div>
            )}

            <Button variant="outline" size="sm" className="hidden h-9 gap-1.5 sm:flex">
              <Plus className="h-4 w-4" /> Quick add
            </Button>

            {allowed.has("mail") && (
              <button
                onClick={() => navigate("/mail")}
                className="relative flex h-9 w-9 items-center justify-center rounded-md border border-border bg-surface hover:bg-muted"
                aria-label="Mail"
              >
                <Mail className="h-4 w-4" />
                {unreadMail > 0 && (
                  <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-semibold text-primary-foreground">
                    {unreadMail > 99 ? "99+" : unreadMail}
                  </span>
                )}
              </button>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="relative flex h-9 w-9 items-center justify-center rounded-md border border-border bg-surface hover:bg-muted">
                  <Bell className="h-4 w-4" />
                  {unreadNotifs > 0 && (
                    <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-semibold text-primary-foreground">
                      {unreadNotifs}
                    </span>
                  )}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-80">
                <DropdownMenuLabel>Notifications</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {myNotifs.length === 0 && (
                  <p className="px-2 py-3 text-sm text-muted-foreground">You're all caught up.</p>
                )}
                {myNotifs.map((n) => (
                  <DropdownMenuItem key={n.id} onClick={() => n.link && navigate(n.link)} className="flex flex-col items-start gap-0.5">
                    <span className="text-sm font-medium">{n.title}</span>
                    {n.body && <span className="text-xs text-muted-foreground">{n.body}</span>}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* Routed page content */}
        <main className="flex-1 overflow-y-auto scrollbar-quiet">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
