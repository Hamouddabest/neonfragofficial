import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skull, Swords, Target, Trophy, LogOut, Zap, Hammer, UserCircle2, Star, FolderOpen, X, Flag, Crosshair, Loader2, Users } from "lucide-react";
import { toast } from "sonner";
import { useIdentity, clearGuest } from "@/hooks/use-identity";
import { useIsOwner } from "@/hooks/use-is-owner";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/_authenticated/play")({
  head: () => ({ meta: [{ title: "Lobby — NEONFRAG" }] }),
  component: PlayLobby,
});

function generateRoomCode() {
  return Array.from({ length: 6 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]).join("");
}

type QueueMode = "solo" | "duos" | "trios" | "ctf";
const QUEUE_MODES: Record<QueueMode, { label: string; blurb: string; squadSize: number; needed: number }> = {
  solo:  { label: "Solo",  blurb: "Free-for-all, everyone for themselves", squadSize: 1, needed: 2 },
  duos:  { label: "Duos",  blurb: "Teams of 2 · squad voice channel",      squadSize: 2, needed: 4 },
  trios: { label: "Trios", blurb: "Teams of 3 · squad voice channel",      squadSize: 3, needed: 6 },
  ctf:   { label: "Capture the Flag", blurb: "Red vs Blue · team voice",   squadSize: 0, needed: 4 },
};

function PlayLobby() {
  const navigate = useNavigate();
  const { identity } = useIdentity();
  const { isOwner } = useIsOwner();
  const { user } = useAuth();
  const isGuest = identity?.isGuest ?? false;
  const [roomCode, setRoomCode] = useState("");
  const [callsign, setCallsign] = useState("");
  const [customCode, setCustomCode] = useState("");
  const [ffaPickerOpen, setFfaPickerOpen] = useState(false);
  const [queueMode, setQueueMode] = useState<QueueMode | null>(null);
  const [queuePlayers, setQueuePlayers] = useState<string[]>([]);
  const [queueSeconds, setQueueSeconds] = useState(0);
  const [isHost, setIsHost] = useState(false);
  const queueChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const startMatchRef = useRef<(force?: boolean) => void>(() => {});

  useEffect(() => {
    if (!queueMode || !identity) return;
    const cfg = QUEUE_MODES[queueMode];
    const channel = supabase.channel(`queue:${queueMode}`, { config: { presence: { key: identity.id } } });
    queueChannelRef.current = channel;
    let launched = false;

    const launch = (roomId: string, squads: Record<string, string>) => {
      if (launched) return;
      launched = true;
      const mySquad = squads[identity.id];
      if (mySquad) window.sessionStorage.setItem(`neonfrag.squad.${roomId}`, mySquad);
      supabase.removeChannel(channel);
      queueChannelRef.current = null;
      navigate({ to: "/game/$roomId", params: { roomId } });
    };

    const makeMatch = (ids: string[]) => {
      const code = generateRoomCode();
      const roomId = queueMode === "ctf" ? `CTF-${code}` : `${queueMode.toUpperCase()}-${code}`;
      const squads: Record<string, string> = {};
      if (cfg.squadSize > 1) {
        ids.forEach((id, i) => { squads[id] = String.fromCharCode(65 + Math.floor(i / cfg.squadSize)); });
      }
      channel.send({ type: "broadcast", event: "match", payload: { roomId, squads } });
      launch(roomId, squads);
    };

    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState() as Record<string, { name?: string }[]>;
      const ids = Object.keys(state).sort();
      setQueuePlayers(ids);
      const host = ids[0] === identity.id;
      setIsHost(host);
      if (host && ids.length >= cfg.needed) makeMatch(ids);
    });

    channel.on("broadcast", { event: "match" }, ({ payload }) => {
      const p = payload as { roomId: string; squads: Record<string, string> };
      launch(p.roomId, p.squads);
    });

    channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") await channel.track({ name: identity.name });
    });

    startMatchRef.current = () => {
      const state = channel.presenceState() as Record<string, unknown>;
      makeMatch(Object.keys(state).sort());
    };

    const timer = window.setInterval(() => setQueueSeconds((s) => s + 1), 1000);
    return () => {
      window.clearInterval(timer);
      supabase.removeChannel(channel);
      queueChannelRef.current = null;
    };
  }, [queueMode, identity, navigate]);

  function openQueue(mode: QueueMode) {
    setQueueSeconds(0);
    setQueuePlayers([]);
    setQueueMode(mode);
  }

  const { data: officialMaps } = useQuery({
    queryKey: ["official-maps"],
    queryFn: async () => {
      const { data } = await supabase
        .from("custom_arenas")
        .select("room_id, name")
        .eq("is_official", true)
        .eq("published", true)
        .order("updated_at", { ascending: false });
      return data ?? [];
    },
  });

  const { data: myMapCount } = useQuery({
    queryKey: ["my-map-count", user?.id],
    enabled: !!user && !isGuest,
    queryFn: async () => {
      const { count } = await supabase
        .from("custom_arenas")
        .select("*", { count: "exact", head: true })
        .eq("owner_id", user!.id);
      return count ?? 0;
    },
  });

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

  function buildOfficialMap() {
    if (!isOwner) return;
    const code = generateRoomCode();
    navigate({ to: "/build/$roomId", params: { roomId: code } });
  }

  function joinCustomArena() {
    const code = customCode.trim().toUpperCase();
    if (code.length < 4) return toast.error("Enter a valid arena ID");
    navigate({ to: "/game/$roomId", params: { roomId: code } });
  }

  function openFFA() {
    setFfaPickerOpen(true);
  }
  function pickFFAMap(roomId: string) {
    setFfaPickerOpen(false);
    navigate({ to: "/game/$roomId", params: { roomId } });
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

        <div className="mt-10 rounded-xl border-2 border-emerald-400/60 bg-gradient-to-br from-emerald-400/15 to-primary/10 p-6 backdrop-blur">
          <div className="flex items-center gap-2">
            <Users className="size-5 text-emerald-300" />
            <h2 className="font-display text-lg font-bold uppercase tracking-wider">Queue up</h2>
            <span className="ml-auto rounded-full bg-emerald-400 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-black">NEW</span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Pick a mode and get matched with real players. Duos and trios get their own squad voice channel.
          </p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {(Object.keys(QUEUE_MODES) as QueueMode[]).map((m) => (
              <button
                key={m}
                onClick={() => openQueue(m)}
                className="rounded-lg border border-emerald-400/50 bg-emerald-400/10 p-4 text-left hover:bg-emerald-400/20"
              >
                <div className="font-display text-sm font-bold uppercase tracking-wider text-emerald-300">{QUEUE_MODES[m].label}</div>
                <div className="mt-1 text-xs text-muted-foreground">{QUEUE_MODES[m].blurb}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="mt-6 rounded-xl border-2 border-sky-400/60 bg-gradient-to-br from-sky-400/15 to-accent/10 p-6 backdrop-blur">
          <div className="flex items-center gap-2">
            <Crosshair className="size-5 text-sky-300" />
            <h2 className="font-display text-lg font-bold uppercase tracking-wider">Free play — aim trainer</h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Solo practice range with respawning targets and a live accuracy readout. No opponents, no pressure.
          </p>
          <Button
            onClick={() => navigate({ to: "/game/$roomId", params: { roomId: "PRACTICE" } })}
            className="mt-5 h-12 w-full bg-sky-400 font-bold uppercase tracking-widest text-black hover:bg-sky-400/90"
          >
            Enter free play
          </Button>
        </div>

        <div className="mt-6 grid gap-6 md:grid-cols-2">
          <div className="rounded-xl border-2 border-accent/60 bg-gradient-to-br from-accent/15 to-primary/10 p-6 backdrop-blur md:col-span-2">
            <div className="flex items-center gap-2">
              <Zap className="size-5 text-accent" />
              <h2 className="font-display text-lg font-bold uppercase tracking-wider">Free-for-All</h2>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Every player for themselves — pick a map and fight for the most frags.
            </p>
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              <Button
                onClick={openFFA}
                className="h-12 w-full bg-accent font-bold uppercase tracking-widest text-accent-foreground hover:bg-accent/90"
              >
                Drop into FFA
              </Button>
              {isOwner && (
                <Button
                  onClick={buildOfficialMap}
                  className="h-12 w-full bg-primary font-bold uppercase tracking-widest text-primary-foreground hover:bg-primary/90 shadow-[0_0_20px_var(--primary)]"
                >
                  <Star className="mr-2 size-4" /> Build official map
                </Button>
              )}
            </div>
          </div>

          <div className="rounded-xl border-2 border-rose-500/60 bg-gradient-to-br from-rose-500/15 to-sky-500/15 p-6 backdrop-blur md:col-span-2">
            <div className="flex items-center gap-2">
              <Flag className="size-5 text-rose-400" />
              <h2 className="font-display text-lg font-bold uppercase tracking-wider">Minigame — Capture the Flag</h2>
              <span className="ml-auto rounded-full bg-rose-500 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">NEW</span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Red vs Blue, pistols only. Steal the enemy flag, run it back to your base. First team to 3 captures wins.
            </p>
            <Button
              onClick={() => navigate({ to: "/game/$roomId", params: { roomId: "CTF" } })}
              className="mt-5 h-12 w-full bg-rose-500 font-bold uppercase tracking-widest text-white hover:bg-rose-500/90 shadow-[0_0_20px_rgba(244,63,94,0.6)]"
            >
              Play Capture the Flag
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

        {!isGuest && (
          <div className="mt-6">
            <Button asChild variant="outline" className="w-full h-12">
              <Link to="/my-maps">
                <FolderOpen className="mr-2 size-4" />
                My maps
                <span className="ml-2 rounded-full bg-primary/20 px-2 py-0.5 text-xs font-bold text-primary">
                  {myMapCount ?? 0}
                </span>
              </Link>
            </Button>
          </div>
        )}
      </div>

      {queueMode && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/85 backdrop-blur p-4">
          <div className="w-full max-w-md rounded-xl border-2 border-emerald-400/60 bg-card p-6 text-center shadow-[0_0_40px_rgba(52,211,153,0.4)]">
            <Loader2 className="mx-auto size-8 animate-spin text-emerald-300" />
            <h3 className="mt-4 font-display text-xl font-black uppercase tracking-wider">
              Searching — {QUEUE_MODES[queueMode].label}
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              {queuePlayers.length} / {QUEUE_MODES[queueMode].needed} players · {queueSeconds}s
            </p>
            <div className="mt-4 flex gap-2">
              {isHost && queuePlayers.length >= 2 && (
                <Button onClick={() => startMatchRef.current()} className="h-11 flex-1 bg-emerald-400 font-bold uppercase tracking-widest text-black hover:bg-emerald-400/90">
                  Start now
                </Button>
              )}
              <Button variant="outline" className="h-11 flex-1" onClick={() => setQueueMode(null)}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      {ffaPickerOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/80 backdrop-blur p-4" onClick={() => setFfaPickerOpen(false)}>
          <div className="w-full max-w-lg rounded-xl border-2 border-accent/60 bg-card p-6 shadow-[0_0_40px_var(--accent)]" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-display text-xl font-black uppercase tracking-wider">Pick a map</h3>
              <button onClick={() => setFfaPickerOpen(false)} className="text-muted-foreground hover:text-primary" aria-label="Close">
                <X className="size-5" />
              </button>
            </div>
            <div className="grid gap-2">
              <button
                onClick={() => pickFFAMap("FFA")}
                className="flex items-center justify-between rounded-lg border border-accent/60 bg-accent/10 p-4 text-left hover:bg-accent/20"
              >
                <div>
                  <div className="font-display font-bold uppercase tracking-wider text-accent">Default arena</div>
                  <div className="text-xs text-muted-foreground">The classic neon grid</div>
                </div>
                <Zap className="size-5 text-accent" />
              </button>
              {officialMaps?.map((m) => (
                <button
                  key={m.room_id}
                  onClick={() => pickFFAMap(m.room_id)}
                  className="flex items-center justify-between rounded-lg border border-primary/40 bg-primary/5 p-4 text-left hover:bg-primary/15"
                >
                  <div>
                    <div className="font-display font-bold uppercase tracking-wider text-primary">{m.name || m.room_id}</div>
                    <div className="text-xs text-muted-foreground">Official map · ID {m.room_id}</div>
                  </div>
                  <Star className="size-5 text-primary" />
                </button>
              ))}
              {(!officialMaps || officialMaps.length === 0) && (
                <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                  No official maps yet {isOwner ? "— build one!" : ""}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
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