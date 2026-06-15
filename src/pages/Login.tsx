import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/hooks/use-toast";
import { ArrowRight, Building2, ShieldCheck, MessageSquare, CalendarCheck2, Loader2 } from "lucide-react";

export default function Login() {
  const { signIn, signUp, user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  // If a session is already alive (refresh / PWA cold start), skip the form.
  useEffect(() => {
    if (!authLoading && user) navigate("/dashboard", { replace: true });
  }, [authLoading, user, navigate]);

  // Fields start empty in production. Hardcoded demo defaults
  // (prasanthi@kirongroup.in + Kiron@2025) caused users to either accidentally
  // log in as the demo account or trip the browser's saved-password autofill
  // for the wrong identity. Browser password managers still fill in saved
  // credentials when the user types or focuses the field.
  const [signInEmail, setSignInEmail] = useState("");
  const [signInPassword, setSignInPassword] = useState("");

  const [signUpName, setSignUpName] = useState("");
  const [signUpEmail, setSignUpEmail] = useState("");
  const [signUpPassword, setSignUpPassword] = useState("");

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await signIn(signInEmail, signInPassword);
    setLoading(false);
    if (error) {
      toast({ title: "Sign in failed", description: error, variant: "destructive" });
      return;
    }
    navigate("/dashboard");
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await signUp(signUpEmail, signUpPassword, signUpName);
    setLoading(false);
    if (error) {
      toast({ title: "Sign up failed", description: error, variant: "destructive" });
      return;
    }
    toast({ title: "Account created", description: "Check your email to confirm, then sign in." });
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
        {/* Left — Sign in */}
        <div className="flex flex-col justify-between bg-surface p-8 lg:p-12">
          <header className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg gradient-brand text-primary-foreground shadow-card">
              <span className="font-display text-sm font-bold">K</span>
            </div>
            <div>
              <p className="font-display text-base font-semibold leading-tight">Kiron Work OS</p>
              <p className="text-xs text-muted-foreground">Kiron Group · Internal Workspace</p>
            </div>
          </header>

          <div className="mx-auto w-full max-w-md py-12">
            <h1 className="font-display text-3xl font-semibold tracking-tight">Sign in to your workspace</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              One platform across all Kiron companies — work, attendance, approvals.
            </p>

            <Tabs defaultValue="signin" className="mt-8">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="signin">Sign in</TabsTrigger>
                <TabsTrigger value="signup">Sign up</TabsTrigger>
              </TabsList>

              <TabsContent value="signin">
                <form onSubmit={handleSignIn} className="mt-6 space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="email">Work email</Label>
                    <Input id="email" type="email" required value={signInEmail} onChange={(e) => setSignInEmail(e.target.value)} placeholder="you@kirongroup.in" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="password">Password</Label>
                    <Input id="password" type="password" required value={signInPassword} onChange={(e) => setSignInPassword(e.target.value)} placeholder="••••••••" />
                  </div>
                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Sign in <ArrowRight className="ml-1.5 h-4 w-4" /></>}
                  </Button>
                  <div className="text-center">
                    <Link to="/reset-password" className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
                      Forgot password?
                    </Link>
                  </div>
                </form>
              </TabsContent>

              <TabsContent value="signup">
                <form onSubmit={handleSignUp} className="mt-6 space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="name">Full name</Label>
                    <Input id="name" required value={signUpName} onChange={(e) => setSignUpName(e.target.value)} placeholder="Your name" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="su-email">Work email</Label>
                    <Input id="su-email" type="email" required value={signUpEmail} onChange={(e) => setSignUpEmail(e.target.value)} placeholder="you@kirongroup.in" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="su-password">Password</Label>
                    <Input id="su-password" type="password" required minLength={6} value={signUpPassword} onChange={(e) => setSignUpPassword(e.target.value)} placeholder="At least 6 characters" />
                  </div>
                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Create account <ArrowRight className="ml-1.5 h-4 w-4" /></>}
                  </Button>
                </form>
              </TabsContent>
            </Tabs>
          </div>

          <footer className="text-xs text-muted-foreground">
            © {new Date().getFullYear()} Kiron Group · v1 preview
          </footer>
        </div>

        {/* Right — Pitch */}
        <div className="hidden flex-col justify-between gradient-warm p-12 lg:flex">
          <div className="max-w-md">
            <span className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-surface/70 px-3 py-1 text-xs font-medium text-primary backdrop-blur">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" /> One workspace · 14 companies
            </span>
            <h2 className="mt-6 font-display text-3xl font-semibold leading-tight tracking-tight text-foreground">
              The calm operating system for the entire Kiron Group.
            </h2>
            <p className="mt-3 text-sm text-foreground/70">
              Built for founders, founder office, managers, and every employee — across every entity.
            </p>
          </div>

          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {[
              { icon: Building2,      title: "Cross-company work",       body: "Manage projects, tasks, and people across all entities." },
              { icon: ShieldCheck,    title: "Founder visibility",        body: "Drill into companies, departments, employees instantly." },
              { icon: CalendarCheck2, title: "Attendance & approvals",    body: "Self check-in, leave, HR-routed approvals." },
              { icon: MessageSquare,  title: "Work-focused chat",         body: "DMs, project groups, mentions linked to tasks." },
            ].map(({ icon: Icon, title, body }) => (
              <li key={title} className="rounded-xl border border-border bg-surface/80 p-4 shadow-card backdrop-blur">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-soft text-primary">
                  <Icon className="h-4 w-4" />
                </div>
                <p className="mt-3 text-sm font-semibold text-foreground">{title}</p>
                <p className="mt-1 text-xs text-foreground/70">{body}</p>
              </li>
            ))}
          </ul>

          <div className="rounded-xl border border-border bg-surface/70 p-4 shadow-card backdrop-blur">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Today across Kiron Group</p>
            <div className="mt-3 grid grid-cols-3 gap-3 text-center">
              <div>
                <p className="font-display text-xl font-semibold">214</p>
                <p className="text-[11px] text-muted-foreground">Active tasks</p>
              </div>
              <div>
                <p className="font-display text-xl font-semibold text-accent">86%</p>
                <p className="text-[11px] text-muted-foreground">On-time</p>
              </div>
              <div>
                <p className="font-display text-xl font-semibold text-primary">37</p>
                <p className="text-[11px] text-muted-foreground">Approvals queued</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
