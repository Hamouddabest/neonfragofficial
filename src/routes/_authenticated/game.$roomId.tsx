import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/game/$roomId")({
  head: () => ({ meta: [{ title: "Match — NEONFRAG" }] }),
  component: Game,
});

function Game() {
  const { roomId } = Route.useParams();
  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <div className="absolute inset-0 scanlines pointer-events-none opacity-40" />
      <div className="relative z-10 max-w-lg">
        <p className="text-xs uppercase tracking-[0.4em] text-muted-foreground">Room</p>
        <h1 className="mt-2 font-display text-5xl font-black tracking-widest text-primary neon-text">{roomId}</h1>
        <p className="mt-6 text-muted-foreground">
          The 3D arena, multiplayer sync, text and voice chat ship in the next builds.
          Share this code so friends can join.
        </p>
        <Link to="/play" className="mt-8 inline-block text-sm uppercase tracking-widest text-primary hover:underline">
          ← Back to lobby
        </Link>
      </div>
    </main>
  );
}