import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ArenaScene, type GameState, type RemotePlayer, type PlayerPose, type ShotEvent } from "@/components/game/Arena";
import { Crosshair, Heart, Users, X, Zap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/_authenticated/game/$roomId")({
  head: () => ({ meta: [{ title: "Match — NEONFRAG" }] }),
  ssr: false,
  component: Game,
});

function Game() {
  const { roomId } = Route.useParams();
  const { user } = useAuth();
  const mode = roomId === "FFA" ? "Free-for-All" : `Room ${roomId}`;
  const controls = useRef({ moveX: 0, moveY: 0, yaw: 0, pitch: 0, fire: false });
  const [hud, setHud] = useState<GameState>({ hp: 100, kills: 0, deaths: 0, ammo: 30 });
  const [feed, setFeed] = useState<{ id: number; msg: string }[]>([]);
  const feedId = useRef(0);
  const [playerCount, setPlayerCount] = useState(1);

  // Multiplayer refs
  const remotePlayersRef = useRef<Map<string, RemotePlayer>>(new Map());
  const incomingHitRef = useRef(0);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const myIdRef = useRef<string>("");
  const myNameRef = useRef<string>("Player");

  // Joystick state
  const stick = useRef<{ touchId: number | null; cx: number; cy: number }>({ touchId: null, cx: 0, cy: 0 });
  const look = useRef<{ touchId: number | null; lx: number; ly: number }>({ touchId: null, lx: 0, ly: 0 });
  const [stickKnob, setStickKnob] = useState({ x: 0, y: 0, active: false });

  function onKillFeed(msg: string) {
    const id = ++feedId.current;
    setFeed((f) => [...f, { id, msg }].slice(-4));
    setTimeout(() => setFeed((f) => f.filter((x) => x.id !== id)), 2500);
  }

  // Supabase Realtime: presence + pose broadcast + shots
  useEffect(() => {
    if (!user) return;
    myIdRef.current = user.id;
    let cancelled = false;

    (async () => {
      const { data: prof } = await supabase
        .from("profiles")
        .select("username")
        .eq("id", user.id)
        .maybeSingle();
      if (cancelled) return;
      myNameRef.current = prof?.username ?? `P${user.id.slice(0, 4)}`;

      const channel = supabase.channel(`room:${roomId}`, {
        config: { presence: { key: user.id } },
      });
      channelRef.current = channel;

      channel.on("presence", { event: "sync" }, () => {
        const state = channel.presenceState() as Record<string, { name?: string }[]>;
        const ids = Object.keys(state);
        setPlayerCount(ids.length);
        // drop disconnected
        for (const id of [...remotePlayersRef.current.keys()]) {
          if (!ids.includes(id)) remotePlayersRef.current.delete(id);
        }
        // ensure entries (positions will arrive via pose events)
        for (const id of ids) {
          if (id === user.id) continue;
          if (!remotePlayersRef.current.has(id)) {
            const name = state[id]?.[0]?.name ?? "Rival";
            remotePlayersRef.current.set(id, {
              id, name, x: 0, y: 0.9, z: 0, yaw: 0, alive: true,
            });
          }
        }
      });

      channel.on("broadcast", { event: "pose" }, ({ payload }) => {
        const p = payload as PlayerPose & { id: string; name: string };
        if (p.id === user.id) return;
        const existing = remotePlayersRef.current.get(p.id);
        remotePlayersRef.current.set(p.id, {
          id: p.id,
          name: p.name ?? existing?.name ?? "Rival",
          x: p.x, y: p.y, z: p.z,
          yaw: p.yaw,
          alive: p.alive,
        });
      });

      channel.on("broadcast", { event: "hit" }, ({ payload }) => {
        const p = payload as { targetId: string; damage: number; shooterName: string };
        if (p.targetId !== user.id) return;
        incomingHitRef.current += p.damage;
        const id = ++feedId.current;
        setFeed((f) => [...f, { id, msg: `${p.shooterName} hit you` }].slice(-4));
        setTimeout(() => setFeed((f) => f.filter((x) => x.id !== id)), 2500);
      });

      channel.subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({ name: myNameRef.current });
        }
      });
    })();

    return () => {
      cancelled = true;
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [user, roomId]);

  function handlePose(p: PlayerPose) {
    const ch = channelRef.current;
    if (!ch) return;
    ch.send({
      type: "broadcast",
      event: "pose",
      payload: { ...p, id: myIdRef.current, name: myNameRef.current },
    });
  }

  function handleShoot(_s: ShotEvent, hitId: string | null) {
    const ch = channelRef.current;
    if (!ch || !hitId) return;
    ch.send({
      type: "broadcast",
      event: "hit",
      payload: { targetId: hitId, damage: 34, shooterName: myNameRef.current },
    });
  }

  function handleLocalDeath() {
    // already added to feed via hit event
  }

  // Touch handlers on root
  useEffect(() => {
    function onStart(e: TouchEvent) {
      for (const t of Array.from(e.changedTouches)) {
        const isLeft = t.clientX < window.innerWidth / 2;
        if (isLeft && stick.current.touchId === null) {
          stick.current.touchId = t.identifier;
          stick.current.cx = t.clientX;
          stick.current.cy = t.clientY;
          setStickKnob({ x: 0, y: 0, active: true });
        } else if (!isLeft && look.current.touchId === null) {
          look.current.touchId = t.identifier;
          look.current.lx = t.clientX;
          look.current.ly = t.clientY;
        }
      }
    }
    function onMove(e: TouchEvent) {
      e.preventDefault();
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === stick.current.touchId) {
          const dx = t.clientX - stick.current.cx;
          const dy = t.clientY - stick.current.cy;
          const max = 50;
          const len = Math.min(Math.hypot(dx, dy), max);
          const ang = Math.atan2(dy, dx);
          const kx = Math.cos(ang) * len;
          const ky = Math.sin(ang) * len;
          setStickKnob({ x: kx, y: ky, active: true });
          controls.current.moveX = kx / max;
          controls.current.moveY = -ky / max;
        } else if (t.identifier === look.current.touchId) {
          const dx = t.clientX - look.current.lx;
          const dy = t.clientY - look.current.ly;
          look.current.lx = t.clientX;
          look.current.ly = t.clientY;
          const sens = 0.005;
          controls.current.yaw -= dx * sens;
          controls.current.pitch -= dy * sens;
          controls.current.pitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, controls.current.pitch));
        }
      }
    }
    function onEnd(e: TouchEvent) {
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === stick.current.touchId) {
          stick.current.touchId = null;
          controls.current.moveX = 0;
          controls.current.moveY = 0;
          setStickKnob({ x: 0, y: 0, active: false });
        } else if (t.identifier === look.current.touchId) {
          look.current.touchId = null;
        }
      }
    }
    const opts = { passive: false } as AddEventListenerOptions;
    window.addEventListener("touchstart", onStart, opts);
    window.addEventListener("touchmove", onMove, opts);
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", onEnd);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, []);

  return (
    <div className="fixed inset-0 bg-black touch-none select-none overscroll-none">
      <ArenaScene
        controls={controls}
        onStateChange={setHud}
        onKillFeed={onKillFeed}
        remotePlayersRef={remotePlayersRef}
        onPose={handlePose}
        onShoot={handleShoot}
        incomingHitRef={incomingHitRef}
        onLocalDeath={handleLocalDeath}
      />

      {/* HUD */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <Crosshair className="size-6 text-primary opacity-70" strokeWidth={1.5} />
        </div>

        <div className="absolute top-0 left-0 right-0 flex items-start justify-between p-3">
          <Link
            to="/play"
            className="pointer-events-auto flex items-center gap-1 rounded-md bg-black/60 px-3 py-2 text-xs font-display uppercase tracking-widest text-primary backdrop-blur"
          >
            <X className="size-4" /> Leave
          </Link>
          <div className="rounded-md bg-black/60 px-3 py-2 text-center font-display text-xs uppercase tracking-widest text-primary backdrop-blur">
            <div>{mode}</div>
            <div className="mt-0.5 flex items-center justify-center gap-1 text-accent">
              <Users className="size-3" /> {playerCount}
            </div>
          </div>
          <div className="rounded-md bg-black/60 px-3 py-2 text-right font-display text-xs uppercase tracking-widest backdrop-blur">
            <div className="text-primary">K {hud.kills}</div>
            <div className="text-accent">D {hud.deaths}</div>
          </div>
        </div>

        <div className="absolute top-16 right-3 space-y-1">
          {feed.map((f) => (
            <div key={f.id} className="rounded bg-black/60 px-2 py-1 text-xs text-foreground backdrop-blur">
              {f.msg}
            </div>
          ))}
        </div>

        <div className="absolute bottom-3 left-3 right-3 flex items-end justify-between">
          <div className="rounded-md bg-black/60 px-3 py-2 backdrop-blur">
            <div className="flex items-center gap-2 text-sm font-bold">
              <Heart className="size-4 text-destructive" />
              <span style={{ color: hud.hp > 40 ? "var(--primary)" : "oklch(0.7 0.25 25)" }}>
                {hud.hp}
              </span>
            </div>
            <div className="mt-1 h-1 w-24 rounded bg-white/10">
              <div
                className="h-full rounded bg-primary transition-all"
                style={{ width: `${hud.hp}%` }}
              />
            </div>
          </div>
          <div className="rounded-md bg-black/60 px-3 py-2 text-right backdrop-blur">
            <div className="flex items-center gap-2 text-sm font-bold text-accent">
              <Zap className="size-4" /> {hud.ammo}/30
            </div>
          </div>
        </div>
      </div>

      {/* Joystick */}
      <div
        className={`pointer-events-none absolute left-6 bottom-24 size-32 rounded-full border-2 border-primary/40 bg-black/30 backdrop-blur transition-opacity ${
          stickKnob.active ? "opacity-100" : "opacity-40"
        }`}
      >
        <div
          className="absolute left-1/2 top-1/2 size-14 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/80 shadow-[0_0_20px_var(--primary)]"
          style={{ transform: `translate(calc(-50% + ${stickKnob.x}px), calc(-50% + ${stickKnob.y}px))` }}
        />
      </div>

      {/* Fire button */}
      <button
        onTouchStart={(e) => {
          e.preventDefault();
          controls.current.fire = true;
        }}
        onTouchEnd={(e) => {
          e.preventDefault();
          controls.current.fire = false;
        }}
        className="absolute right-6 bottom-28 grid size-24 place-items-center rounded-full border-2 border-accent bg-accent/30 text-accent backdrop-blur active:bg-accent/60"
      >
        <Crosshair className="size-10" />
      </button>
    </div>
  );
}