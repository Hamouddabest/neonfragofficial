import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skull, Swords, Target, Trophy, LogOut, Zap, Hammer, UserCircle2 } from "lucide-react";
import { toast } from "sonner";
import { useIdentity, clearGuest } from "@/hooks/use-identity";

export const Route = createFileRoute("/_authenticated/play")({
  head: () => ({ meta: [{ title: "Lobby — NEONFRAG" }] }),
  component: PlayLobby,
});

function generateRoomCode() {
  return Array.from({ length: 6 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]).join("");
}

function PlayLobby() {
  const navigate = useNavigate();
  const { identity } = useIdentity();
  const isGuest = identity?.isGuest ?? false;
  const [roomCode, setRoomCode] = useState("");
  const [callsign, setCallsign] = useState("");
  const [customCode, setCustomCode] = useState("");

  const { data: profile } = useQuery({
    queryKey: ["profile"],
    enabled: !isGuest,
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return null;
      const { data } = await supabase.from("profiles").select("*").eq("id", u.user.id).single();
      return data;
    },
  });

  const { data: stats } = useQuery({
    queryKey: ["stats"],
    enabled: !isGuest,
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return null;
      const { data } = await supabase.from("player_stats").select("*").eq("user_id", u.user.id).single();
      return data;
    },
  });

  useEffect(() => {
    if (isGuest && identity) setCallsign(identity.name);
    else if (profile?.username) setCallsign(profile.username);
  }, [profile, identity, isGuest]);

  async function saveCallsign() {
    if (isGuest) {
      toast.error("Sign up to save your callsign");
      return;
    }
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const { error } = await supabase.from("profiles").update({ username: callsign }).eq("id", u.user.id);
    if (error) toast.error(error.message);
    else toast.success("Callsign saved");
  }

  function createRoom() {
    const code = generateRoomCode();
    navigate({ to: "/game/$roomId", params: { roomId: code } });
  }

  function createCustomArena() {
    if (isGuest) {
      toast.error("Sign up to build custom arenas");
      return;
    }
    const code = generateRoomCode();
    navigate({ to: "/build/$roomId", params: { roomId: code } });
  }

  function joinCustomArena() {
    const code = customCode.trim().toUpperCase();
    if (code.length < 4) return toast.error("Enter a valid arena ID");
    navigate({ to: "/game/$roomId", params: { roomId: code } });
  }

  function quickFFA() {
    navigate({ to: "/game/$roomId", params: { roomId: "FFA" } });
  }

  function joinRoom() {
    const code = roomCode.trim().toUpperCase();
    if (code.length < 4) return toast.error("Enter a valid room code");
    navigate({ to: "/game/$roomId", params: { roomId: code } });
  }

  async function signOut() {
    if (isGuest) clearGuest();
    else await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  const kd = stats && stats.deaths > 0 ? (stats.kills / stats.deaths).toFixed(2) : (stats?.kills ?? 0).toFixed(2);
  const displayName = isGuest ? identity?.name ?? "guest" : profile?.username ?? "soldier";

  return (
    <main className="relative min-h-dvh px-6 py-10">
      <div className="absolute inset-0 scanlines pointer-events-none opacity-40" />
      <div className="relative z-10 mx-auto max-w-4xl">
        <header className="mb-10 flex items-center justify-between">
          <Link to="/" className="font-display text-xl font-black tracking-widest text-primary neon-text">
            NEON<span className="text-accent">FRAG</span>
          </Link>
          <div className="flex items-center gap-2">
            {isGuest && (
              <Button asChild variant="outline" size="sm">
                <Link to="/auth" search={{ mode: "signup" }}>
                  <UserCircle2 className="mr-2 size-4" /> Sign up to save stats
                </Link>
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={signOut}>
              <LogOut className="mr-2 size-4" /> {isGuest ? "Exit guest" : "Sign out"}
            </Button>
          </div>
        </header>

        <h1 className="font-display text-4xl font-black uppercase tracking-tight md:text-5xl">
          Ready up, <span className="text-primary neon-text">{displayName}</span>
        </h1>
        {isGuest && (
          <p className="mt-2 text-sm text-muted-foreground">
            Playing as guest — stats won't save. <Link to="/auth" search={{ mode: "signup" }} className="text-primary hover:underline">Create an account</Link> to keep your progress.
          </p>
        )}

        <div className="mt-8 grid gap-4 md:grid-cols-4">
          <StatCard icon={Target} label="Kills" value={stats?.kills ?? 0} />
          <StatCard icon={Skull} label="Deaths" value={stats?.deaths ?? 0} />
          <StatCard icon={Swords} label="K/D" value={kd} />
          <StatCard icon={Trophy} label="Matches" value={stats?.matches_played ?? 0} />
        </div>

        <div className="mt-10 rounded-xl border-2 border-primary/60 bg-gradient-to-br from-primary/15 to-accent/10 p-6 backdrop-blur ring-2 ring-primary/20 ring-offset-2 ring-offset-background md:col-span-2">
          <div className="flex items-center gap-2">
            <Hammer className="size-5 text-primary" />
            <h2 className="font-display text-lg font-bold uppercase tracking-wider">Creative — build your arena</h2>
            <span className="ml-auto rounded-full bg-accent px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-accent-foreground">NEW</span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Place cubes, plates, pillars, stairs, and spawn points. Hit the ✅ to lock it in, then share the ID so friends can drop in.
          </p>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            <Button
              onClick={createCustomArena}
              className="h-12 w-full bg-primary font-bold uppercase tracking-widest text-primary-foreground hover:bg-primary/90 shadow-[0_0_20px_var(--primary)]"
            >
              Build new arena
            </Button>
            <div className="flex gap-2">
              <Input
                value={customCode}
                onChange={(e) => setCustomCode(e.target.value.toUpperCase())}
                placeholder="ARENA ID"
                maxLength={8}
                className="font-display tracking-[0.3em] uppercase"
              />
              <Button onClick={joinCustomArena} variant="outline" className="h-11">Join</Button>
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-6 md:grid-cols-2">
          <div className="rounded-xl border-2 border-accent/60 bg-gradient-to-br from-accent/15 to-primary/10 p-6 backdrop-blur md:col-span-2">
            <div className="flex items-center gap-2">
              <Zap className="size-5 text-accent" />
              <h2 className="font-display text-lg font-bold uppercase tracking-wider">Free-for-All</h2>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Jump straight into a live arena. Every player for themselves — fight for the most frags.
            </p>
            <Button
              onClick={quickFFA}
              className="mt-5 h-12 w-full bg-accent font-bold uppercase tracking-widest text-accent-foreground hover:bg-accent/90"
            >
              Drop into FFA
            </Button>
          </div>

          <div className="rounded-xl border border-border bg-card/70 p-6 backdrop-blur">
            <h2 className="font-display text-lg font-bold uppercase tracking-wider">Create a room</h2>
            <p className="mt-1 text-sm text-muted-foreground">Spin up a private arena and share the code with friends.</p>
            <Button onClick={createRoom} className="mt-5 w-full h-11 font-bold uppercase tracking-widest">
              Create room
            </Button>
          </div>

          <div className="rounded-xl border border-border bg-card/70 p-6 backdrop-blur">
            <h2 className="font-display text-lg font-bold uppercase tracking-wider">Join a room</h2>
            <p className="mt-1 text-sm text-muted-foreground">Enter the 6-character room code.</p>
            <div className="mt-5 flex gap-2">
              <Input
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                placeholder="ABC123"
                maxLength={8}
                className="font-display tracking-[0.3em] uppercase"
              />
              <Button onClick={joinRoom} className="h-11">Join</Button>
            </div>
          </div>
        </div>

        <div className="mt-10 rounded-xl border border-border bg-card/50 p-6 backdrop-blur">
          <h2 className="font-display text-lg font-bold uppercase tracking-wider">Callsign</h2>
          <p className="mt-1 text-sm text-muted-foreground">Shown to other players in matches.</p>
          <div className="mt-4 flex gap-2">
            <div className="flex-1">
              <Label htmlFor="callsign" className="sr-only">Callsign</Label>
              <Input id="callsign" value={callsign} onChange={(e) => setCallsign(e.target.value)} maxLength={20} />
            </div>
            <Button onClick={saveCallsign} variant="outline">Save</Button>
          </div>
        </div>
      </div>
    </main>
  );
}

function StatCard({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-border bg-card/70 p-5 backdrop-blur">
      <Icon className="text-primary mb-2 size-5" />
      <div className="text-xs uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="font-display text-3xl font-black">{value}</div>
    </div>
  );
}