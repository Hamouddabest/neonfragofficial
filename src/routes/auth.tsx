import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";

const searchSchema = z.object({
  mode: z.enum(["signin", "signup"]).optional(),
});

export const Route = createFileRoute("/auth")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Sign in — NEONFRAG" },
      { name: "description", content: "Sign in or create an account to save your match stats and join multiplayer rooms." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const { mode = "signin" } = Route.useSearch();
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && user) navigate({ to: "/play" });
  }, [loading, user, navigate]);

  const isSignup = mode === "signup";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (isSignup) {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin,
            data: { username: username || email.split("@")[0] },
          },
        });
        if (error) throw error;
        toast.success("Account created. Check your email if confirmation is required.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success("Welcome back, soldier.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleGoogle() {
    setBusy(true);
    try {
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin,
      });
      if (result.error) throw result.error;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Google sign-in failed");
      setBusy(false);
    }
  }

  return (
    <main className="relative flex min-h-dvh items-center justify-center px-6 py-12">
      <div className="absolute inset-0 scanlines pointer-events-none opacity-50" />
      <div className="relative z-10 w-full max-w-md">
        <Link to="/" className="mb-8 block text-center font-display text-2xl font-black tracking-widest neon-text text-primary">
          NEON<span className="text-accent">FRAG</span>
        </Link>
        <div className="rounded-xl border border-border bg-card/80 p-8 backdrop-blur neon-border">
          <h1 className="font-display text-2xl font-bold uppercase tracking-wider">
            {isSignup ? "Create account" : "Sign in"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isSignup ? "Stats and matches saved to your account." : "Welcome back."}
          </p>

          <Button onClick={handleGoogle} disabled={busy} variant="outline" className="mt-6 w-full h-11">
            <svg className="mr-2 size-4" viewBox="0 0 24 24"><path fill="currentColor" d="M21.35 11.1H12v3.2h5.35c-.25 1.55-1.85 4.55-5.35 4.55-3.2 0-5.85-2.65-5.85-5.85S8.8 7.15 12 7.15c1.85 0 3.05.8 3.75 1.45l2.55-2.45C16.7 4.6 14.55 3.65 12 3.65 6.95 3.65 2.85 7.75 2.85 12.8S6.95 21.95 12 21.95c6.95 0 9.45-4.85 9.45-7.4 0-.5-.05-.95-.1-1.45z"/></svg>
            Continue with Google
          </Button>

          <div className="my-6 flex items-center gap-3 text-xs uppercase tracking-widest text-muted-foreground">
            <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {isSignup && (
              <div>
                <Label htmlFor="username">Callsign</Label>
                <Input id="username" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="ShadowFrag" maxLength={20} />
              </div>
            )}
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <Button type="submit" disabled={busy} className="w-full h-11 font-bold uppercase tracking-widest">
              {busy ? "..." : isSignup ? "Create account" : "Sign in"}
            </Button>
          </form>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            {isSignup ? "Already have an account?" : "New here?"}{" "}
            <Link
              to="/auth"
              search={{ mode: isSignup ? "signin" : "signup" }}
              className="text-primary hover:underline"
            >
              {isSignup ? "Sign in" : "Create account"}
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}