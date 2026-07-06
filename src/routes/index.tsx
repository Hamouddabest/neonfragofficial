import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Crosshair, Gamepad2, Hammer, Mic, Users, UserCircle2, Star, Play } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { ensureGuest } from "@/hooks/use-identity";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "NEONFRAG — 3D Multiplayer FPS Arena" },
      { name: "description", content: "Drop into a neon arena, frag in real-time 3D, chat with voice. Free to play in your browser." },
      { property: "og:title", content: "NEONFRAG" },
      { property: "og:description", content: "3D multiplayer arena shooter with voice chat. Sign in to save your stats." },
    ],
  }),
  component: Index,
});

function Index() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const { data: officialMaps } = useQuery({
    queryKey: ["official-maps"],
    queryFn: async () => {
      const { data } = await supabase
        .from("custom_arenas")
        .select("room_id, name, blocks, spawn_points, updated_at")
        .eq("is_official", true)
        .eq("published", true)
        .order("updated_at", { ascending: false })
        .limit(12);
      return data ?? [];
    },
  });
  function playAsGuest() {
    ensureGuest();
    navigate({ to: "/play" });
  }
  return (
    <main className="relative min-h-dvh overflow-hidden">
      <div className="absolute inset-0 scanlines pointer-events-none opacity-60" />
      <nav className="relative z-10 flex items-center justify-between px-6 py-5 md:px-12">
        <Link to="/" className="font-display text-2xl font-black tracking-widest neon-text text-primary">
          NEON<span className="text-accent">FRAG</span>
        </Link>
        <div className="flex items-center gap-3">
          {!loading && (user ? (
            <Button asChild variant="default"><Link to="/play">Play</Link></Button>
          ) : (
            <>
              <Button asChild variant="ghost"><Link to="/auth">Sign in</Link></Button>
              <Button asChild><Link to="/auth" search={{ mode: "signup" }}>Sign up</Link></Button>
            </>
          ))}
        </div>
      </nav>

      <section className="relative z-10 mx-auto flex max-w-5xl flex-col items-center px-6 pt-16 pb-24 text-center md:pt-28">
        <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/5 px-4 py-1.5 text-xs uppercase tracking-[0.3em] text-primary">
          <span className="size-1.5 rounded-full bg-primary animate-pulse" /> Live arena · Real players
        </span>
        <h1 className="font-display text-5xl font-black uppercase leading-[0.95] tracking-tight md:text-7xl lg:text-8xl">
          Drop in.<br />
          <span className="text-primary neon-text">Frag out.</span>
        </h1>
        <p className="mt-6 max-w-xl text-lg text-muted-foreground">
          A browser-based 3D arena shooter. WASD to move, click to shoot, talk smack over voice chat — your stats save automatically.
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <Button asChild size="lg" className="h-14 px-10 text-base font-bold uppercase tracking-widest">
            <Link to={user ? "/play" : "/auth"}>
              <Crosshair className="mr-2" /> {user ? "Enter arena" : "Sign up & play"}
            </Link>
          </Button>
          <Button asChild size="lg" className="h-14 px-10 text-base font-bold uppercase tracking-widest bg-primary text-primary-foreground hover:bg-primary/90 shadow-[0_0_20px_var(--primary)]">
            <Link to={user ? "/play" : "/auth"} search={user ? undefined : { mode: "signup" }}>
              <Hammer className="mr-2" /> Build arena
            </Link>
          </Button>
          {!user && !loading && (
            <Button onClick={playAsGuest} size="lg" variant="outline" className="h-14 px-10 text-base font-bold uppercase tracking-widest border-accent text-accent hover:bg-accent/10">
              <UserCircle2 className="mr-2" /> Play as guest
            </Button>
          )}
        </div>

        <div className="mt-20 grid w-full grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[
            { icon: Gamepad2, title: "True 3D", body: "Real-time arena rendered in your browser with WebGL." },
            { icon: Users, title: "Multiplayer", body: "Create or join a room code and squad up with friends." },
            { icon: Mic, title: "Voice + Chat", body: "Talk over voice, type quick callouts. Built-in." },
            { icon: Hammer, title: "Creative Builder", body: "Build your own 3D arena with blocks, stairs, and spawn points." },
          ].map(({ icon: Icon, title, body }) => (
            <div key={title} className="rounded-lg border border-border/60 bg-card/60 p-6 text-left backdrop-blur">
              <Icon className="mb-3 text-primary" />
              <h3 className="font-display text-lg font-bold uppercase tracking-wider">{title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>

        {officialMaps && officialMaps.length > 0 && (
          <section className="mt-24 w-full text-left">
            <div className="mb-6 flex items-center justify-between gap-3">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-accent/40 bg-accent/5 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.3em] text-accent">
                  <Star className="size-3" /> Official maps
                </div>
                <h2 className="mt-3 font-display text-3xl font-black uppercase tracking-tight md:text-4xl">
                  Play the <span className="text-primary neon-text">official</span> maps
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">Built and published by the game owner.</p>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {officialMaps.map((m) => {
                const blockCount = Array.isArray(m.blocks) ? m.blocks.length : 0;
                const spawnCount = Array.isArray(m.spawn_points) ? m.spawn_points.length : 0;
                return (
                  <Link
                    key={m.room_id}
                    to={user ? "/game/$roomId" : "/auth"}
                    params={user ? { roomId: m.room_id } : undefined}
                    className="group rounded-xl border-2 border-primary/30 bg-gradient-to-br from-primary/10 to-accent/5 p-5 backdrop-blur transition hover:border-primary hover:shadow-[0_0_24px_var(--primary)]"
                  >
                    <div className="flex items-start justify-between">
                      <Star className="size-5 text-accent" />
                      <span className="rounded-full bg-primary/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-primary">Official</span>
                    </div>
                    <h3 className="mt-3 truncate font-display text-xl font-black uppercase tracking-wider text-primary">
                      {m.name || m.room_id}
                    </h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {blockCount} blocks · {spawnCount} spawns
                    </p>
                    <div className="mt-4 inline-flex items-center gap-1 text-xs font-bold uppercase tracking-widest text-accent">
                      <Play className="size-3" /> Drop in
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        )}
      </section>
    </main>
  );
}
