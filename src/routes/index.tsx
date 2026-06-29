import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Crosshair, Gamepad2, Hammer, Mic, Users } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

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
          <Button asChild size="lg" variant="outline" className="h-14 px-10 text-base uppercase tracking-widest">
            <Link to="/auth">How it works</Link>
          </Button>
        </div>

        <div className="mt-20 grid w-full grid-cols-1 gap-4 md:grid-cols-3">
          {[
            { icon: Gamepad2, title: "True 3D", body: "Real-time arena rendered in your browser with WebGL." },
            { icon: Users, title: "Multiplayer", body: "Create or join a room code and squad up with friends." },
            { icon: Mic, title: "Voice + Chat", body: "Talk over voice, type quick callouts. Built-in." },
          ].map(({ icon: Icon, title, body }) => (
            <div key={title} className="rounded-lg border border-border/60 bg-card/60 p-6 text-left backdrop-blur">
              <Icon className="mb-3 text-primary" />
              <h3 className="font-display text-lg font-bold uppercase tracking-wider">{title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
