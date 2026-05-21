import { useAuth } from "@/lib/auth";
import FounderDashboard from "./dashboards/FounderDashboard";
import SuperAdminDashboard from "./dashboards/SuperAdminDashboard";
import ManagerDashboard from "./dashboards/ManagerDashboard";
import EmployeeDashboard from "./dashboards/EmployeeDashboard";

export default function Dashboard() {
  const { user } = useAuth();
  if (!user) return null;

  switch (user.role) {
    case "super_admin":
      return <SuperAdminDashboard />;
    case "founder":
      return <FounderDashboard />;
    case "founder_office_coordinator":
    case "founder_office_support":
      return <FounderDashboard />;
    case "manager":
      return <ManagerDashboard />;
    case "hr_admin":
      return <ManagerDashboard />;
    case "employee":
    case "intern":
    default:
      return <EmployeeDashboard />;
  }
}
