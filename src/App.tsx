import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate, Outlet } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/lib/auth";
import { DataStoreProvider } from "@/lib/dataStore";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import AppShell from "@/components/AppShell";

import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import Login from "./pages/Login";
import ResetPassword from "./pages/ResetPassword";
import UpdatePassword from "./pages/UpdatePassword";
import ChangePassword from "./pages/ChangePassword";
import Dashboard from "./pages/Dashboard";
import MyWork from "./pages/MyWork";
import Projects from "./pages/Projects";
import ProjectDetail from "./pages/ProjectDetail";
import Tasks from "./pages/Tasks";
import Attendance from "./pages/Attendance";
import Leave from "./pages/Leave";
import Chat from "./pages/Chat";
import Approvals from "./pages/Approvals";
import Reports from "./pages/Reports";
import People from "./pages/People";
import PersonProfile from "./pages/PersonProfile";
import Interns from "./pages/Interns";
import FounderOffice from "./pages/FounderOffice";
import Settings from "./pages/Settings";
import Mail from "./pages/Mail";
import Notifications from "./pages/Notifications";
import Contacts from "./pages/Contacts";
import TeamAttendance from "./pages/TeamAttendance";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <DataStoreProvider>
            <Routes>
              <Route path="/" element={<Index />} />
              <Route path="/login" element={<Login />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/update-password" element={<UpdatePassword />} />

              {/* Authenticated forced password change — outside AppShell because
                  we don't want the sidebar / topbar visible during the first-
                  login screen. ProtectedRoute still enforces authentication. */}
              <Route
                path="/change-password"
                element={
                  <ProtectedRoute>
                    <ChangePassword />
                  </ProtectedRoute>
                }
              />

              <Route
                element={
                  <ProtectedRoute>
                    <AppShell />
                  </ProtectedRoute>
                }
              >
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/my-work" element={<MyWork />} />
                <Route path="/projects" element={<Projects />} />
                <Route path="/projects/:id" element={<ProjectDetail />} />
                <Route path="/tasks" element={<Tasks />} />
                <Route path="/mail" element={<ProtectedRoute require="mail"><Mail /></ProtectedRoute>} />
                <Route path="/attendance" element={<Attendance />} />
                <Route
                  path="/team-attendance"
                  element={
                    <ProtectedRoute require="team_attendance">
                      <TeamAttendance />
                    </ProtectedRoute>
                  }
                />
                <Route path="/leave" element={<Leave />} />
                <Route path="/chat" element={<Chat />} />
                <Route path="/notifications" element={<Notifications />} />
                <Route path="/approvals" element={<Approvals />} />
                <Route
                  path="/reports"
                  element={
                    <ProtectedRoute require="reports">
                      <Reports />
                    </ProtectedRoute>
                  }
                />
                <Route path="/people" element={<People />} />
                <Route
                  path="/contacts"
                  element={
                    <ProtectedRoute require="contacts">
                      <Contacts />
                    </ProtectedRoute>
                  }
                />
                <Route path="/people/interns" element={<Interns />} />
                <Route path="/people/:id" element={<PersonProfile />} />
                <Route
                  path="/founder-office"
                  element={
                    <ProtectedRoute require="founder_office">
                      <FounderOffice />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/settings"
                  element={
                    <ProtectedRoute require="settings">
                      <Settings />
                    </ProtectedRoute>
                  }
                />
              </Route>

              <Route path="*" element={<NotFound />} />
            </Routes>
          </DataStoreProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
