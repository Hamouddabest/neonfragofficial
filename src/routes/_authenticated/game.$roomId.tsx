import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ArenaScene, type GameState, type RemotePlayer, type PlayerPose, type ShotEvent, type CustomArena, type WeaponId, type Rank, type LocalOps, type LocalPos, type CTFState, type FlagEvent, type Team, type Quality, type PracticeStats, type CarsState, type CarEvent, WEAPONS, makeCTFState, makeCars, CAR_SPAWNS, CAR_BLAST_RADIUS, CAR_RESPAWN_MS, CTF_BASES, CTF_SCORE_LIMIT, TEAM_COLORS } from "@/components/game/Arena";
import { Car as CarIcon, ChevronUp, Crosshair as CrosshairIcon, Gamepad2, Headphones, Heart, Maximize, Minimize, Mic, MicOff, MessageSquare, Monitor, RotateCw, Search, Send, Settings as SettingsIcon, Smartphone, Sliders, Target, Rocket, Users, X, Zap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useIdentity } from "@/hooks/use-identity";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { useAuth } from "@/hooks/use-auth";
import { Room, RoomEvent, Track, RemoteAudioTrack, type LocalAudioTrack, type RemoteTrack, type RemoteTrackPublication, type RemoteParticipant } from "livekit-client";
import { getLiveKitToken, getLiveKitTokenPublic } from "@/lib/livekit.functions";

const OWNER_EMAIL = "totallybro541@gmail.com";

type CrosshairCfg = { size: number; gap: number; thickness: number; color: string; dot: boolean; outline: boolean };
const CROSSHAIR_DEFAULT: CrosshairCfg = { size: 10, gap: 4, thickness: 2, color: "#22d3ee", dot: true, outline: true };
const CROSSHAIR_COLORS = ["#22d3ee", "#4ade80", "#f43f5e", "#facc15", "#ffffff", "#a78bfa", "#f97316"];

function CustomCrosshair({ cfg }: { cfg: CrosshairCfg }) {
  const shadow = cfg.outline ? "0 0 0 1px rgba(0,0,0,0.9), 0 0 6px currentColor" : "0 0 6px currentColor";
  const arm = (style: React.CSSProperties) => (
    <span
      style={{
        position: "absolute",
        background: cfg.color,
        color: cfg.color,
        boxShadow: shadow,
        borderRadius: 1,
        ...style,
      }}
    />
  );
  return (
    <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
      <div style={{ position: "relative", width: 1, height: 1 }}>
        {arm({ width: cfg.thickness, height: cfg.size, left: -cfg.thickness / 2, top: -(cfg.gap + cfg.size) })}
        {arm({ width: cfg.thickness, height: cfg.size, left: -cfg.thickness / 2, top: cfg.gap })}
        {arm({ width: cfg.size, height: cfg.thickness, top: -cfg.thickness / 2, left: -(cfg.gap + cfg.size) })}
        {arm({ width: cfg.size, height: cfg.thickness, top: -cfg.thickness / 2, left: cfg.gap })}
        {cfg.dot &&
          arm({
            width: cfg.thickness,
            height: cfg.thickness,
            left: -cfg.thickness / 2,
            top: -cfg.thickness / 2,
            borderRadius: "50%",
          })}
      </div>
    </div>
  );
}
const PROXIMITY_MAX = 22; // full silence beyond this distance
const PROXIMITY_NEAR = 2; // full volume within this distance

export const Route = createFileRoute("/_authenticated/game/$roomId")({
  head: () => ({ meta: [{ title: "Match — NEONFRAG" }] }),
  ssr: false,
  component: Game,
});

function Game() {
  const { roomId } = Route.useParams();
  const { identity } = useIdentity();
  const { isAdmin } = useIsAdmin();
  const { user } = useAuth();
  const isOwner = !!user?.email && user.email.toLowerCase() === OWNER_EMAIL;
  const myRank: Rank = isOwner ? "owner" : isAdmin ? "admin" : "player";
  const myRankRef = useRef<Rank>("player");
  useEffect(() => { myRankRef.current = myRank; }, [myRank]);
  const isCTF = roomId === "CTF" || roomId.startsWith("CTF-");
  const isPractice = roomId === "PRACTICE";
  const mode = isPractice ? "Free Play — Aim Trainer" : isCTF ? "Capture the Flag" : roomId === "FFA" ? "Free-for-All" : `Room ${roomId}`;
  const startWeapon: WeaponId = isCTF ? "pistol" : "rifle";
  const controls = useRef({ moveX: 0, moveY: 0, yaw: 0, pitch: 0, fire: false, reload: false, jump: false, weapon: startWeapon as WeaponId, zoom: false, interact: false });
  const [hud, setHud] = useState<GameState>({ hp: 100, kills: 0, deaths: 0, ammo: 12, maxAmmo: 12, weapon: startWeapon, reloading: false });
  const [weapon, setWeaponState] = useState<WeaponId>(startWeapon);
  function selectWeapon(w: WeaponId) {
    if (isCTF) return; // pistol only
    controls.current.weapon = w;
    setWeaponState(w);
  }
  function triggerJump() {
    controls.current.jump = true;
    setTimeout(() => { controls.current.jump = false; }, 80);
  }
  function triggerInteract() {
    controls.current.interact = true;
    setTimeout(() => { controls.current.interact = false; }, 120);
  }
  const [feed, setFeed] = useState<{ id: number; msg: string }[]>([]);
  const feedId = useRef(0);
  const [playerCount, setPlayerCount] = useState(1);
  const [remoteIds, setRemoteIds] = useState<string[]>([]);
  const [chat, setChat] = useState<{ id: number; name: string; msg: string }[]>([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const chatId = useRef(0);
  const [platform, setPlatform] = useState<"none" | "pc" | "mobile" | "console">("none");
  const [padConnected, setPadConnected] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [needsLandscape, setNeedsLandscape] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const [customArena, setCustomArena] = useState<CustomArena | null>(null);

  // Refs plumbed into ArenaScene
  const localPosRef = useRef<LocalPos>({ x: 0, y: 1.6, z: 8 });
  const localOpsRef = useRef<LocalOps>({ teleport: null, frozen: false, god: false, speedMult: 1 });
  const speakingIdsRef = useRef<Set<string>>(new Set());
  const practiceStatsRef = useRef<PracticeStats>({ shots: 0, hits: 0 });
  const [practiceHud, setPracticeHud] = useState({ shots: 0, hits: 0 });
  useEffect(() => {
    if (!isPractice) return;
    const t = window.setInterval(() => setPracticeHud({ ...practiceStatsRef.current }), 250);
    return () => window.clearInterval(t);
  }, [isPractice]);

  // Squad (duos/trios queue) assignment, stored by the matchmaker in the lobby
  const squad = typeof window !== "undefined" ? window.sessionStorage.getItem(`neonfrag.squad.${roomId}`) : null;

  // ===== Capture the Flag =====
  const ctfRef = useRef<CTFState | null>(null);
  const [ctfHud, setCtfHud] = useState<{ team: Team; scoreRed: number; scoreBlue: number; carrying: boolean; enemyHasOurs: boolean } | null>(null);
  const [ctfWinner, setCtfWinner] = useState<Team | null>(null);
  const myIdentityId = identity?.id;
  useEffect(() => {
    if (!isCTF || !myIdentityId) { ctfRef.current = null; return; }
    let h = 0;
    for (let i = 0; i < myIdentityId.length; i++) h = (h * 31 + myIdentityId.charCodeAt(i)) >>> 0;
    const team: Team = h % 2 === 0 ? "red" : "blue";
    ctfRef.current = makeCTFState(team, myIdentityId);
    setCtfHud({ team, scoreRed: 0, scoreBlue: 0, carrying: false, enemyHasOurs: false });
  }, [isCTF, myIdentityId]);
  useEffect(() => {
    if (!isCTF) return;
    const t = window.setInterval(() => {
      const c = ctfRef.current;
      if (!c) return;
      const enemy: Team = c.myTeam === "red" ? "blue" : "red";
      setCtfHud({
        team: c.myTeam,
        scoreRed: c.scoreRed,
        scoreBlue: c.scoreBlue,
        carrying: c[enemy].carrierId === c.myId,
        enemyHasOurs: !!c[c.myTeam].carrierId,
      });
      if (c.scoreRed >= CTF_SCORE_LIMIT) setCtfWinner("red");
      else if (c.scoreBlue >= CTF_SCORE_LIMIT) setCtfWinner("blue");
    }, 200);
    return () => window.clearInterval(t);
  }, [isCTF]);

  function applyFlagEvent(e: FlagEvent) {
    const c = ctfRef.current;
    if (!c) return;
    const f = c[e.team];
    if (e.type === "pickup") {
      f.carrierId = e.byId;
      f.home = false;
    } else if (e.type === "drop") {
      f.carrierId = null;
      f.home = false;
      f.x = e.x;
      f.z = e.z;
    } else if (e.type === "return") {
      f.carrierId = null;
      f.home = true;
      f.x = CTF_BASES[e.team].x;
      f.z = CTF_BASES[e.team].z;
    } else if (e.type === "capture") {
      const enemy: Team = e.team === "red" ? "blue" : "red";
      c[enemy].carrierId = null;
      c[enemy].home = true;
      c[enemy].x = CTF_BASES[enemy].x;
      c[enemy].z = CTF_BASES[enemy].z;
      if (e.team === "red") c.scoreRed += 1; else c.scoreBlue += 1;
    }
  }

  function handleFlagEvent(e: FlagEvent) {
    channelRef.current?.send({ type: "broadcast", event: "flag", payload: e });
  }

  // ===== Vehicles =====
  const carsEnabled = !isPractice;
  const carsRef = useRef<CarsState | null>(carsEnabled ? makeCars() : null);
  const [drivingTeam, setDrivingTeam] = useState<Team | null>(null);

  function applyCarEvent(e: CarEvent, local: boolean) {
    const cars = carsRef.current;
    if (!cars) return;
    const car = cars[e.team];
    if (e.type === "enter") {
      car.driverId = e.byId;
    } else if (e.type === "exit") {
      car.driverId = null;
      car.x = e.x; car.z = e.z; car.yaw = e.yaw;
    } else if (e.type === "move") {
      if (!local) { car.x = e.x; car.z = e.z; car.yaw = e.yaw; }
    } else if (e.type === "damage") {
      if (!car.alive) return;
      car.hp -= e.damage;
      if (car.hp <= 0) {
        car.hp = 0;
        car.alive = false;
        car.driverId = null;
        car.respawnAt = Date.now() + CAR_RESPAWN_MS;
        // blast: everyone near the wreck loses 15–20 HP
        const d = Math.hypot(localPosRef.current.x - car.x, localPosRef.current.z - car.z);
        if (d <= CAR_BLAST_RADIUS) {
          incomingHitRef.current += 15 + Math.floor(Math.random() * 6);
        }
        const id = ++feedId.current;
        setFeed((f) => [...f, { id, msg: `💥 The ${e.team} car exploded!` }].slice(-4));
        setTimeout(() => setFeed((f) => f.filter((x) => x.id !== id)), 3000);
        setDrivingTeam((t) => (t === e.team ? null : t));
      }
    }
  }

  function handleCarEvent(e: CarEvent) {
    applyCarEvent(e, true);
    channelRef.current?.send({ type: "broadcast", event: "car", payload: e });
  }

  // Car respawn timer
  useEffect(() => {
    if (!carsEnabled) return;
    const t = window.setInterval(() => {
      const cars = carsRef.current;
      if (!cars) return;
      for (const team of ["red", "blue"] as Team[]) {
        const car = cars[team];
        if (!car.alive && Date.now() >= car.respawnAt) {
          car.alive = true;
          car.hp = car.maxHp;
          car.x = CAR_SPAWNS[team].x;
          car.z = CAR_SPAWNS[team].z;
          car.yaw = CAR_SPAWNS[team].yaw;
          car.driverId = null;
        }
      }
    }, 1000);
    return () => window.clearInterval(t);
  }, [carsEnabled]);

  // Player settings (persisted in localStorage)
  const [fov, setFov] = useState<number>(() => {
    if (typeof window === "undefined") return 75;
    const v = Number(window.localStorage.getItem("neonfrag.fov"));
    return Number.isFinite(v) && v >= 60 && v <= 110 ? v : 75;
  });
  const [viewBobbing, setViewBobbing] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    return window.localStorage.getItem("neonfrag.bobbing") !== "0";
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [quality, setQuality] = useState<Quality>(() => {
    if (typeof window === "undefined") return "balanced";
    const v = window.localStorage.getItem("neonfrag.quality");
    return v === "simple" || v === "fancy" || v === "balanced" ? v : "balanced";
  });
  useEffect(() => { try { window.localStorage.setItem("neonfrag.quality", quality); } catch { /* noop */ } }, [quality]);

  // ===== Crosshair customization =====
  const [crosshair, setCrosshair] = useState<CrosshairCfg>(() => {
    if (typeof window === "undefined") return CROSSHAIR_DEFAULT;
    try {
      const raw = window.localStorage.getItem("neonfrag.crosshair");
      return raw ? { ...CROSSHAIR_DEFAULT, ...(JSON.parse(raw) as Partial<CrosshairCfg>) } : CROSSHAIR_DEFAULT;
    } catch { return CROSSHAIR_DEFAULT; }
  });
  useEffect(() => {
    try { window.localStorage.setItem("neonfrag.crosshair", JSON.stringify(crosshair)); } catch { /* noop */ }
  }, [crosshair]);

  // ===== Voice settings =====
  const [voicePanelOpen, setVoicePanelOpen] = useState(false);
  const [devices, setDevices] = useState<{ inputs: MediaDeviceInfo[]; outputs: MediaDeviceInfo[] }>({ inputs: [], outputs: [] });
  const [inputId, setInputId] = useState<string>(() => (typeof window === "undefined" ? "" : window.localStorage.getItem("neonfrag.mic") ?? ""));
  const [outputId, setOutputId] = useState<string>(() => (typeof window === "undefined" ? "" : window.localStorage.getItem("neonfrag.spk") ?? ""));
  const [sensitivity, setSensitivity] = useState<number>(() => {
    if (typeof window === "undefined") return 8;
    const v = Number(window.localStorage.getItem("neonfrag.micSens"));
    return Number.isFinite(v) && v >= 0 && v <= 60 ? v : 8;
  });
  const sensitivityRef = useRef(sensitivity);
  useEffect(() => { sensitivityRef.current = sensitivity; try { window.localStorage.setItem("neonfrag.micSens", String(sensitivity)); } catch { /* noop */ } }, [sensitivity]);
  const [micLevel, setMicLevel] = useState(0);
  const [voiceScope, setVoiceScope] = useState<"all" | "team">("team");
  const myTeamKey = isCTF ? (ctfHud?.team ?? null) : squad;
  const voiceRoomId = myTeamKey && voiceScope === "team" ? `${roomId}__${myTeamKey}` : roomId;

  async function refreshDevices() {
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      setDevices({
        inputs: list.filter((d) => d.kind === "audioinput"),
        outputs: list.filter((d) => d.kind === "audiooutput"),
      });
    } catch { /* noop */ }
  }
  async function requestMicPermission() {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
    } catch { /* noop */ }
    await refreshDevices();
  }
  useEffect(() => {
    refreshDevices();
    navigator.mediaDevices?.addEventListener?.("devicechange", refreshDevices);
    return () => navigator.mediaDevices?.removeEventListener?.("devicechange", refreshDevices);
  }, []);
  async function changeInput(id: string) {
    setInputId(id);
    try { window.localStorage.setItem("neonfrag.mic", id); } catch { /* noop */ }
    try { await roomRef.current?.switchActiveDevice("audioinput", id); } catch { /* noop */ }
  }
  async function changeOutput(id: string) {
    setOutputId(id);
    try { window.localStorage.setItem("neonfrag.spk", id); } catch { /* noop */ }
    try { await roomRef.current?.switchActiveDevice("audiooutput", id); } catch { /* noop */ }
  }
  useEffect(() => { try { window.localStorage.setItem("neonfrag.fov", String(fov)); } catch { /* noop */ } }, [fov]);
  useEffect(() => { try { window.localStorage.setItem("neonfrag.bobbing", viewBobbing ? "1" : "0"); } catch { /* noop */ } }, [viewBobbing]);

  function setZoom(on: boolean) { controls.current.zoom = on; }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("custom_arenas")
        .select("blocks, spawn_points, confirmed")
        .eq("room_id", roomId)
        .maybeSingle();
      if (cancelled) return;
      if (data && data.confirmed) {
        setCustomArena({
          blocks: (data.blocks as unknown as CustomArena["blocks"]) ?? [],
          spawnPoints: (data.spawn_points as unknown as CustomArena["spawnPoints"]) ?? [],
        });
      }
    })();
    return () => { cancelled = true; };
  }, [roomId]);

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
    if (!identity || isPractice) return;
    myIdRef.current = identity.id;
    let cancelled = false;

    (async () => {
      if (identity.isGuest) {
        myNameRef.current = identity.name;
      } else {
        const { data: prof } = await supabase
          .from("profiles")
          .select("username")
          .eq("id", identity.id)
          .maybeSingle();
        if (cancelled) return;
        myNameRef.current = prof?.username ?? `P${identity.id.slice(0, 4)}`;
      }

      const channel = supabase.channel(`room:${roomId}`, {
        config: { presence: { key: identity.id } },
      });
      channelRef.current = channel;

      channel.on("presence", { event: "sync" }, () => {
        const state = channel.presenceState() as Record<string, { name?: string; rank?: Rank }[]>;
        const ids = Object.keys(state);
        setPlayerCount(ids.length);
        // drop disconnected
        for (const id of [...remotePlayersRef.current.keys()]) {
          if (!ids.includes(id)) remotePlayersRef.current.delete(id);
        }
        // ensure entries (positions will arrive via pose events)
        for (const id of ids) {
          if (id === identity.id) continue;
          if (!remotePlayersRef.current.has(id)) {
            const name = state[id]?.[0]?.name ?? "Rival";
            remotePlayersRef.current.set(id, {
              id, name, x: 0, y: 0.9, z: 0, yaw: 0, alive: true, rank: state[id]?.[0]?.rank ?? "player",
            });
          }
          // refresh names from presence
          const r = remotePlayersRef.current.get(id);
          const nm = state[id]?.[0]?.name;
          if (r && nm) r.name = nm;
          const rk = state[id]?.[0]?.rank;
          if (r && rk) r.rank = rk;
        }
        setRemoteIds(ids.filter((i) => i !== identity.id));
      });

      channel.on("broadcast", { event: "pose" }, ({ payload }) => {
        const p = payload as PlayerPose & { id: string; name: string; rank?: Rank };
        if (p.id === identity.id) return;
        const existing = remotePlayersRef.current.get(p.id);
        remotePlayersRef.current.set(p.id, {
          id: p.id,
          name: p.name ?? existing?.name ?? "Rival",
          x: p.x, y: p.y, z: p.z,
          yaw: p.yaw,
          alive: p.alive,
          rank: p.rank ?? existing?.rank ?? "player",
          team: p.team ?? existing?.team,
          carrying: p.carrying ?? null,
        });
      });

      channel.on("broadcast", { event: "flag" }, ({ payload }) => {
        const e = payload as FlagEvent;
        if (e.byId === identity.id) return;
        applyFlagEvent(e);
        const who = remotePlayersRef.current.get(e.byId)?.name ?? "Someone";
        const id = ++feedId.current;
        const msg =
          e.type === "pickup" ? `${who} grabbed the ${e.team} flag`
          : e.type === "drop" ? `The ${e.team} flag was dropped`
          : e.type === "return" ? `${who} returned the ${e.team} flag`
          : `${who} captured for ${e.team.toUpperCase()}!`;
        setFeed((f) => [...f, { id, msg }].slice(-4));
        setTimeout(() => setFeed((f) => f.filter((x) => x.id !== id)), 3000);
      });

      channel.on("broadcast", { event: "hit" }, ({ payload }) => {
        const p = payload as { targetId: string; damage: number; shooterName: string };
        if (p.targetId !== identity.id) return;
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

      channel.on("broadcast", { event: "car" }, ({ payload }) => {
        const e = payload as CarEvent;
        if (e.byId === identity.id) return;
        applyCarEvent(e, false);
      });

      channel.on("broadcast", { event: "admin" }, ({ payload }) => {
        const p = payload as {
          action: "heal" | "kill" | "kick" | "announce" | "summon" | "freeze" | "unfreeze";
          targetId?: string;
          adminName: string;
          msg?: string;
          x?: number;
          z?: number;
        };
        const pushChat = (name: string, msg: string) => {
          const id = ++chatId.current;
          setChat((c) => [...c, { id, name, msg }].slice(-30));
        };
        const pushFeed = (msg: string) => {
          const id = ++feedId.current;
          setFeed((f) => [...f, { id, msg }].slice(-4));
          setTimeout(() => setFeed((f) => f.filter((x) => x.id !== id)), 3500);
        };
        if (p.action === "announce") {
          pushChat(`★ ${p.adminName}`, p.msg ?? "");
          pushFeed(`★ ${p.msg ?? ""}`);
          return;
        }
        if (p.action === "heal" && p.targetId === identity.id) {
          incomingHitRef.current -= 100;
          pushFeed(`${p.adminName} healed you`);
          return;
        }
        if (p.action === "kill" && p.targetId === identity.id) {
          incomingHitRef.current += 9999;
          pushFeed(`${p.adminName} used /kill on you`);
          return;
        }
        if (p.action === "kick" && p.targetId === identity.id) {
          pushFeed(`${p.adminName} kicked you`);
          setTimeout(() => { window.location.href = "/play"; }, 400);
          return;
        }
        if (p.action === "summon" && p.targetId === identity.id && typeof p.x === "number" && typeof p.z === "number") {
          localOpsRef.current.teleport = { x: p.x, z: p.z };
          pushFeed(`${p.adminName} summoned you`);
          return;
        }
        if (p.action === "freeze" && p.targetId === identity.id) {
          localOpsRef.current.frozen = true;
          pushFeed(`${p.adminName} froze you`);
          return;
        }
        if (p.action === "unfreeze" && p.targetId === identity.id) {
          localOpsRef.current.frozen = false;
          pushFeed(`${p.adminName} unfroze you`);
          return;
        }
      });

      channel.subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({ name: myNameRef.current, rank: myRankRef.current });
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
  }, [identity, roomId, isPractice]);

  // Re-track presence when rank resolves after subscribe
  useEffect(() => {
    const ch = channelRef.current;
    if (!ch) return;
    ch.track({ name: myNameRef.current, rank: myRank }).catch(() => {});
  }, [myRank]);

  // Connect LiveKit voice room
  useEffect(() => {
    if (!identity || isPractice) return;
    let cancelled = false;
    const room = new Room({ adaptiveStream: true, dynacast: true });
    roomRef.current = room;
    setVoiceState("connecting");

    const audioEls = new Map<string, HTMLAudioElement>();
    const audioTracks = new Map<string, RemoteAudioTrack>(); // identity -> track
    function attachTrack(track: RemoteTrack, _pub: RemoteTrackPublication, participant: RemoteParticipant) {
      if (track.kind !== Track.Kind.Audio) return;
      const el = track.attach() as HTMLAudioElement;
      el.autoplay = true;
      el.style.display = "none";
      document.body.appendChild(el);
      audioEls.set(participant.identity + track.sid, el);
      if (track instanceof RemoteAudioTrack) {
        track.setVolume(0); // start muted; proximity loop will ramp
        audioTracks.set(participant.identity, track);
      }
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
      audioTracks.delete(participant.identity);
    }
    room.on(RoomEvent.TrackSubscribed, attachTrack);
    room.on(RoomEvent.TrackUnsubscribed, detachTrack);
    room.on(RoomEvent.ParticipantConnected, () => setVoiceCount(room.numParticipants));
    room.on(RoomEvent.ParticipantDisconnected, () => setVoiceCount(room.numParticipants));
    const onSpeakers = (speakers: { identity: string }[]) => {
      speakingIdsRef.current = new Set(speakers.map((s) => s.identity));
    };
    room.on(RoomEvent.ActiveSpeakersChanged, onSpeakers);

    // Proximity volume loop
    let raf = 0;
    const tick = () => {
      const me = localPosRef.current;
      for (const [pid, track] of audioTracks) {
        const r = remotePlayersRef.current.get(pid);
        let v = 0;
        if (r) {
          const d = Math.hypot(r.x - me.x, r.y - me.y, r.z - me.z);
          if (d <= PROXIMITY_NEAR) v = 1;
          else if (d >= PROXIMITY_MAX) v = 0;
          else v = 1 - (d - PROXIMITY_NEAR) / (PROXIMITY_MAX - PROXIMITY_NEAR);
        }
        try { track.setVolume(v); } catch { /* noop */ }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    (async () => {
      try {
        let name = identity.name;
        if (!identity.isGuest) {
          const { data: prof } = await supabase
            .from("profiles")
            .select("username")
            .eq("id", identity.id)
            .maybeSingle();
          name = prof?.username ?? `P${identity.id.slice(0, 4)}`;
        }
        const { token, url } = identity.isGuest
          ? await getLiveKitTokenPublic({ data: { roomId: voiceRoomId, name, identity: identity.id } })
          : await getLiveKitToken({ data: { roomId: voiceRoomId, name } });
        if (cancelled) return;
        await room.connect(url, token);
        if (cancelled) {
          await room.disconnect();
          return;
        }
        await room.localParticipant.setMicrophoneEnabled(false);
        if (inputId) { try { await room.switchActiveDevice("audioinput", inputId); } catch { /* noop */ } }
        if (outputId) { try { await room.switchActiveDevice("audiooutput", outputId); } catch { /* noop */ } }
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
      cancelAnimationFrame(raf);
      for (const el of audioEls.values()) el.remove();
      audioEls.clear();
      audioTracks.clear();
      room.disconnect().catch(() => {});
      roomRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity, voiceRoomId, isPractice]);

  // Mic level meter + sensitivity gate (voice activation)
  useEffect(() => {
    if (voiceState !== "connected" || muted) { setMicLevel(0); return; }
    let raf = 0;
    let ctx: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let srcTrackId = "";
    const data = new Uint8Array(1024);
    let lastLoud = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const room = roomRef.current;
      const pub = room?.localParticipant.getTrackPublication(Track.Source.Microphone);
      const track = pub?.track as LocalAudioTrack | undefined;
      const mst = track?.mediaStreamTrack;
      if (!track || !mst) return;
      if (mst.id !== srcTrackId) {
        srcTrackId = mst.id;
        try {
          ctx?.close();
          const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
          ctx = new Ctx();
          analyser = ctx.createAnalyser();
          analyser.fftSize = 2048;
          ctx.createMediaStreamSource(new MediaStream([mst])).connect(analyser);
        } catch { return; }
      }
      if (!analyser) return;
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) { const v = (data[i]! - 128) / 128; sum += v * v; }
      const rms = Math.sqrt(sum / data.length);
      const level = Math.min(1, rms * 4);
      setMicLevel(level);
      const threshold = sensitivityRef.current / 100;
      const now = performance.now();
      if (level >= threshold) lastLoud = now;
      const shouldSpeak = threshold <= 0 || now - lastLoud < 300;
      if (shouldSpeak && track.isMuted) track.unmute().catch(() => {});
      else if (!shouldSpeak && !track.isMuted) track.mute().catch(() => {});
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      ctx?.close().catch(() => {});
      setMicLevel(0);
    };
  }, [voiceState, muted]);

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
      payload: { ...p, id: myIdRef.current, name: myNameRef.current, rank: myRankRef.current },
    });
  }

  function handleShoot(_s: ShotEvent, hits: { id: string; damage: number }[]) {
    const ch = channelRef.current;
    if (!ch) return;
    for (const h of hits) {
      ch.send({
        type: "broadcast",
        event: "hit",
        payload: { targetId: h.id, damage: h.damage, shooterName: myNameRef.current },
      });
    }
  }

  function handleLocalDeath() {
    // already added to feed via hit event
  }

  function sendChat() {
    const text = chatInput.trim().slice(0, 140);
    if (!text || !channelRef.current) return;
    if (text.startsWith("/")) {
      runCommand(text);
      setChatInput("");
      return;
    }
    channelRef.current.send({
      type: "broadcast",
      event: "chat",
      payload: { name: myNameRef.current, msg: text },
    });
    const id = ++chatId.current;
    setChat((c) => [...c, { id, name: myNameRef.current, msg: text }].slice(-30));
    setChatInput("");
  }

  function localSystem(msg: string) {
    const id = ++chatId.current;
    setChat((c) => [...c, { id, name: "SYSTEM", msg }].slice(-30));
  }

  function resolveTargetId(name: string): string | null {
    const n = name.trim().toLowerCase();
    if (!n) return null;
    if (n === "me" || n === "self") return myIdRef.current;
    if (n === myNameRef.current.toLowerCase()) return myIdRef.current;
    for (const p of remotePlayersRef.current.values()) {
      if (p.name.toLowerCase() === n) return p.id;
    }
    // partial match
    for (const p of remotePlayersRef.current.values()) {
      if (p.name.toLowerCase().startsWith(n)) return p.id;
    }
    return null;
  }

  function runCommand(text: string) {
    const [rawCmd, ...rest] = text.slice(1).split(/\s+/);
    const cmd = (rawCmd ?? "").toLowerCase();
    if (cmd === "help") {
      localSystem(
        isOwner
          ? "Owner: /tp <name>  /summon <name>  /freeze <name>  /unfreeze <name>  /god  /nuke  /speed <n>  /heal /kill /kick /announce /players"
          : isAdmin
            ? "Admin: /heal <name|me>  /kill <name>  /kick <name>  /announce <msg>  /players"
            : "/help  /players — admin commands available to authorized players only",
      );
      return;
    }
    if (cmd === "players") {
      const names = [myNameRef.current, ...Array.from(remotePlayersRef.current.values()).map((p) => p.name)];
      localSystem(`In room: ${names.join(", ")}`);
      return;
    }
    if (!isAdmin) {
      localSystem("You are not an admin.");
      return;
    }
    const ch = channelRef.current;
    if (!ch) return;
    const send = (payload: Record<string, unknown>) =>
      ch.send({ type: "broadcast", event: "admin", payload: { ...payload, adminName: myNameRef.current } });

    if (cmd === "announce") {
      const msg = rest.join(" ").slice(0, 140);
      if (!msg) { localSystem("Usage: /announce <message>"); return; }
      send({ action: "announce", msg });
      return;
    }
    if (cmd === "heal" || cmd === "kill" || cmd === "kick") {
      const targetName = rest.join(" ");
      const targetId = resolveTargetId(targetName);
      if (!targetId) { localSystem(`Player "${targetName}" not found.`); return; }
      send({ action: cmd, targetId });
      localSystem(`/${cmd} → ${targetName}`);
      return;
    }

    // Owner-only commands beyond this point
    if (!isOwner) {
      localSystem(`Unknown command: /${cmd}`);
      return;
    }

    if (cmd === "god") {
      localOpsRef.current.god = !localOpsRef.current.god;
      localSystem(`God mode: ${localOpsRef.current.god ? "ON" : "OFF"}`);
      return;
    }
    if (cmd === "speed") {
      const n = Number(rest[0]);
      if (!Number.isFinite(n) || n <= 0 || n > 5) { localSystem("Usage: /speed <0.1-5>"); return; }
      localOpsRef.current.speedMult = n;
      localSystem(`Speed multiplier: ${n}x`);
      return;
    }
    if (cmd === "tp") {
      const targetName = rest.join(" ");
      const targetId = resolveTargetId(targetName);
      if (!targetId || targetId === myIdRef.current) { localSystem(`Player "${targetName}" not found.`); return; }
      const r = remotePlayersRef.current.get(targetId);
      if (!r) { localSystem("Target has no known position yet."); return; }
      localOpsRef.current.teleport = { x: r.x, z: r.z };
      localSystem(`Teleported to ${r.name}`);
      return;
    }
    if (cmd === "summon") {
      const targetName = rest.join(" ");
      const targetId = resolveTargetId(targetName);
      if (!targetId || targetId === myIdRef.current) { localSystem(`Player "${targetName}" not found.`); return; }
      send({ action: "summon", targetId, x: localPosRef.current.x, z: localPosRef.current.z });
      localSystem(`Summoned ${targetName}`);
      return;
    }
    if (cmd === "freeze" || cmd === "unfreeze") {
      const targetName = rest.join(" ");
      const targetId = resolveTargetId(targetName);
      if (!targetId) { localSystem(`Player "${targetName}" not found.`); return; }
      if (targetId === myIdRef.current) {
        localOpsRef.current.frozen = cmd === "freeze";
        localSystem(cmd === "freeze" ? "You are frozen" : "You are unfrozen");
        return;
      }
      send({ action: cmd, targetId });
      localSystem(`/${cmd} → ${targetName}`);
      return;
    }
    if (cmd === "nuke") {
      // Kill everyone including self
      for (const r of remotePlayersRef.current.values()) {
        ch.send({ type: "broadcast", event: "hit", payload: { targetId: r.id, damage: 9999, shooterName: `☢ ${myNameRef.current}` } });
      }
      send({ action: "announce", msg: "☢ NUKE ☢" });
      return;
    }
    localSystem(`Unknown command: /${cmd}`);
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

  // Console controls: PS5 / Xbox gamepad via the Gamepad API
  useEffect(() => {
    const onConnect = () => setPadConnected(true);
    const onDisconnect = () => setPadConnected((navigator.getGamepads?.() ?? []).some(Boolean));
    window.addEventListener("gamepadconnected", onConnect);
    window.addEventListener("gamepaddisconnected", onDisconnect);
    if ((navigator.getGamepads?.() ?? []).some(Boolean)) setPadConnected(true);
    return () => {
      window.removeEventListener("gamepadconnected", onConnect);
      window.removeEventListener("gamepaddisconnected", onDisconnect);
    };
  }, []);

  useEffect(() => {
    if (platform !== "console") return;
    let raf = 0;
    const prev: Record<number, boolean> = {};
    const dead = (v: number) => (Math.abs(v) < 0.18 ? 0 : v);
    const order: WeaponId[] = isCTF ? ["pistol"] : ["rifle", "sniper", "rpg"];
    let weaponIdx = 0;
    const pressed = (gp: Gamepad, i: number) => !!gp.buttons[i]?.pressed;
    const tap = (gp: Gamepad, i: number) => {
      const now = pressed(gp, i);
      const was = prev[i] ?? false;
      prev[i] = now;
      return now && !was;
    };
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const gp = (navigator.getGamepads?.() ?? []).find(Boolean);
      if (!gp) return;
      // Sticks: left = move, right = look
      controls.current.moveX = dead(gp.axes[0] ?? 0);
      controls.current.moveY = -dead(gp.axes[1] ?? 0);
      const lookX = dead(gp.axes[2] ?? 0);
      const lookY = dead(gp.axes[3] ?? 0);
      const sens = 0.045;
      controls.current.yaw -= lookX * sens;
      controls.current.pitch -= lookY * sens;
      controls.current.pitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, controls.current.pitch));
      // R2 / RT fire, L2 / LT zoom
      controls.current.fire = (gp.buttons[7]?.value ?? 0) > 0.4 || pressed(gp, 7);
      setZoom((gp.buttons[6]?.value ?? 0) > 0.4 || pressed(gp, 6));
      // X / A jump, Square / X reload
      if (tap(gp, 0)) triggerJump();
      if (tap(gp, 2)) triggerReload();
      // Bumpers cycle weapons
      if (order.length > 1) {
        if (tap(gp, 5)) { weaponIdx = (weaponIdx + 1) % order.length; selectWeapon(order[weaponIdx]!); }
        if (tap(gp, 4)) { weaponIdx = (weaponIdx - 1 + order.length) % order.length; selectWeapon(order[weaponIdx]!); }
      }
      // Options / Menu opens chat
      if (tap(gp, 9)) setChatOpen((v) => !v);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      controls.current.moveX = 0;
      controls.current.moveY = 0;
      controls.current.fire = false;
      setZoom(false);
    };
  }, [platform, isCTF]);

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
      if (k === "e" || k === "f") triggerInteract();
      if (k === " " || k === "spacebar") { e.preventDefault(); triggerJump(); }
      if (k === "1") selectWeapon("rifle");
      if (k === "2") selectWeapon("sniper");
      if (k === "3") selectWeapon("rpg");
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
      if (e.button === 2) { e.preventDefault(); setZoom(true); return; }
      if (e.button !== 0) return;
      if (document.pointerLockElement !== rootRef.current) {
        rootRef.current?.requestPointerLock();
        return;
      }
      controls.current.fire = true;
    };
    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 0) controls.current.fire = false;
      if (e.button === 2) setZoom(false);
    };
    const onCtx = (e: MouseEvent) => e.preventDefault();
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("contextmenu", onCtx);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("contextmenu", onCtx);
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
        customArena={customArena}
        fov={fov}
        viewBobbing={viewBobbing}
        localPosRef={localPosRef}
        speakingIdsRef={speakingIdsRef}
        localOpsRef={localOpsRef}
        ctfRef={isCTF ? ctfRef : undefined}
        onFlagEvent={isCTF ? handleFlagEvent : undefined}
        quality={quality}
        practice={isPractice}
        practiceStatsRef={practiceStatsRef}
        carsRef={carsEnabled ? carsRef : undefined}
        onCarEvent={carsEnabled ? handleCarEvent : undefined}
        localId={identity?.id ?? ""}
        onEnterExitCar={setDrivingTeam}
      />

      {/* HUD */}
      <div className="pointer-events-none absolute inset-0">
        <CustomCrosshair cfg={crosshair} />

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
            <button
              onClick={() => setSettingsOpen((v) => !v)}
              className="flex items-center gap-1 rounded-md bg-black/60 px-3 py-2 text-xs font-display uppercase tracking-widest text-primary backdrop-blur"
              aria-label="Settings"
            >
              <SettingsIcon className="size-4" />
            </button>
            {!isPractice && (
              <button
                onClick={() => { setVoicePanelOpen((v) => !v); refreshDevices(); }}
                className="flex items-center gap-1 rounded-md bg-black/60 px-3 py-2 text-xs font-display uppercase tracking-widest text-accent backdrop-blur"
                aria-label="Voice settings"
              >
                <Headphones className="size-4" />
              </button>
            )}
          </div>
          <div className="rounded-md bg-black/60 px-3 py-2 text-center font-display text-xs uppercase tracking-widest text-primary backdrop-blur">
            <div>{mode}</div>
            <div className="mt-0.5 flex items-center justify-center gap-1 text-accent">
              <Users className="size-3" /> {playerCount}
            </div>
            {myRank !== "player" && (
              <div
                className="mt-1 rounded px-1 text-[10px] font-bold tracking-widest"
                style={{
                  color: myRank === "owner" ? "#fbbf24" : "#f43f5e",
                  textShadow: "0 0 6px currentColor",
                }}
              >
                {myRank === "owner" ? "★ OWNER" : "◆ ADMIN"}
              </div>
            )}
          </div>
          <div className="rounded-md bg-black/60 px-3 py-2 text-right font-display text-xs uppercase tracking-widest backdrop-blur">
            <div className="text-primary">K {hud.kills}</div>
            <div className="text-accent">D {hud.deaths}</div>
          </div>
        </div>

        {isPractice && (
          <div className="absolute left-1/2 top-20 -translate-x-1/2 rounded-md bg-black/70 px-4 py-2 text-center font-display text-xs uppercase tracking-widest text-primary backdrop-blur">
            <div>Targets hit <span className="text-accent">{practiceHud.hits}</span></div>
            <div className="mt-0.5 text-[10px] text-muted-foreground">
              Accuracy {practiceHud.shots > 0 ? Math.round((practiceHud.hits / practiceHud.shots) * 100) : 0}% · {practiceHud.shots} shots
            </div>
          </div>
        )}

        {isCTF && ctfHud && (
          <div className="absolute left-1/2 top-20 -translate-x-1/2 rounded-md bg-black/70 px-3 py-2 text-center font-display text-xs uppercase tracking-widest backdrop-blur">
              <div className="flex items-center justify-center gap-3">
                <span style={{ color: TEAM_COLORS.red, textShadow: "0 0 8px currentColor" }}>RED {ctfHud.scoreRed}</span>
                <span className="text-muted-foreground">/</span>
                <span style={{ color: TEAM_COLORS.blue, textShadow: "0 0 8px currentColor" }}>BLU {ctfHud.scoreBlue}</span>
              </div>
              <div className="mt-1 text-[10px]" style={{ color: TEAM_COLORS[ctfHud.team] }}>
                You are {ctfHud.team.toUpperCase()} · first to {CTF_SCORE_LIMIT}
              </div>
              {ctfHud.carrying && (
                <div className="mt-1 animate-pulse text-[10px] font-bold text-yellow-300">
                  🚩 Flag taken — run it to your base!
                </div>
              )}
              {ctfHud.enemyHasOurs && (
                <div className="mt-1 text-[10px] font-bold text-red-300">Your flag is stolen!</div>
              )}
          </div>
        )}

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
              <Zap className="size-4" /> {hud.reloading ? "RELOAD…" : `${hud.ammo}/${hud.maxAmmo}`}
            </div>
            <div className="mt-0.5 text-[10px] font-display uppercase tracking-widest text-primary">
              {WEAPONS[hud.weapon].name}
            </div>
          </div>
        </div>
      </div>

      {/* Weapon selector */}
      {!isCTF && (
      <div className="pointer-events-auto absolute left-1/2 bottom-3 z-20 -translate-x-1/2 flex gap-1.5">
        {(["rifle","sniper","rpg"] as WeaponId[]).map((w, i) => {
          const Icon = w === "rifle" ? Target : w === "sniper" ? CrosshairIcon : Rocket;
          const active = weapon === w;
          return (
            <button
              key={w}
              onClick={() => selectWeapon(w)}
              className={`grid size-12 place-items-center rounded-md border backdrop-blur ${
                active
                  ? "border-accent bg-accent/30 text-accent shadow-[0_0_16px_var(--accent)]"
                  : "border-border bg-black/60 text-muted-foreground"
              }`}
              title={`${WEAPONS[w].name} (${i + 1})`}
            >
              <Icon className="size-5" />
              <span className="sr-only">{WEAPONS[w].name}</span>
            </button>
          );
        })}
      </div>
      )}

      {isCTF && ctfWinner && (
        <div className="pointer-events-none absolute inset-0 z-30 grid place-items-center bg-black/70 backdrop-blur">
          <div className="text-center">
            <div
              className="font-display text-4xl font-black uppercase tracking-widest"
              style={{ color: TEAM_COLORS[ctfWinner], textShadow: "0 0 24px currentColor" }}
            >
              {ctfWinner} team wins
            </div>
            <div className="mt-2 text-xs uppercase tracking-widest text-muted-foreground">
              {ctfHud?.scoreRed ?? 0} — {ctfHud?.scoreBlue ?? 0}
            </div>
          </div>
        </div>
      )}

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
              placeholder={isAdmin ? "Message… or /help for admin commands" : "Message…"}
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
            <CrosshairIcon className="size-10" />
          </button>

          {/* Reload button */}
          <button
            onTouchStart={(e) => { e.preventDefault(); triggerReload(); }}
            className="absolute right-32 bottom-32 grid size-16 place-items-center rounded-full border-2 border-primary/60 bg-black/50 text-primary backdrop-blur active:bg-primary/30"
            aria-label="Reload"
          >
            <RotateCw className="size-7" />
          </button>

          {/* Jump button */}
          <button
            onTouchStart={(e) => { e.preventDefault(); triggerJump(); }}
            className="absolute right-6 bottom-56 grid size-16 place-items-center rounded-full border-2 border-primary/60 bg-black/50 text-primary backdrop-blur active:bg-primary/30"
            aria-label="Jump"
          >
            <ChevronUp className="size-8" />
          </button>

          {/* Zoom button (hold) */}
          <button
            onTouchStart={(e) => { e.preventDefault(); setZoom(true); }}
            onTouchEnd={(e) => { e.preventDefault(); setZoom(false); }}
            onTouchCancel={(e) => { e.preventDefault(); setZoom(false); }}
            className="absolute right-32 bottom-56 grid size-14 place-items-center rounded-full border-2 border-accent/60 bg-black/50 text-accent backdrop-blur active:bg-accent/30"
            aria-label="Zoom"
          >
            <Search className="size-6" />
          </button>

          {/* Enter / exit vehicle */}
          {carsEnabled && (
            <button
              onTouchStart={(e) => { e.preventDefault(); triggerInteract(); }}
              className={`absolute left-6 bottom-56 grid size-14 place-items-center rounded-full border-2 backdrop-blur ${drivingTeam ? "border-accent bg-accent/30 text-accent" : "border-primary/60 bg-black/50 text-primary"}`}
              aria-label={drivingTeam ? "Exit vehicle" : "Enter vehicle"}
            >
              <CarIcon className="size-7" />
            </button>
          )}
        </>
      )}

      {platform === "pc" && document.pointerLockElement !== rootRef.current && (
        <div className="pointer-events-none absolute inset-x-0 top-1/3 text-center">
          <div className="inline-block rounded-md bg-black/70 px-4 py-2 font-display text-xs uppercase tracking-widest text-primary backdrop-blur">
            Click to play · WASD · Space jump · Mouse aim · Click fire · R reload · 1/2/3 weapon
          </div>
        </div>
      )}

      {platform === "console" && (
        <div className="pointer-events-none absolute inset-x-0 bottom-6 text-center">
          <div className="inline-block rounded-md bg-black/70 px-4 py-2 font-display text-[10px] uppercase tracking-widest text-primary backdrop-blur">
            {padConnected ? "Controller connected" : "Press any button on your controller"} · Left stick move · Right stick aim · RT fire · LT zoom · A/✕ jump · X/□ reload · Bumpers swap weapon · Menu chat
          </div>
        </div>
      )}

      {/* Platform selection modal */}
      {settingsOpen && (
        <div className="absolute right-3 top-16 z-40 w-72 rounded-md border border-primary/40 bg-black/85 p-4 backdrop-blur">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-display text-sm uppercase tracking-widest text-primary">Settings</h3>
            <button onClick={() => setSettingsOpen(false)} className="text-muted-foreground hover:text-foreground" aria-label="Close settings">
              <X className="size-4" />
            </button>
          </div>
          <label className="block text-xs font-display uppercase tracking-widest text-accent">
            Field of View: <span className="text-primary">{fov}°</span>
          </label>
          <input
            type="range"
            min={60}
            max={110}
            step={1}
            value={fov}
            onChange={(e) => setFov(Number(e.target.value))}
            className="mt-2 w-full accent-[var(--primary)]"
          />
          <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
            <span>60</span><span>75</span><span>90</span><span>110</span>
          </div>
          <label className="mt-4 flex items-center justify-between text-xs font-display uppercase tracking-widest text-accent">
            <span>View bobbing</span>
            <button
              type="button"
              onClick={() => setViewBobbing((v) => !v)}
              className={`relative h-6 w-11 rounded-full border transition-colors ${viewBobbing ? "border-accent bg-accent/40" : "border-border bg-black/60"}`}
              aria-pressed={viewBobbing}
            >
              <span className={`absolute top-0.5 size-5 rounded-full transition-all ${viewBobbing ? "left-[22px] bg-accent shadow-[0_0_10px_var(--accent)]" : "left-0.5 bg-muted-foreground"}`} />
            </button>
          </label>
          <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground">
            Zoom: hold the <span className="text-primary">zoom button</span> on mobile, or <span className="text-primary">right-click</span> on PC.
          </p>

          <div className="mt-4 border-t border-border pt-3">
            <div className="text-xs font-display uppercase tracking-widest text-accent">Graphics</div>
            <div className="mt-2 grid grid-cols-3 gap-1.5">
              {(["simple", "balanced", "fancy"] as Quality[]).map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => setQuality(q)}
                  className={`rounded-md border px-2 py-2 text-[10px] font-display uppercase tracking-widest transition-colors ${
                    quality === q
                      ? "border-primary bg-primary/25 text-primary shadow-[0_0_12px_var(--primary)]"
                      : "border-border bg-black/60 text-muted-foreground hover:text-foreground"
                  }`}
                  aria-pressed={quality === q}
                >
                  {q}
                </button>
              ))}
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
              {quality === "simple"
                ? "Lowest resolution, no sky/shadows — best FPS on phones."
                : quality === "balanced"
                  ? "Sky and grid on, shadows off."
                  : "Full resolution, shadows, fog and dense grid."}
            </p>
          </div>

          <div className="mt-4 border-t border-border pt-3">
            <div className="flex items-center justify-between">
              <div className="text-xs font-display uppercase tracking-widest text-accent">Crosshair</div>
              <button
                type="button"
                onClick={() => setCrosshair(CROSSHAIR_DEFAULT)}
                className="text-[10px] uppercase tracking-widest text-muted-foreground hover:text-primary"
              >
                Reset
              </button>
            </div>

            <div className="mt-3 grid h-14 place-items-center rounded-md border border-border bg-black/60">
              <div className="relative size-10">
                <CustomCrosshair cfg={crosshair} />
              </div>
            </div>

            <label className="mt-3 block text-[10px] uppercase tracking-widest text-muted-foreground">
              Length · {crosshair.size}px
              <input type="range" min={2} max={24} value={crosshair.size}
                onChange={(e) => setCrosshair((c) => ({ ...c, size: Number(e.target.value) }))}
                className="mt-1 w-full accent-[var(--primary)]" />
            </label>
            <label className="mt-2 block text-[10px] uppercase tracking-widest text-muted-foreground">
              Spread · {crosshair.gap}px
              <input type="range" min={0} max={24} value={crosshair.gap}
                onChange={(e) => setCrosshair((c) => ({ ...c, gap: Number(e.target.value) }))}
                className="mt-1 w-full accent-[var(--primary)]" />
            </label>
            <label className="mt-2 block text-[10px] uppercase tracking-widest text-muted-foreground">
              Thickness · {crosshair.thickness}px
              <input type="range" min={1} max={8} value={crosshair.thickness}
                onChange={(e) => setCrosshair((c) => ({ ...c, thickness: Number(e.target.value) }))}
                className="mt-1 w-full accent-[var(--primary)]" />
            </label>

            <div className="mt-3 text-[10px] uppercase tracking-widest text-muted-foreground">Color</div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {CROSSHAIR_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCrosshair((cc) => ({ ...cc, color: c }))}
                  aria-label={`Crosshair color ${c}`}
                  aria-pressed={crosshair.color === c}
                  className={`size-6 rounded-full border-2 ${crosshair.color === c ? "border-primary" : "border-transparent"}`}
                  style={{ background: c }}
                />
              ))}
            </div>

            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => setCrosshair((c) => ({ ...c, dot: !c.dot }))}
                aria-pressed={crosshair.dot}
                className={`flex-1 rounded-md border px-2 py-2 text-[10px] font-display uppercase tracking-widest ${crosshair.dot ? "border-primary bg-primary/25 text-primary" : "border-border bg-black/60 text-muted-foreground"}`}
              >
                Center dot
              </button>
              <button
                type="button"
                onClick={() => setCrosshair((c) => ({ ...c, outline: !c.outline }))}
                aria-pressed={crosshair.outline}
                className={`flex-1 rounded-md border px-2 py-2 text-[10px] font-display uppercase tracking-widest ${crosshair.outline ? "border-primary bg-primary/25 text-primary" : "border-border bg-black/60 text-muted-foreground"}`}
              >
                Outline
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Voice settings panel */}
      {voicePanelOpen && (
        <div className="absolute right-3 top-16 z-40 w-80 max-h-[75vh] overflow-y-auto rounded-md border border-accent/40 bg-black/90 p-4 backdrop-blur">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="flex items-center gap-2 font-display text-sm uppercase tracking-widest text-accent">
              <Sliders className="size-4" /> Voice chat
            </h3>
            <button onClick={() => setVoicePanelOpen(false)} className="text-muted-foreground hover:text-foreground" aria-label="Close voice settings">
              <X className="size-4" />
            </button>
          </div>

          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            {voiceState === "connected" ? `Connected · ${voiceCount + 1} in channel` : voiceState === "connecting" ? "Connecting…" : voiceState === "error" ? "Voice unavailable" : "Idle"}
          </div>

          {myTeamKey && (
            <div className="mt-3">
              <div className="text-xs font-display uppercase tracking-widest text-accent">Channel</div>
              <div className="mt-2 grid grid-cols-2 gap-1.5">
                {(["team", "all"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setVoiceScope(s)}
                    className={`rounded-md border px-2 py-2 text-[10px] font-display uppercase tracking-widest ${
                      voiceScope === s ? "border-accent bg-accent/25 text-accent" : "border-border bg-black/60 text-muted-foreground"
                    }`}
                  >
                    {s === "team" ? `Team ${String(myTeamKey).toUpperCase()}` : "Everyone"}
                  </button>
                ))}
              </div>
            </div>
          )}

          <label className="mt-4 block text-xs font-display uppercase tracking-widest text-accent">Microphone</label>
          <select
            value={inputId}
            onChange={(e) => changeInput(e.target.value)}
            className="mt-1 w-full rounded border border-primary/30 bg-black/70 px-2 py-1.5 text-xs text-foreground outline-none focus:border-primary"
          >
            <option value="">System default</option>
            {devices.inputs.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>{d.label || `Microphone ${d.deviceId.slice(0, 6)}`}</option>
            ))}
          </select>

          <label className="mt-3 block text-xs font-display uppercase tracking-widest text-accent">Output / speakers</label>
          <select
            value={outputId}
            onChange={(e) => changeOutput(e.target.value)}
            className="mt-1 w-full rounded border border-primary/30 bg-black/70 px-2 py-1.5 text-xs text-foreground outline-none focus:border-primary"
          >
            <option value="">System default</option>
            {devices.outputs.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>{d.label || `Output ${d.deviceId.slice(0, 6)}`}</option>
            ))}
          </select>

          {devices.inputs.every((d) => !d.label) && (
            <button
              onClick={requestMicPermission}
              className="mt-2 w-full rounded border border-accent/60 bg-accent/15 px-2 py-1.5 text-[10px] font-display uppercase tracking-widest text-accent"
            >
              Allow mic access to list devices
            </button>
          )}

          <label className="mt-4 block text-xs font-display uppercase tracking-widest text-accent">
            Mic sensitivity: <span className="text-primary">{sensitivity === 0 ? "Always on" : `${sensitivity}%`}</span>
          </label>
          <input
            type="range"
            min={0}
            max={60}
            step={1}
            value={sensitivity}
            onChange={(e) => setSensitivity(Number(e.target.value))}
            className="mt-2 w-full accent-[var(--accent)]"
          />
          <div className="mt-2 h-2 w-full overflow-hidden rounded bg-white/10">
            <div className="h-full bg-emerald-400 transition-[width] duration-75" style={{ width: `${Math.round(micLevel * 100)}%` }} />
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
            Your mic only transmits when the green bar passes the sensitivity threshold. Set to 0 to always transmit.
          </p>

          <button
            onClick={toggleMute}
            disabled={voiceState !== "connected"}
            className={`mt-3 flex w-full items-center justify-center gap-2 rounded border px-2 py-2 text-[10px] font-display uppercase tracking-widest ${
              muted ? "border-destructive/60 text-destructive" : "border-accent/60 bg-accent/20 text-accent"
            } disabled:opacity-50`}
          >
            {muted ? <MicOff className="size-4" /> : <Mic className="size-4" />} {muted ? "Unmute" : "Mute"}
          </button>
        </div>
      )}

      {platform === "none" && (
        <div className="absolute inset-0 z-50 grid place-items-center bg-black/90 backdrop-blur">
          <div className="w-[90%] max-w-md rounded-lg border border-primary/40 bg-black/80 p-6 text-center">
            <h2 className="font-display text-xl uppercase tracking-widest text-primary">Choose your device</h2>
            <p className="mt-2 text-sm text-muted-foreground">Pick how you're playing so we load the right controls.</p>
            <div className="mt-6 grid grid-cols-3 gap-3">
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
              <button
                onClick={async () => {
                  setPlatform("console");
                  getAudio();
                  await enterFullscreen();
                }}
                className="flex flex-col items-center gap-2 rounded-md border border-emerald-400/50 bg-emerald-400/10 p-4 font-display uppercase tracking-widest text-emerald-300 hover:bg-emerald-400/20"
              >
                <Gamepad2 className="size-8" />
                <span>Are you on Console</span>
                <span className="text-[10px] normal-case tracking-normal text-muted-foreground">PS5 / Xbox controller</span>
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