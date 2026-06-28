import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ArenaScene, type GameState, type RemotePlayer, type PlayerPose, type ShotEvent } from "@/components/game/Arena";
import { Crosshair, Heart, Maximize, Minimize, Mic, MicOff, MessageSquare, Monitor, RotateCw, Send, Smartphone, Users, X, Zap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Room, RoomEvent, Track, type RemoteTrack, type RemoteTrackPublication, type RemoteParticipant } from "livekit-client";
import { getLiveKitToken } from "@/lib/livekit.functions";

export const Route = createFileRoute("/_authenticated/game/$roomId")({
  head: () => ({ meta: [{ title: "Match — NEONFRAG" }] }),
  ssr: false,
  component: Game,
});

function Game() {
  const { roomId } = Route.useParams();
  const { user } = useAuth();
  const mode = roomId === "FFA" ? "Free-for-All" : `Room ${roomId}`;
  const controls = useRef({ moveX: 0, moveY: 0, yaw: 0, pitch: 0, fire: false, reload: false });
  const [hud, setHud] = useState<GameState>({ hp: 100, kills: 0, deaths: 0, ammo: 30 });
  const [feed, setFeed] = useState<{ id: number; msg: string }[]>([]);
  const feedId = useRef(0);
  const [playerCount, setPlayerCount] = useState(1);
  const [remoteIds, setRemoteIds] = useState<string[]>([]);
  const [chat, setChat] = useState<{ id: number; name: string; msg: string }[]>([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const chatId = useRef(0);
  const [platform, setPlatform] = useState<"none" | "pc" | "mobile">("none");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [needsLandscape, setNeedsLandscape] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Web Audio: synthesized weapon sounds
  const audioCtxRef = useRef<AudioContext | null>(null);
  function getAudio() {
    if (!audioCtxRef.current) {
      const Ctx = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
      audioCtxRef.current = new Ctx();
    }
    if (audioCtxRef.current.state === "suspended") audioCtxRef.current.resume().catch(() => {});
    return audioCtxRef.current;
  }
  function playShoot() {
    try {
      const ctx = getAudio();
      const t = ctx.currentTime;
      // noise burst
      const buf = ctx.createBuffer(1, ctx.sampleRate * 0.15, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 1600;
      bp.Q.value = 0.8;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.55, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
      src.connect(bp).connect(g).connect(ctx.destination);
      src.start(t);
      // low thump
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(160, t);
      osc.frequency.exponentialRampToValueAtTime(40, t + 0.12);
      const og = ctx.createGain();
      og.gain.setValueAtTime(0.6, t);
      og.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      osc.connect(og).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.13);
    } catch { /* noop */ }
  }
  function playReload() {
    try {
      const ctx = getAudio();
      const t0 = ctx.currentTime;
      const clicks = [0, 0.35, 0.7, 1.05, 1.35];
      for (const offset of clicks) {
        const t = t0 + offset;
        const osc = ctx.createOscillator();
        osc.type = "square";
        osc.frequency.setValueAtTime(380 + Math.random() * 120, t);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.25, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
        osc.connect(g).connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.08);
      }
    } catch { /* noop */ }
  }

  function triggerReload() {
    controls.current.reload = true;
    setTimeout(() => { controls.current.reload = false; }, 100);
  }

  // Fullscreen + orientation
  async function enterFullscreen() {
    const el = rootRef.current ?? document.documentElement;
    try {
      if (!document.fullscreenElement) await el.requestFullscreen();
      if (platform === "mobile") {
        const so = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
        if (so?.lock) await so.lock("landscape").catch(() => {});
      }
    } catch { /* noop */ }
  }
  async function toggleFullscreen() {
    if (document.fullscreenElement) {
      try { await document.exitFullscreen(); } catch { /* noop */ }
    } else {
      await enterFullscreen();
    }
  }
  useEffect(() => {
    const onFs = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  // Landscape check (mobile only)
  useEffect(() => {
    if (platform !== "mobile") { setNeedsLandscape(false); return; }
    const check = () => setNeedsLandscape(window.innerHeight > window.innerWidth);
    check();
    window.addEventListener("resize", check);
    window.addEventListener("orientationchange", check);
    return () => {
      window.removeEventListener("resize", check);
      window.removeEventListener("orientationchange", check);
    };
  }, [platform]);

  // Voice chat
  const roomRef = useRef<Room | null>(null);
  const [voiceState, setVoiceState] = useState<"idle" | "connecting" | "connected" | "error">("idle");
  const [muted, setMuted] = useState(true);
  const [voiceCount, setVoiceCount] = useState(0);

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
          // refresh names from presence
          const r = remotePlayersRef.current.get(id);
          const nm = state[id]?.[0]?.name;
          if (r && nm) r.name = nm;
        }
        setRemoteIds(ids.filter((i) => i !== user.id));
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

      channel.on("broadcast", { event: "chat" }, ({ payload }) => {
        const p = payload as { name: string; msg: string };
        const id = ++chatId.current;
        setChat((c) => [...c, { id, name: p.name, msg: p.msg }].slice(-30));
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

  // Connect LiveKit voice room
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const room = new Room({ adaptiveStream: true, dynacast: true });
    roomRef.current = room;
    setVoiceState("connecting");

    const audioEls = new Map<string, HTMLAudioElement>();
    function attachTrack(track: RemoteTrack, _pub: RemoteTrackPublication, participant: RemoteParticipant) {
      if (track.kind !== Track.Kind.Audio) return;
      const el = track.attach() as HTMLAudioElement;
      el.autoplay = true;
      el.style.display = "none";
      document.body.appendChild(el);
      audioEls.set(participant.identity + track.sid, el);
    }
    function detachTrack(track: RemoteTrack, _pub: RemoteTrackPublication, participant: RemoteParticipant) {
      if (track.kind !== Track.Kind.Audio) return;
      const key = participant.identity + track.sid;
      const el = audioEls.get(key);
      if (el) {
        track.detach(el);
        el.remove();
        audioEls.delete(key);
      }
    }
    room.on(RoomEvent.TrackSubscribed, attachTrack);
    room.on(RoomEvent.TrackUnsubscribed, detachTrack);
    room.on(RoomEvent.ParticipantConnected, () => setVoiceCount(room.numParticipants));
    room.on(RoomEvent.ParticipantDisconnected, () => setVoiceCount(room.numParticipants));

    (async () => {
      try {
        const { data: prof } = await supabase
          .from("profiles")
          .select("username")
          .eq("id", user.id)
          .maybeSingle();
        const name = prof?.username ?? `P${user.id.slice(0, 4)}`;
        const { token, url } = await getLiveKitToken({ data: { roomId, name } });
        if (cancelled) return;
        await room.connect(url, token);
        if (cancelled) {
          await room.disconnect();
          return;
        }
        await room.localParticipant.setMicrophoneEnabled(false);
        setMuted(true);
        setVoiceState("connected");
        setVoiceCount(room.numParticipants);
      } catch (e) {
        console.error("LiveKit connect failed", e);
        if (!cancelled) setVoiceState("error");
      }
    })();

    return () => {
      cancelled = true;
      for (const el of audioEls.values()) el.remove();
      audioEls.clear();
      room.disconnect().catch(() => {});
      roomRef.current = null;
    };
  }, [user, roomId]);

  async function toggleMute() {
    const room = roomRef.current;
    if (!room || voiceState !== "connected") return;
    const next = !muted;
    try {
      await room.localParticipant.setMicrophoneEnabled(!next);
      setMuted(next);
    } catch (e) {
      console.error("mic toggle failed", e);
    }
  }

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

  function sendChat() {
    const text = chatInput.trim().slice(0, 140);
    if (!text || !channelRef.current) return;
    channelRef.current.send({
      type: "broadcast",
      event: "chat",
      payload: { name: myNameRef.current, msg: text },
    });
    const id = ++chatId.current;
    setChat((c) => [...c, { id, name: myNameRef.current, msg: text }].slice(-30));
    setChatInput("");
  }

  // Touch handlers on root
  useEffect(() => {
    if (platform !== "mobile") return;
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
  }, [platform]);

  // PC controls: pointer lock, WASD, mouse look, click fire, R reload
  useEffect(() => {
    if (platform !== "pc") return;
    const keys: Record<string, boolean> = {};
    const updateMove = () => {
      const mx = (keys["d"] ? 1 : 0) - (keys["a"] ? 1 : 0);
      const my = (keys["w"] ? 1 : 0) - (keys["s"] ? 1 : 0);
      controls.current.moveX = mx;
      controls.current.moveY = my;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      keys[k] = true;
      if (k === "r") triggerReload();
      if (["w", "a", "s", "d"].includes(k)) { e.preventDefault(); updateMove(); }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      keys[k] = false;
      if (["w", "a", "s", "d"].includes(k)) updateMove();
    };
    const onMouseMove = (e: MouseEvent) => {
      if (document.pointerLockElement !== rootRef.current) return;
      const sens = 0.0025;
      controls.current.yaw -= e.movementX * sens;
      controls.current.pitch -= e.movementY * sens;
      controls.current.pitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, controls.current.pitch));
    };
    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      if (document.pointerLockElement !== rootRef.current) {
        rootRef.current?.requestPointerLock();
        return;
      }
      controls.current.fire = true;
    };
    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 0) controls.current.fire = false;
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [platform]);

  return (
    <div ref={rootRef} className="fixed inset-0 bg-black touch-none select-none overscroll-none">
      <ArenaScene
        controls={controls}
        onStateChange={setHud}
        onKillFeed={onKillFeed}
        remotePlayersRef={remotePlayersRef}
        remoteIds={remoteIds}
        onPose={handlePose}
        onShoot={handleShoot}
        incomingHitRef={incomingHitRef}
        onLocalDeath={handleLocalDeath}
        onFireSound={playShoot}
        onReloadSound={playReload}
      />

      {/* HUD */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <Crosshair className="size-6 text-primary opacity-70" strokeWidth={1.5} />
        </div>

        <div className="absolute top-0 left-0 right-0 flex items-start justify-between p-3">
          <div className="pointer-events-auto flex items-center gap-2">
            <Link
              to="/play"
              className="flex items-center gap-1 rounded-md bg-black/60 px-3 py-2 text-xs font-display uppercase tracking-widest text-primary backdrop-blur"
            >
              <X className="size-4" /> Leave
            </Link>
            <button
              onClick={toggleFullscreen}
              className="flex items-center gap-1 rounded-md bg-black/60 px-3 py-2 text-xs font-display uppercase tracking-widest text-accent backdrop-blur"
              aria-label="Toggle fullscreen"
            >
              {isFullscreen ? <Minimize className="size-4" /> : <Maximize className="size-4" />}
            </button>
          </div>
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

        {/* Chat overlay */}
        <div className="pointer-events-none absolute left-3 top-20 max-w-[55%] space-y-1">
          {chat.slice(-5).map((c) => (
            <div
              key={c.id}
              className="rounded bg-black/60 px-2 py-1 text-xs backdrop-blur"
            >
              <span className="font-display uppercase tracking-widest text-primary">{c.name}:</span>{" "}
              <span className="text-foreground">{c.msg}</span>
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

      {/* Chat toggle + panel */}
      <button
        onClick={() => setChatOpen((v) => !v)}
        className="absolute right-3 top-20 z-20 grid size-10 place-items-center rounded-full border border-primary/50 bg-black/60 text-primary backdrop-blur"
        aria-label="Toggle chat"
      >
        <MessageSquare className="size-5" />
      </button>

      {/* Voice mute toggle */}
      <button
        onClick={toggleMute}
        disabled={voiceState !== "connected"}
        className={`absolute right-3 top-32 z-20 grid size-10 place-items-center rounded-full border backdrop-blur ${
          voiceState === "connected"
            ? muted
              ? "border-destructive/60 bg-black/60 text-destructive"
              : "border-accent/60 bg-accent/30 text-accent"
            : "border-muted-foreground/40 bg-black/60 text-muted-foreground opacity-60"
        }`}
        aria-label={muted ? "Unmute" : "Mute"}
        title={
          voiceState === "connected"
            ? `${muted ? "Unmute" : "Mute"} (${voiceCount + 1} in voice)`
            : voiceState === "connecting"
              ? "Connecting voice…"
              : voiceState === "error"
                ? "Voice unavailable"
                : "Voice"
        }
      >
        {muted ? <MicOff className="size-5" /> : <Mic className="size-5" />}
      </button>
      {chatOpen && (
        <div className="absolute inset-x-3 bottom-56 z-20 rounded-md border border-primary/40 bg-black/80 p-2 backdrop-blur">
          <div className="mb-2 max-h-40 space-y-1 overflow-y-auto text-xs">
            {chat.length === 0 ? (
              <div className="text-muted-foreground">No messages yet. Say hi!</div>
            ) : (
              chat.map((c) => (
                <div key={c.id}>
                  <span className="font-display uppercase tracking-widest text-primary">{c.name}:</span>{" "}
                  <span className="text-foreground">{c.msg}</span>
                </div>
              ))
            )}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              sendChat();
            }}
            className="flex items-center gap-2"
          >
            <input
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder="Message…"
              maxLength={140}
              className="flex-1 rounded border border-primary/30 bg-black/70 px-2 py-1.5 text-sm text-foreground outline-none focus:border-primary"
            />
            <button
              type="submit"
              className="grid size-9 place-items-center rounded border border-accent bg-accent/30 text-accent active:bg-accent/60"
              aria-label="Send"
            >
              <Send className="size-4" />
            </button>
          </form>
        </div>
      )}

      {platform === "mobile" && (
        <>
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
            onTouchStart={(e) => { e.preventDefault(); controls.current.fire = true; }}
            onTouchEnd={(e) => { e.preventDefault(); controls.current.fire = false; }}
            className="absolute right-6 bottom-28 grid size-24 place-items-center rounded-full border-2 border-accent bg-accent/30 text-accent backdrop-blur active:bg-accent/60"
          >
            <Crosshair className="size-10" />
          </button>

          {/* Reload button */}
          <button
            onTouchStart={(e) => { e.preventDefault(); triggerReload(); }}
            className="absolute right-32 bottom-32 grid size-16 place-items-center rounded-full border-2 border-primary/60 bg-black/50 text-primary backdrop-blur active:bg-primary/30"
            aria-label="Reload"
          >
            <RotateCw className="size-7" />
          </button>
        </>
      )}

      {platform === "pc" && document.pointerLockElement !== rootRef.current && (
        <div className="pointer-events-none absolute inset-x-0 top-1/3 text-center">
          <div className="inline-block rounded-md bg-black/70 px-4 py-2 font-display text-xs uppercase tracking-widest text-primary backdrop-blur">
            Click to play · WASD move · Mouse aim · Click fire · R reload
          </div>
        </div>
      )}

      {/* Platform selection modal */}
      {platform === "none" && (
        <div className="absolute inset-0 z-50 grid place-items-center bg-black/90 backdrop-blur">
          <div className="w-[90%] max-w-md rounded-lg border border-primary/40 bg-black/80 p-6 text-center">
            <h2 className="font-display text-xl uppercase tracking-widest text-primary">Choose your device</h2>
            <p className="mt-2 text-sm text-muted-foreground">Pick how you're playing so we load the right controls.</p>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <button
                onClick={() => { setPlatform("pc"); getAudio(); }}
                className="flex flex-col items-center gap-2 rounded-md border border-accent/50 bg-accent/10 p-4 font-display uppercase tracking-widest text-accent hover:bg-accent/20"
              >
                <Monitor className="size-8" />
                <span>Are you on PC</span>
                <span className="text-[10px] normal-case tracking-normal text-muted-foreground">WASD + Mouse</span>
              </button>
              <button
                onClick={async () => {
                  setPlatform("mobile");
                  getAudio();
                  await enterFullscreen();
                }}
                className="flex flex-col items-center gap-2 rounded-md border border-primary/50 bg-primary/10 p-4 font-display uppercase tracking-widest text-primary hover:bg-primary/20"
              >
                <Smartphone className="size-8" />
                <span>Are you on Mobile</span>
                <span className="text-[10px] normal-case tracking-normal text-muted-foreground">Touch + Joystick</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rotate-to-landscape overlay (mobile) */}
      {platform === "mobile" && needsLandscape && (
        <div className="absolute inset-0 z-40 grid place-items-center bg-black/95 text-center">
          <div className="px-6">
            <RotateCw className="mx-auto size-12 animate-spin text-primary" style={{ animationDuration: "3s" }} />
            <p className="mt-4 font-display text-sm uppercase tracking-widest text-primary">Rotate your device</p>
            <p className="mt-1 text-xs text-muted-foreground">This game plays in landscape</p>
            <button
              onClick={enterFullscreen}
              className="mt-4 rounded-md border border-accent bg-accent/20 px-4 py-2 text-xs font-display uppercase tracking-widest text-accent"
            >
              Go fullscreen
            </button>
          </div>
        </div>
      )}
    </div>
  );
}