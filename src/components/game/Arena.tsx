import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Sky, Text, Billboard } from "@react-three/drei";
import { EffectComposer, Bloom, Vignette, SMAA } from "@react-three/postprocessing";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

const ARENA = 30;
const EYE = 1.6;
const PLAYER_RADIUS = 0.4;
const GRAVITY = 22;
const JUMP_VELOCITY = 8.5;

export type WeaponId = "rifle" | "sniper" | "rpg" | "pistol";
export type Rank = "owner" | "admin" | "player";
export type Team = "red" | "blue";
export type Quality = "simple" | "balanced" | "fancy";

export type PracticeTarget = { id: number; x: number; y: number; z: number; alive: boolean; respawnAt: number; seed: number };
export type PracticeStats = { shots: number; hits: number };

export function makePracticeTargets(count = 8): PracticeTarget[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    x: (Math.random() - 0.5) * (ARENA - 8),
    y: 1.2 + Math.random() * 2.2,
    z: -6 - Math.random() * (ARENA - 12),
    alive: true,
    respawnAt: 0,
    seed: Math.random() * 10,
  }));
}

export type FlagState = {
  home: boolean;
  carrierId: string | null;
  x: number;
  z: number;
};

export type CTFState = {
  myTeam: Team;
  myId: string;
  red: FlagState;
  blue: FlagState;
  scoreRed: number;
  scoreBlue: number;
};

export const CTF_BASES: Record<Team, { x: number; z: number }> = {
  red: { x: 0, z: -22 },
  blue: { x: 0, z: 22 },
};
export const TEAM_COLORS: Record<Team, string> = { red: "#f43f5e", blue: "#38bdf8" };
export const CTF_SCORE_LIMIT = 3;

export function makeCTFState(myTeam: Team, myId: string): CTFState {
  return {
    myTeam,
    myId,
    red: { home: true, carrierId: null, x: CTF_BASES.red.x, z: CTF_BASES.red.z },
    blue: { home: true, carrierId: null, x: CTF_BASES.blue.x, z: CTF_BASES.blue.z },
    scoreRed: 0,
    scoreBlue: 0,
  };
}

export type FlagEvent =
  | { type: "pickup"; team: Team; byId: string }
  | { type: "drop"; team: Team; byId: string; x: number; z: number }
  | { type: "return"; team: Team; byId: string }
  | { type: "capture"; team: Team; byId: string };

export type LocalOps = {
  teleport: { x: number; z: number } | null;
  frozen: boolean;
  god: boolean;
  speedMult: number;
};

export type LocalPos = { x: number; y: number; z: number };

// ===== Vehicles =====
export type Car = {
  team: Team;
  x: number;
  z: number;
  yaw: number;
  hp: number;
  maxHp: number;
  driverId: string | null;
  alive: boolean;
  respawnAt: number;
};
export type CarsState = { red: Car; blue: Car };
export const CAR_SPAWNS: Record<Team, { x: number; z: number; yaw: number }> = {
  red: { x: 10, z: -16, yaw: 0 },
  blue: { x: -10, z: 16, yaw: Math.PI },
};
export const CAR_MAX_HP = 220;
export const CAR_BLAST_RADIUS = 7;
export const CAR_ENTER_RANGE = 3.6;
export const CAR_RESPAWN_MS = 20000;

export function makeCars(): CarsState {
  const mk = (team: Team): Car => ({
    team,
    x: CAR_SPAWNS[team].x,
    z: CAR_SPAWNS[team].z,
    yaw: CAR_SPAWNS[team].yaw,
    hp: CAR_MAX_HP,
    maxHp: CAR_MAX_HP,
    driverId: null,
    alive: true,
    respawnAt: 0,
  });
  return { red: mk("red"), blue: mk("blue") };
}

export type CarEvent =
  | { type: "enter"; team: Team; byId: string }
  | { type: "exit"; team: Team; byId: string; x: number; z: number; yaw: number }
  | { type: "move"; team: Team; x: number; z: number; yaw: number; byId: string }
  | { type: "damage"; team: Team; damage: number; byId: string }
  | { type: "explode"; team: Team; x: number; z: number; byId: string };

export type WeaponSpec = {
  id: WeaponId;
  name: string;
  cooldownMs: number;
  magazine: number;
  reloadMs: number;
  damage: number;
  splashRadius: number; // 0 = no splash
  maxRange: number;
  color: string;
};
export const WEAPONS: Record<WeaponId, WeaponSpec> = {
  pistol: { id: "pistol", name: "Pistol", cooldownMs: 260, magazine: 12, reloadMs: 1200, damage: 45, splashRadius: 0, maxRange: 60, color: "#facc15" },
  rifle:  { id: "rifle",  name: "Rifle",  cooldownMs: 180, magazine: 30, reloadMs: 1500, damage: 34, splashRadius: 0, maxRange: 80, color: "#22d3ee" },
  sniper: { id: "sniper", name: "Sniper", cooldownMs: 900, magazine: 5,  reloadMs: 2200, damage: 95, splashRadius: 0, maxRange: 200, color: "#a78bfa" },
  rpg:    { id: "rpg",    name: "RPG",    cooldownMs: 1200,magazine: 3,  reloadMs: 2800, damage: 75, splashRadius: 4.5, maxRange: 60, color: "#f97316" },
};

export type GameState = {
  hp: number;
  kills: number;
  deaths: number;
  ammo: number;
  maxAmmo: number;
  weapon: WeaponId;
  reloading: boolean;
};

export type Controls = {
  moveX: number; // -1..1
  moveY: number; // -1..1 (forward positive)
  yaw: number;
  pitch: number;
  fire: boolean;
  reload: boolean;
  jump: boolean;
  weapon: WeaponId;
  zoom: boolean;
  interact: boolean;
};

export type RemotePlayer = {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  alive: boolean;
  rank?: Rank;
  team?: Team;
  carrying?: Team | null;
};

export type PlayerPose = {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  alive: boolean;
  rank?: Rank;
  team?: Team;
  carrying?: Team | null;
};

export type ShotEvent = {
  ox: number; oy: number; oz: number;
  dx: number; dy: number; dz: number;
  shooterId: string;
  shooterName: string;
};

export type ArenaBlock =
  | { id: string; kind: "cube";     x: number; z: number; y?: number; rot: number }
  | { id: string; kind: "plate";    x: number; z: number; y?: number; rot: number }
  | { id: string; kind: "cylinder"; x: number; z: number; y?: number; rot: number }
  | { id: string; kind: "stairs";   x: number; z: number; y?: number; rot: number }
  | { id: string; kind: "jumppad";  x: number; z: number; y?: number; rot: number }
  | { id: string; kind: "speedpad"; x: number; z: number; y?: number; rot: number };

export type SpawnPoint = { id: string; x: number; z: number };

export type CustomArena = {
  blocks: ArenaBlock[];
  spawnPoints: SpawnPoint[];
};

// Block AABB helpers (bottom Y, top Y, half-extent XZ)
export function blockBox(b: ArenaBlock): { min: THREE.Vector3; max: THREE.Vector3; solid: boolean; pad: null | "jump" | "speed" } {
  const y = b.y ?? 0;
  if (b.kind === "cube")     return { min: new THREE.Vector3(b.x - 1, y, b.z - 1), max: new THREE.Vector3(b.x + 1, y + 2, b.z + 1), solid: true, pad: null };
  if (b.kind === "plate")    return { min: new THREE.Vector3(b.x - 1, y, b.z - 1), max: new THREE.Vector3(b.x + 1, y + 0.4, b.z + 1), solid: true, pad: null };
  if (b.kind === "cylinder") return { min: new THREE.Vector3(b.x - 1, y, b.z - 1), max: new THREE.Vector3(b.x + 1, y + 2, b.z + 1), solid: true, pad: null };
  if (b.kind === "stairs")   return { min: new THREE.Vector3(b.x - 1, y, b.z - 1), max: new THREE.Vector3(b.x + 1, y + 1.5, b.z + 1), solid: true, pad: null };
  if (b.kind === "jumppad")  return { min: new THREE.Vector3(b.x - 1, y, b.z - 1), max: new THREE.Vector3(b.x + 1, y + 0.3, b.z + 1), solid: true, pad: "jump" };
  return                          { min: new THREE.Vector3(b.x - 1, y, b.z - 1), max: new THREE.Vector3(b.x + 1, y + 0.15, b.z + 1), solid: true, pad: "speed" };
}

export function ArenaScene({
  controls,
  onStateChange,
  onKillFeed,
  remotePlayersRef,
  remoteIds,
  onPose,
  onShoot,
  incomingHitRef,
  onLocalDeath,
  onFireSound,
  onReloadSound,
  customArena,
  fov = 75,
  viewBobbing = true,
  localPosRef,
  localOpsRef,
  speakingIdsRef,
  ctfRef,
  onFlagEvent,
  quality = "balanced",
  practice = false,
  practiceStatsRef,
  carsRef,
  onCarEvent,
  localId = "",
  onEnterExitCar,
}: {
  controls: React.MutableRefObject<Controls>;
  onStateChange: (s: GameState) => void;
  onKillFeed: (msg: string) => void;
  remotePlayersRef: React.MutableRefObject<Map<string, RemotePlayer>>;
  remoteIds: string[];
  onPose: (p: PlayerPose) => void;
  onShoot: (s: ShotEvent, hits: { id: string; damage: number }[], weapon: WeaponId, impact?: { x: number; y: number; z: number }) => void;
  incomingHitRef: React.MutableRefObject<number>;
  onLocalDeath: (killerName: string) => void;
  onFireSound?: () => void;
  onReloadSound?: () => void;
  customArena?: CustomArena | null;
  fov?: number;
  viewBobbing?: boolean;
  localPosRef?: React.MutableRefObject<LocalPos>;
  localOpsRef?: React.MutableRefObject<LocalOps>;
  speakingIdsRef?: React.MutableRefObject<Set<string>>;
  ctfRef?: React.MutableRefObject<CTFState | null>;
  onFlagEvent?: (e: FlagEvent) => void;
  quality?: Quality;
  practice?: boolean;
  practiceStatsRef?: React.MutableRefObject<PracticeStats>;
  carsRef?: React.MutableRefObject<CarsState | null>;
  onCarEvent?: (e: CarEvent) => void;
  localId?: string;
  onEnterExitCar?: (driving: Team | null) => void;
}) {
  const fireRef = useRef(0);
  const explosionsRef = useRef<{ x: number; y: number; z: number; t: number }[]>([]);
  const targetsRef = useRef<PracticeTarget[]>([]);
  if (practice && targetsRef.current.length === 0) targetsRef.current = makePracticeTargets();
  return (
    <Canvas
      shadows={quality === "fancy" ? "soft" : false}
      camera={{ fov, near: 0.05, far: 300 }}
      gl={{ antialias: quality !== "simple", powerPreference: "high-performance" }}
    >
      <QualityController quality={quality} />
      {quality === "simple" ? (
        <color attach="background" args={["#0a0716"]} />
      ) : (
        <Sky
          sunPosition={quality === "fancy" ? [60, 18, -90] : [100, 20, 100]}
          turbidity={quality === "fancy" ? 9 : 6}
          rayleigh={quality === "fancy" ? 3.2 : 2}
          mieCoefficient={0.008}
          mieDirectionalG={0.86}
        />
      )}
      {quality === "fancy" && <fogExp2 attach="fog" args={["#1b1436", 0.011]} />}
      <ambientLight intensity={quality === "simple" ? 0.9 : quality === "fancy" ? 0.22 : 0.45} />
      {quality === "fancy" && <hemisphereLight args={["#8ab4ff", "#2a1f4a", 0.55]} />}
      <directionalLight
        position={quality === "fancy" ? [34, 46, -28] : [20, 30, 10]}
        color={quality === "fancy" ? "#ffe3b0" : "#ffffff"}
        intensity={quality === "simple" ? 0.7 : quality === "fancy" ? 2.6 : 1.1}
        castShadow={quality === "fancy"}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-bias={-0.0006}
        shadow-normalBias={0.03}
        shadow-camera-left={-45}
        shadow-camera-right={45}
        shadow-camera-top={45}
        shadow-camera-bottom={-45}
        shadow-camera-far={140}
      />
      {customArena ? <CustomArenaWorld blocks={customArena.blocks} spawnPoints={customArena.spawnPoints} quality={quality} /> : <ArenaWorld quality={quality} />}
      {ctfRef && <CTFWorld ctfRef={ctfRef} remotePlayersRef={remotePlayersRef} />}
      {carsRef && <CarsView carsRef={carsRef} quality={quality} />}
      {practice && <PracticeTargets targetsRef={targetsRef} />}
      {remoteIds.map((id) => (
        <RemotePlayerView key={id} id={id} remotePlayersRef={remotePlayersRef} speakingIdsRef={speakingIdsRef} />
      ))}
      <Game
        controls={controls}
        onStateChange={onStateChange}
        onKillFeed={onKillFeed}
        remotePlayersRef={remotePlayersRef}
        onPose={onPose}
        onShoot={onShoot}
        incomingHitRef={incomingHitRef}
        onLocalDeath={onLocalDeath}
        fireRef={fireRef}
        onFireSound={onFireSound}
        onReloadSound={onReloadSound}
        spawnPoints={customArena?.spawnPoints}
        blocks={customArena?.blocks}
        explosionsRef={explosionsRef}
        fov={fov}
        localPosRef={localPosRef}
        localOpsRef={localOpsRef}
        ctfRef={ctfRef}
        onFlagEvent={onFlagEvent}
        targetsRef={practice ? targetsRef : undefined}
        practiceStatsRef={practiceStatsRef}
        carsRef={carsRef}
        onCarEvent={onCarEvent}
        localId={localId}
        onEnterExitCar={onEnterExitCar}
      />
      <ViewmodelGun controls={controls} fireRef={fireRef} viewBobbing={viewBobbing} />
      <Explosions explosionsRef={explosionsRef} />
      {quality === "fancy" && (
        <EffectComposer enableNormalPass={false}>
          <Bloom intensity={0.85} luminanceThreshold={0.55} luminanceSmoothing={0.25} mipmapBlur />
          <Vignette eskil={false} offset={0.25} darkness={0.75} />
          <SMAA />
        </EffectComposer>
      )}
    </Canvas>
  );
}

function QualityController({ quality }: { quality: Quality }) {
  const gl = useThree((s) => s.gl);
  const setDpr = useThree((s) => s.setDpr);
  useEffect(() => {
    const max = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    const dpr = quality === "simple" ? Math.min(0.75, max) : quality === "balanced" ? Math.min(1.25, max) : Math.min(2, max);
    setDpr(dpr);
    gl.shadowMap.enabled = quality === "fancy";
    gl.shadowMap.type = THREE.PCFSoftShadowMap;
    gl.toneMapping = quality === "fancy" ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
    gl.toneMappingExposure = quality === "fancy" ? 1.05 : 1;
    gl.shadowMap.needsUpdate = true;
  }, [quality, gl, setDpr]);
  return null;
}

function CarsView({ carsRef, quality }: { carsRef: React.MutableRefObject<CarsState | null>; quality: Quality }) {
  return (
    <group>
      <CarMesh team="red" carsRef={carsRef} quality={quality} />
      <CarMesh team="blue" carsRef={carsRef} quality={quality} />
    </group>
  );
}

function CarMesh({ team, carsRef, quality }: { team: Team; carsRef: React.MutableRefObject<CarsState | null>; quality: Quality }) {
  const ref = useRef<THREE.Group>(null);
  const bar = useRef<THREE.Mesh>(null);
  const [hpPct, setHpPct] = useState(1);
  const color = TEAM_COLORS[team];
  useFrame(() => {
    const cars = carsRef.current;
    const g = ref.current;
    if (!cars || !g) return;
    const car = cars[team];
    g.visible = car.alive;
    g.position.set(car.x, 0, car.z);
    g.rotation.y = car.yaw;
    const pct = Math.max(0, car.hp / car.maxHp);
    if (Math.abs(pct - hpPct) > 0.02) setHpPct(pct);
    if (bar.current) bar.current.scale.x = Math.max(0.001, pct);
  });
  return (
    <group ref={ref}>
      {/* chassis */}
      <mesh position={[0, 0.65, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.9, 0.7, 3.4]} />
        <meshStandardMaterial color="#141024" emissive={color} emissiveIntensity={0.35} metalness={0.85} roughness={0.25} />
      </mesh>
      {/* cabin */}
      <mesh position={[0, 1.2, -0.2]} castShadow>
        <boxGeometry args={[1.5, 0.6, 1.5]} />
        <meshStandardMaterial color="#0b1020" emissive="#22d3ee" emissiveIntensity={0.5} metalness={0.9} roughness={0.1} />
      </mesh>
      {/* headlights */}
      {[-0.55, 0.55].map((x) => (
        <mesh key={x} position={[x, 0.7, -1.72]}>
          <boxGeometry args={[0.4, 0.16, 0.06]} />
          <meshBasicMaterial color="#fef9c3" toneMapped={false} />
        </mesh>
      ))}
      <spotLight position={[0, 0.9, -1.8]} target-position={[0, 0, -12]} angle={0.6} penumbra={0.5} color="#fff2c4" intensity={quality === "simple" ? 0 : 12} distance={30} castShadow={false} />
      {/* wheels */}
      {([[-1, 1.1], [1, 1.1], [-1, -1.1], [1, -1.1]] as [number, number][]).map(([x, z], i) => (
        <mesh key={i} position={[x, 0.42, z]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.42, 0.42, 0.28, 16]} />
          <meshStandardMaterial color="#0a0a12" roughness={0.9} metalness={0.1} />
        </mesh>
      ))}
      {/* team stripe */}
      <mesh position={[0, 1.02, 0]}>
        <boxGeometry args={[1.95, 0.06, 3.42]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
      <Billboard position={[0, 2.3, 0]}>
        <mesh position={[0, 0, 0]} renderOrder={999}>
          <planeGeometry args={[1.6, 0.14]} />
          <meshBasicMaterial color="#111827" transparent opacity={0.85} depthTest={false} toneMapped={false} />
        </mesh>
        <group position={[-0.8, 0, 0.001]}>
          <mesh ref={bar} position={[0.8, 0, 0]} renderOrder={1000}>
            <planeGeometry args={[1.56, 0.1]} />
            <meshBasicMaterial color={hpPct > 0.4 ? color : "#f97316"} depthTest={false} toneMapped={false} />
          </mesh>
        </group>
        <Text position={[0, 0.28, 0]} fontSize={0.22} color={color} outlineWidth={0.03} outlineColor="#000" anchorX="center" anchorY="middle" renderOrder={999} material-depthTest={false} material-toneMapped={false}>
          {`${team.toUpperCase()} CAR`}
        </Text>
      </Billboard>
    </group>
  );
}

function PracticeTargets({ targetsRef }: { targetsRef: React.MutableRefObject<PracticeTarget[]> }) {
  const group = useRef<THREE.Group>(null);
  const t = useRef(0);
  useFrame((_, dt) => {
    t.current += dt;
    const g = group.current;
    if (!g) return;
    g.children.forEach((child, i) => {
      const tg = targetsRef.current[i];
      if (!tg) return;
      child.visible = tg.alive;
      child.position.set(tg.x, tg.y + Math.sin(t.current * 1.5 + tg.seed) * 0.5, tg.z);
      child.rotation.y = t.current * 1.2 + tg.seed;
    });
  });
  return (
    <group ref={group}>
      {targetsRef.current.map((tg) => (
        <group key={tg.id}>
          <mesh>
            <sphereGeometry args={[0.55, 20, 20]} />
            <meshStandardMaterial color="#f43f5e" emissive="#f43f5e" emissiveIntensity={1.2} toneMapped={false} />
          </mesh>
          <mesh rotation={[0, 0, 0]}>
            <torusGeometry args={[0.85, 0.06, 8, 32]} />
            <meshBasicMaterial color="#22d3ee" toneMapped={false} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function RemotePlayerView({
  id,
  remotePlayersRef,
  speakingIdsRef,
}: {
  id: string;
  remotePlayersRef: React.MutableRefObject<Map<string, RemotePlayer>>;
  speakingIdsRef?: React.MutableRefObject<Set<string>>;
}) {
  const ref = useRef<THREE.Group>(null);
  const micRef = useRef<THREE.Group>(null);
  const legL = useRef<THREE.Mesh>(null);
  const legR = useRef<THREE.Mesh>(null);
  const armL = useRef<THREE.Mesh>(null);
  const armR = useRef<THREE.Mesh>(null);
  const prev = useRef({ x: 0, z: 0, phase: 0 });
  const [name, setName] = useState<string>(() => remotePlayersRef.current.get(id)?.name ?? "Rival");
  const [rank, setRank] = useState<Rank>(() => remotePlayersRef.current.get(id)?.rank ?? "player");
  const [speaking, setSpeaking] = useState(false);
  const [team, setTeam] = useState<Team | null>(() => remotePlayersRef.current.get(id)?.team ?? null);
  const baseColor = useMemo(() => {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
    return `hsl(${h}, 90%, 60%)`;
  }, [id]);
  const color = team ? TEAM_COLORS[team] : baseColor;
  useFrame((_, dt) => {
    const r = remotePlayersRef.current.get(id);
    if (!r || !ref.current) return;
    ref.current.position.set(r.x, r.y, r.z);
    ref.current.rotation.y = r.yaw;
    ref.current.visible = r.alive;
    if (r.name && r.name !== name) setName(r.name);
    const rk = r.rank ?? "player";
    if (rk !== rank) setRank(rk);
    const tm = r.team ?? null;
    if (tm !== team) setTeam(tm);
    // walk animation
    const dx = r.x - prev.current.x;
    const dz = r.z - prev.current.z;
    const speed = Math.min(Math.hypot(dx, dz) / Math.max(dt, 1 / 120), 8);
    prev.current.x = r.x;
    prev.current.z = r.z;
    prev.current.phase += dt * (4 + speed * 1.5);
    const swing = Math.sin(prev.current.phase) * Math.min(speed * 0.15, 0.7);
    if (legL.current) legL.current.rotation.x = swing;
    if (legR.current) legR.current.rotation.x = -swing;
    if (armL.current) armL.current.rotation.x = -swing * 0.6;
    if (armR.current) armR.current.rotation.x = swing * 0.6;
    // voice activity
    const isSpeaking = speakingIdsRef?.current.has(id) ?? false;
    if (isSpeaking !== speaking) setSpeaking(isSpeaking);
    if (micRef.current && isSpeaking) {
      const s = 1 + Math.sin(prev.current.phase * 4) * 0.12;
      micRef.current.scale.setScalar(s);
    }
  });
  return (
    <group ref={ref}>
      {/* legs */}
      <group position={[0.18, 0, 0]}>
        <mesh ref={legR} position={[0, -0.4, 0]} castShadow>
          <boxGeometry args={[0.22, 0.8, 0.22]} />
          <meshStandardMaterial color="#1a1530" emissive={color} emissiveIntensity={0.2} />
        </mesh>
      </group>
      <group position={[-0.18, 0, 0]}>
        <mesh ref={legL} position={[0, -0.4, 0]} castShadow>
          <boxGeometry args={[0.22, 0.8, 0.22]} />
          <meshStandardMaterial color="#1a1530" emissive={color} emissiveIntensity={0.2} />
        </mesh>
      </group>
      {/* torso */}
      <mesh position={[0, 0.45, 0]} castShadow>
        <boxGeometry args={[0.7, 0.9, 0.4]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.5} metalness={0.5} roughness={0.3} />
      </mesh>
      {/* chest light */}
      <mesh position={[0, 0.55, 0.21]}>
        <boxGeometry args={[0.2, 0.06, 0.02]} />
        <meshStandardMaterial color="#22d3ee" emissive="#22d3ee" emissiveIntensity={3} toneMapped={false} />
      </mesh>
      {/* head + visor */}
      <mesh position={[0, 1.15, 0]} castShadow>
        <boxGeometry args={[0.45, 0.45, 0.45]} />
        <meshStandardMaterial color="#0f172a" metalness={0.8} roughness={0.2} />
      </mesh>
      <mesh position={[0, 1.18, 0.23]}>
        <boxGeometry args={[0.36, 0.14, 0.02]} />
        <meshStandardMaterial color="#22d3ee" emissive="#22d3ee" emissiveIntensity={4} toneMapped={false} />
      </mesh>
      {/* arms (with shoulder pivots) */}
      <group position={[0.45, 0.8, 0]}>
        <mesh ref={armR} position={[0, -0.35, 0]} castShadow>
          <boxGeometry args={[0.2, 0.75, 0.2]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.3} />
        </mesh>
        {/* gun in right hand */}
        <mesh position={[0, -0.6, -0.35]}>
          <boxGeometry args={[0.14, 0.18, 0.7]} />
          <meshStandardMaterial color="#0f172a" emissive="#ec4899" emissiveIntensity={0.4} metalness={0.7} roughness={0.3} />
        </mesh>
        <mesh position={[0, -0.55, -0.7]}>
          <boxGeometry args={[0.06, 0.06, 0.2]} />
          <meshStandardMaterial color="#22d3ee" emissive="#22d3ee" emissiveIntensity={2} toneMapped={false} />
        </mesh>
      </group>
      <group position={[-0.45, 0.8, 0]}>
        <mesh ref={armL} position={[0, -0.35, 0]} castShadow>
          <boxGeometry args={[0.2, 0.75, 0.2]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.3} />
        </mesh>
      </group>
      <Billboard position={[0, 2, 0]}>
        {speaking && (
          <group ref={micRef} position={[rank !== "player" ? -0.85 : -0.6, rank !== "player" ? 0.45 : 0, 0]}>
            <mesh renderOrder={999}>
              <capsuleGeometry args={[0.07, 0.12, 4, 8]} />
              <meshBasicMaterial color="#4ade80" toneMapped={false} depthTest={false} />
            </mesh>
            <mesh position={[0, -0.18, 0]} renderOrder={999}>
              <boxGeometry args={[0.04, 0.1, 0.04]} />
              <meshBasicMaterial color="#4ade80" toneMapped={false} depthTest={false} />
            </mesh>
            <mesh position={[0, -0.24, 0]} renderOrder={999}>
              <boxGeometry args={[0.2, 0.04, 0.04]} />
              <meshBasicMaterial color="#4ade80" toneMapped={false} depthTest={false} />
            </mesh>
          </group>
        )}
        {rank !== "player" && (
          <Text
            position={[0, 0.45, 0]}
            fontSize={0.28}
            color={rank === "owner" ? "#fbbf24" : "#f43f5e"}
            outlineWidth={0.045}
            outlineColor="#000000"
            anchorX="center"
            anchorY="middle"
            renderOrder={999}
            material-depthTest={false}
            material-toneMapped={false}
          >
            {rank === "owner" ? "★ OWNER ★" : "◆ ADMIN"}
          </Text>
        )}
        <Text
          fontSize={0.35}
          color={rank === "owner" ? "#fde68a" : rank === "admin" ? "#fecaca" : "#22d3ee"}
          outlineWidth={0.04}
          outlineColor="#000000"
          anchorX="center"
          anchorY="middle"
          renderOrder={999}
          material-depthTest={false}
          material-toneMapped={false}
        >
          {name.toUpperCase()}
        </Text>
      </Billboard>
    </group>
  );
}

function ArenaWorld({ quality = "balanced" }: { quality?: Quality }) {
  // floor + walls + cover crates
  const crates = useMemo(() => {
    const arr: { x: number; z: number; s: number }[] = [];
    for (let i = 0; i < 14; i++) {
      arr.push({
        x: (Math.random() - 0.5) * (ARENA - 4),
        z: (Math.random() - 0.5) * (ARENA - 4),
        s: 1 + Math.random() * 1.5,
      });
    }
    return arr;
  }, []);
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[ARENA * 2, ARENA * 2]} />
        <meshStandardMaterial color="#1a1530" />
      </mesh>
      {/* grid lines */}
      {quality !== "simple" && <gridHelper args={[ARENA * 2, quality === "fancy" ? 40 : 20, "#22d3ee", "#3b1d6b"]} position={[0, 0.01, 0]} />}
      {/* walls */}
      {[
        [0, ARENA, ARENA * 2, 1],
        [0, -ARENA, ARENA * 2, 1],
        [ARENA, 0, 1, ARENA * 2],
        [-ARENA, 0, 1, ARENA * 2],
      ].map(([x, z, w, d], i) => (
        <mesh key={i} position={[x, 1.5, z]} castShadow>
          <boxGeometry args={[w as number, 3, d as number]} />
          <meshStandardMaterial color="#221b3d" emissive="#06b6d4" emissiveIntensity={0.15} />
        </mesh>
      ))}
      {crates.map((c, i) => (
        <mesh key={i} position={[c.x, c.s / 2, c.z]} castShadow>
          <boxGeometry args={[c.s, c.s, c.s]} />
          <meshStandardMaterial color="#2a1f4a" emissive="#ec4899" emissiveIntensity={0.2} />
        </mesh>
      ))}
    </group>
  );
}

function Game({
  controls,
  onStateChange,
  onKillFeed,
  remotePlayersRef,
  onPose,
  onShoot,
  incomingHitRef,
  onLocalDeath,
  fireRef,
  onFireSound,
  onReloadSound,
  spawnPoints,
  blocks,
  explosionsRef,
  fov = 75,
  localPosRef,
  localOpsRef,
  ctfRef,
  onFlagEvent,
  targetsRef,
  practiceStatsRef,
  carsRef,
  onCarEvent,
  localId = "",
  onEnterExitCar,
}: {
  controls: React.MutableRefObject<Controls>;
  onStateChange: (s: GameState) => void;
  onKillFeed: (msg: string) => void;
  remotePlayersRef: React.MutableRefObject<Map<string, RemotePlayer>>;
  onPose: (p: PlayerPose) => void;
  onShoot: (s: ShotEvent, hits: { id: string; damage: number }[], weapon: WeaponId, impact?: { x: number; y: number; z: number }) => void;
  incomingHitRef: React.MutableRefObject<number>;
  onLocalDeath: (killerName: string) => void;
  fireRef: React.MutableRefObject<number>;
  onFireSound?: () => void;
  onReloadSound?: () => void;
  spawnPoints?: SpawnPoint[];
  blocks?: ArenaBlock[];
  explosionsRef: React.MutableRefObject<{ x: number; y: number; z: number; t: number }[]>;
  fov?: number;
  localPosRef?: React.MutableRefObject<LocalPos>;
  localOpsRef?: React.MutableRefObject<LocalOps>;
  ctfRef?: React.MutableRefObject<CTFState | null>;
  onFlagEvent?: (e: FlagEvent) => void;
  targetsRef?: React.MutableRefObject<PracticeTarget[]>;
  practiceStatsRef?: React.MutableRefObject<PracticeStats>;
  carsRef?: React.MutableRefObject<CarsState | null>;
  onCarEvent?: (e: CarEvent) => void;
  localId?: string;
  onEnterExitCar?: (driving: Team | null) => void;
}) {
  const { camera } = useThree();
  const pickSpawn = () => {
    const ctf = ctfRef?.current;
    if (ctf) {
      const b = CTF_BASES[ctf.myTeam];
      return new THREE.Vector3(b.x + (Math.random() * 6 - 3), EYE, b.z + (ctf.myTeam === "red" ? 3 : -3));
    }
    if (spawnPoints && spawnPoints.length > 0) {
      const sp = spawnPoints[Math.floor(Math.random() * spawnPoints.length)];
      return new THREE.Vector3(sp.x, EYE, sp.z);
    }
    return new THREE.Vector3(0, EYE, 8);
  };
  const player = useRef({
    pos: pickSpawn(),
    vy: 0,
    grounded: true,
    hp: 100,
    kills: 0,
    deaths: 0,
    ammo: { rifle: 30, sniper: 5, rpg: 3, pistol: 12 } as Record<WeaponId, number>,
    speedBoostUntil: 0,
    lastPad: 0,
  });
  const lastFire = useRef(0);
  const muzzleFlash = useRef<{ t: number }>({ t: 0 });
  const lastPose = useRef(0);
  const remoteGroup = useRef<THREE.Group>(null);
  const reloadEnd = useRef(0);
  const reloadWeapon = useRef<WeaponId>("rifle");
  const drivingRef = useRef<Team | null>(null);
  const lastInteract = useRef(false);
  const lastCarSync = useRef(0);

  useEffect(() => {
    camera.position.copy(player.current.pos);
  }, [camera]);

  // Precompute solid block AABBs each frame (custom arena is stable via reference)
  const solidBoxes = useMemo(() => (blocks ?? []).map((b) => ({ block: b, box: blockBox(b) })), [blocks]);

  function floorAt(x: number, z: number, currentY: number): { top: number; pad: null | "jump" | "speed" } {
    let top = 0;
    let pad: null | "jump" | "speed" = null;
    for (const { block, box } of solidBoxes) {
      if (x < box.min.x - PLAYER_RADIUS || x > box.max.x + PLAYER_RADIUS) continue;
      if (z < box.min.z - PLAYER_RADIUS || z > box.max.z + PLAYER_RADIUS) continue;
      let surface = box.max.y;
      if (block.kind === "stairs") {
        // Ramp: height rises with local +z (before rotation). Rotate world -> local.
        const rot = block.rot ?? 0;
        const dx = x - block.x, dz = z - block.z;
        const lz = -Math.sin(-rot) * dx + Math.cos(-rot) * dz;
        const t = THREE.MathUtils.clamp((lz + 1) / 2, 0, 1);
        surface = (block.y ?? 0) + t * 1.5;
      }
      // "top" must be at or below the head to count as standing surface
      if (surface <= currentY + 0.01 && surface > top) {
        top = surface;
        pad = box.pad;
      }
    }
    return { top, pad };
  }

  function collideXZ(pos: THREE.Vector3, feetY: number) {
    // Push out horizontally from any solid block whose vertical span overlaps [feetY, feetY+1.6]
    for (const { block, box } of solidBoxes) {
      if (block.kind === "stairs" || box.pad) continue; // walkable
      const headY = feetY + EYE;
      if (box.max.y <= feetY + 0.05) continue; // walkable on top
      if (box.min.y >= headY) continue; // above head
      // Closest point on box XZ
      const cx = THREE.MathUtils.clamp(pos.x, box.min.x, box.max.x);
      const cz = THREE.MathUtils.clamp(pos.z, box.min.z, box.max.z);
      const dx = pos.x - cx;
      const dz = pos.z - cz;
      const d = Math.hypot(dx, dz);
      if (d < PLAYER_RADIUS && d > 0) {
        const push = (PLAYER_RADIUS - d) / d;
        pos.x += dx * push;
        pos.z += dz * push;
      } else if (d === 0) {
        pos.x = box.max.x + PLAYER_RADIUS;
      }
    }
  }

  useFrame((_, dt) => {
    const c = controls.current;
    const now = performance.now();
    const weapon = c.weapon ?? "rifle";
    const spec = WEAPONS[weapon];

    // camera rotation
    const euler = new THREE.Euler(c.pitch, c.yaw, 0, "YXZ");
    camera.quaternion.setFromEuler(euler);
    // FOV zoom for sniper
    const persp = camera as THREE.PerspectiveCamera;
    const base = fov;
    let targetFov = base;
    if (weapon === "sniper" && c.fire) targetFov = Math.max(20, base - 40);
    else if (weapon === "sniper") targetFov = Math.max(30, base - 20);
    if (c.zoom) targetFov = Math.min(targetFov, base * 0.55);
    persp.fov += (targetFov - persp.fov) * Math.min(1, dt * 8);
    persp.updateProjectionMatrix();

    // movement relative to yaw
    const boost = now < player.current.speedBoostUntil ? 1.9 : 1;
    const opsMult = localOpsRef?.current.speedMult ?? 1;
    const frozen = localOpsRef?.current.frozen ?? false;
    const speed = 6 * boost * opsMult;
    if (frozen) { c.moveX = 0; c.moveY = 0; }

    // ===== Vehicles: enter / exit / drive =====
    const cars = carsRef?.current ?? null;
    if (cars) {
      // eject if our car died or we died
      const cur = drivingRef.current ? cars[drivingRef.current] : null;
      if (cur && (!cur.alive || cur.driverId !== localId || player.current.hp <= 0)) {
        drivingRef.current = null;
        onEnterExitCar?.(null);
      }
      const pressed = c.interact && !lastInteract.current;
      lastInteract.current = c.interact;
      if (pressed && player.current.hp > 0) {
        if (drivingRef.current) {
          const car = cars[drivingRef.current];
          car.driverId = null;
          const ox = car.x + Math.cos(car.yaw) * 2.2;
          const oz = car.z - Math.sin(car.yaw) * 2.2;
          player.current.pos.set(ox, EYE + 0.4, oz);
          player.current.vy = 0;
          onCarEvent?.({ type: "exit", team: car.team, byId: localId, x: car.x, z: car.z, yaw: car.yaw });
          drivingRef.current = null;
          onEnterExitCar?.(null);
          onKillFeed("You left the vehicle");
        } else {
          let pick: Car | null = null;
          let bd = CAR_ENTER_RANGE;
          for (const t of ["red", "blue"] as Team[]) {
            const car = cars[t];
            if (!car.alive || car.driverId) continue;
            const d = Math.hypot(player.current.pos.x - car.x, player.current.pos.z - car.z);
            if (d < bd) { bd = d; pick = car; }
          }
          if (pick) {
            pick.driverId = localId;
            drivingRef.current = pick.team;
            onCarEvent?.({ type: "enter", team: pick.team, byId: localId });
            onEnterExitCar?.(pick.team);
            onKillFeed(`You hopped into the ${pick.team} car`);
          }
        }
      }
    }

    if (drivingRef.current && cars) {
      const car = cars[drivingRef.current];
      const drive = c.moveY;
      car.yaw -= c.moveX * 2.0 * dt * (drive < -0.05 ? -1 : 1);
      const v = drive * 16;
      car.x += -Math.sin(car.yaw) * v * dt;
      car.z += -Math.cos(car.yaw) * v * dt;
      car.x = THREE.MathUtils.clamp(car.x, -ARENA + 2, ARENA - 2);
      car.z = THREE.MathUtils.clamp(car.z, -ARENA + 2, ARENA - 2);
      player.current.pos.set(car.x, EYE + 0.75, car.z);
      player.current.vy = 0;
      camera.position.copy(player.current.pos);
      if (now - lastCarSync.current > 66) {
        lastCarSync.current = now;
        onCarEvent?.({ type: "move", team: car.team, x: car.x, z: car.z, yaw: car.yaw, byId: localId });
      }
    }

    const forward = new THREE.Vector3(-Math.sin(c.yaw), 0, -Math.cos(c.yaw));
    const right = new THREE.Vector3(Math.cos(c.yaw), 0, -Math.sin(c.yaw));
    const move = new THREE.Vector3()
      .addScaledVector(forward, c.moveY * speed * dt)
      .addScaledVector(right, c.moveX * speed * dt);
    if (!drivingRef.current) player.current.pos.add(move);

    // Owner teleport (consume once)
    if (localOpsRef?.current.teleport) {
      const tp = localOpsRef.current.teleport;
      player.current.pos.set(tp.x, EYE + 0.5, tp.z);
      player.current.vy = 0;
      localOpsRef.current.teleport = null;
    }

    player.current.pos.x = THREE.MathUtils.clamp(player.current.pos.x, -ARENA + 1, ARENA - 1);
    player.current.pos.z = THREE.MathUtils.clamp(player.current.pos.z, -ARENA + 1, ARENA - 1);

    // Horizontal collision resolution against solid blocks
    const feetY = player.current.pos.y - EYE;
    collideXZ(player.current.pos, feetY);

    // Vertical: gravity + jump + floor snap
    player.current.vy -= GRAVITY * dt;
    player.current.pos.y += player.current.vy * dt;
    const { top: floorTop, pad } = floorAt(player.current.pos.x, player.current.pos.z, player.current.pos.y);
    const feetNow = player.current.pos.y - EYE;
    if (feetNow <= floorTop) {
      player.current.pos.y = floorTop + EYE;
      const wasFalling = player.current.vy < -1;
      player.current.vy = 0;
      player.current.grounded = true;
      // Pad effects (throttled to avoid re-trigger while standing)
      if (pad === "jump" && wasFalling && now - player.current.lastPad > 200) {
        player.current.vy = JUMP_VELOCITY * 1.9;
        player.current.grounded = false;
        player.current.lastPad = now;
      } else if (pad === "speed" && now - player.current.lastPad > 200) {
        player.current.speedBoostUntil = now + 2500;
        player.current.lastPad = now;
      }
    } else {
      player.current.grounded = false;
    }
    // Jump input
    if (c.jump && player.current.grounded) {
      player.current.vy = JUMP_VELOCITY;
      player.current.grounded = false;
    }

    camera.position.copy(player.current.pos);

    // Apply incoming damage / heal from network
    if (incomingHitRef.current !== 0 && player.current.hp > 0) {
      // God mode: ignore positive damage, still allow negative (heals)
      const god = localOpsRef?.current.god ?? false;
      const dmg = god && incomingHitRef.current > 0 ? 0 : incomingHitRef.current;
      player.current.hp -= dmg;
      incomingHitRef.current = 0;
      if (player.current.hp > 100) player.current.hp = 100;
      if (player.current.hp <= 0) {
        player.current.hp = 100;
        player.current.deaths += 1;
        // Drop any carried flag where we died
        const ctfd = ctfRef?.current;
        if (ctfd) {
          const enemy: Team = ctfd.myTeam === "red" ? "blue" : "red";
          if (ctfd[enemy].carrierId === ctfd.myId) {
            ctfd[enemy].carrierId = null;
            ctfd[enemy].home = false;
            ctfd[enemy].x = player.current.pos.x;
            ctfd[enemy].z = player.current.pos.z;
            onFlagEvent?.({ type: "drop", team: enemy, byId: ctfd.myId, x: ctfd[enemy].x, z: ctfd[enemy].z });
          }
        }
        const sp = pickSpawn();
        player.current.pos.set(sp.x, sp.y, sp.z);
        player.current.vy = 0;
        onLocalDeath("");
      }
    }

    // Publish local pos for proximity voice
    if (localPosRef) {
      localPosRef.current.x = player.current.pos.x;
      localPosRef.current.y = player.current.pos.y;
      localPosRef.current.z = player.current.pos.z;
    }

    // ===== Capture the Flag logic =====
    const ctf = ctfRef?.current;
    if (ctf && player.current.hp > 0) {
      const me: Team = ctf.myTeam;
      const enemy: Team = me === "red" ? "blue" : "red";
      const px = player.current.pos.x;
      const pz = player.current.pos.z;
      const enemyFlag = ctf[enemy];
      const myFlag = ctf[me];
      const carrying = enemyFlag.carrierId === ctf.myId;

      if (carrying) {
        enemyFlag.x = px;
        enemyFlag.z = pz;
        const base = CTF_BASES[me];
        if (myFlag.home && Math.hypot(px - base.x, pz - base.z) < 2.6) {
          enemyFlag.carrierId = null;
          enemyFlag.home = true;
          enemyFlag.x = CTF_BASES[enemy].x;
          enemyFlag.z = CTF_BASES[enemy].z;
          if (me === "red") ctf.scoreRed += 1; else ctf.scoreBlue += 1;
          onKillFeed("You captured the enemy flag!");
          onFlagEvent?.({ type: "capture", team: me, byId: ctf.myId });
        }
      } else if (!enemyFlag.carrierId && Math.hypot(px - enemyFlag.x, pz - enemyFlag.z) < 1.8) {
        enemyFlag.carrierId = ctf.myId;
        enemyFlag.home = false;
        onKillFeed("You picked up the enemy flag!");
        onFlagEvent?.({ type: "pickup", team: enemy, byId: ctf.myId });
      }

      // Return our own dropped flag by touching it
      if (!myFlag.home && !myFlag.carrierId && Math.hypot(px - myFlag.x, pz - myFlag.z) < 1.8) {
        myFlag.home = true;
        myFlag.x = CTF_BASES[me].x;
        myFlag.z = CTF_BASES[me].z;
        onKillFeed("You returned your flag");
        onFlagEvent?.({ type: "return", team: me, byId: ctf.myId });
      }
    }

    // Reload trigger (per current weapon)
    if (c.reload && reloadEnd.current === 0 && player.current.ammo[weapon] < spec.magazine && player.current.hp > 0) {
      reloadEnd.current = now + spec.reloadMs;
      reloadWeapon.current = weapon;
      onReloadSound?.();
    }
    if (reloadEnd.current > 0 && now >= reloadEnd.current) {
      player.current.ammo[reloadWeapon.current] = WEAPONS[reloadWeapon.current].magazine;
      reloadEnd.current = 0;
    }
    // Auto-reload when current weapon empty
    if (player.current.ammo[weapon] <= 0 && reloadEnd.current === 0 && player.current.hp > 0) {
      reloadEnd.current = now + spec.reloadMs;
      reloadWeapon.current = weapon;
      onReloadSound?.();
    }

    const reloading = reloadEnd.current > 0;
    // Practice targets: respawn
    if (targetsRef) {
      for (const tg of targetsRef.current) {
        if (!tg.alive && now >= tg.respawnAt) {
          tg.alive = true;
          tg.x = (Math.random() - 0.5) * (ARENA - 8);
          tg.y = 1.2 + Math.random() * 2.2;
          tg.z = -6 - Math.random() * (ARENA - 12);
          tg.seed = Math.random() * 10;
        }
      }
    }
    // Fire
    if (c.fire && !reloading && now - lastFire.current > spec.cooldownMs && player.current.ammo[weapon] > 0 && player.current.hp > 0) {
      lastFire.current = now;
      player.current.ammo[weapon] -= 1;
      muzzleFlash.current.t = now;
      fireRef.current = now;
      onFireSound?.();
      // hitscan vs remote players
      const origin = camera.position.clone();
      const dir = new THREE.Vector3();
      camera.getWorldDirection(dir);
      const ray = new THREE.Raycaster(origin, dir, 0.1, spec.maxRange);
      let best: { id: string; dist: number; point: THREE.Vector3 } | null = null;
      for (const r of remotePlayersRef.current.values()) {
        if (!r.alive) continue;
        if (ctf && r.team && r.team === ctf.myTeam) continue; // no friendly fire
        const sphere = new THREE.Sphere(new THREE.Vector3(r.x, r.y + 0.2, r.z), 0.75);
        const hit = ray.ray.intersectSphere(sphere, new THREE.Vector3());
        if (hit) {
          const dist = hit.distanceTo(origin);
          if (!best || dist < best.dist) best = { id: r.id, dist, point: hit };
        }
      }
      const hits: { id: string; damage: number }[] = [];
      let impact: { x: number; y: number; z: number } | undefined;
      if (spec.splashRadius > 0) {
        // RPG — impact point is either the direct hit or max-range point
        const impactPoint = best ? best.point : origin.clone().add(dir.clone().multiplyScalar(spec.maxRange));
        impact = { x: impactPoint.x, y: impactPoint.y, z: impactPoint.z };
        explosionsRef.current.push({ ...impact, t: now });
        for (const r of remotePlayersRef.current.values()) {
          if (!r.alive) continue;
          if (ctf && r.team && r.team === ctf.myTeam) continue;
          const d = new THREE.Vector3(r.x, r.y, r.z).distanceTo(impactPoint);
          if (d <= spec.splashRadius) {
            const dmg = Math.round(spec.damage * (1 - d / spec.splashRadius));
            if (dmg > 0) hits.push({ id: r.id, damage: dmg });
          }
        }
      } else if (best) {
        hits.push({ id: best.id, damage: spec.damage });
      }
      onShoot(
        {
          ox: origin.x, oy: origin.y, oz: origin.z,
          dx: dir.x, dy: dir.y, dz: dir.z,
          shooterId: "", shooterName: "",
        },
        hits, weapon, impact,
      );
      for (const h of hits) {
        const r = remotePlayersRef.current.get(h.id);
        if (r) {
          player.current.kills += (h.damage >= 90 || spec.splashRadius > 0) ? 1 : 0;
          if (h.damage >= 90) onKillFeed(`You eliminated ${r.name}`);
          else if (spec.splashRadius > 0) onKillFeed(`You blasted ${r.name}`);
        }
      }

      // Practice targets hitscan
      if (targetsRef) {
        if (practiceStatsRef) practiceStatsRef.current.shots += 1;
        let bestT: PracticeTarget | null = null;
        let bestD = Infinity;
        for (const tg of targetsRef.current) {
          if (!tg.alive) continue;
          const sphere = new THREE.Sphere(new THREE.Vector3(tg.x, tg.y, tg.z), 0.85);
          const hit = ray.ray.intersectSphere(sphere, new THREE.Vector3());
          if (hit) {
            const d = hit.distanceTo(origin);
            if (d < bestD) { bestD = d; bestT = tg; }
          }
        }
        if (bestT) {
          bestT.alive = false;
          bestT.respawnAt = now + 900;
          if (practiceStatsRef) practiceStatsRef.current.hits += 1;
          player.current.kills += 1;
          onKillFeed("Target down");
        }
      }
    }

    // Broadcast pose ~15Hz
    if (now - lastPose.current > 66) {
      lastPose.current = now;
      onPose({
        x: player.current.pos.x,
        y: player.current.pos.y - EYE,
        z: player.current.pos.z,
        yaw: c.yaw,
        pitch: c.pitch,
        alive: player.current.hp > 0,
        team: ctf?.myTeam,
        carrying: ctf ? (ctf[ctf.myTeam === "red" ? "blue" : "red"].carrierId === ctf.myId ? (ctf.myTeam === "red" ? "blue" : "red") : null) : null,
      });
    }

    onStateChange({
      hp: Math.max(0, Math.round(player.current.hp)),
      kills: player.current.kills,
      deaths: player.current.deaths,
      ammo: Math.floor(player.current.ammo[weapon]),
      maxAmmo: spec.magazine,
      weapon,
      reloading: reloadEnd.current > 0,
    });
  });

  return <group ref={remoteGroup} />;
}

function CTFWorld({
  ctfRef,
  remotePlayersRef,
}: {
  ctfRef: React.MutableRefObject<CTFState | null>;
  remotePlayersRef: React.MutableRefObject<Map<string, RemotePlayer>>;
}) {
  return (
    <group>
      {(["red", "blue"] as Team[]).map((t) => (
        <group key={t} position={[CTF_BASES[t].x, 0.02, CTF_BASES[t].z]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[2.2, 2.7, 48]} />
            <meshBasicMaterial color={TEAM_COLORS[t]} toneMapped={false} transparent opacity={0.9} />
          </mesh>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
            <circleGeometry args={[2.2, 48]} />
            <meshBasicMaterial color={TEAM_COLORS[t]} toneMapped={false} transparent opacity={0.15} />
          </mesh>
          <pointLight color={TEAM_COLORS[t]} intensity={12} distance={14} position={[0, 2, 0]} />
        </group>
      ))}
      <FlagMesh team="red" ctfRef={ctfRef} remotePlayersRef={remotePlayersRef} />
      <FlagMesh team="blue" ctfRef={ctfRef} remotePlayersRef={remotePlayersRef} />
    </group>
  );
}

function FlagMesh({
  team,
  ctfRef,
  remotePlayersRef,
}: {
  team: Team;
  ctfRef: React.MutableRefObject<CTFState | null>;
  remotePlayersRef: React.MutableRefObject<Map<string, RemotePlayer>>;
}) {
  const ref = useRef<THREE.Group>(null);
  const cloth = useRef<THREE.Mesh>(null);
  const t = useRef(0);
  useFrame((_, dt) => {
    const ctf = ctfRef.current;
    const g = ref.current;
    if (!ctf || !g) return;
    const f = ctf[team];
    t.current += dt;
    let x = f.x;
    let z = f.z;
    let y = 0;
    let visible = true;
    if (f.carrierId) {
      if (f.carrierId === ctf.myId) {
        visible = false; // carried by us — shown in HUD
      } else {
        const r = remotePlayersRef.current.get(f.carrierId);
        if (r) { x = r.x; z = r.z; y = r.y + 1.2; }
      }
    }
    g.visible = visible;
    g.position.set(x, y, z);
    g.rotation.y = t.current * 1.2;
    if (cloth.current) cloth.current.rotation.z = Math.sin(t.current * 3) * 0.08;
  });
  const color = TEAM_COLORS[team];
  return (
    <group ref={ref}>
      <mesh position={[0, 1.1, 0]}>
        <cylinderGeometry args={[0.06, 0.06, 2.2, 8]} />
        <meshStandardMaterial color="#e5e7eb" emissive="#94a3b8" emissiveIntensity={0.3} />
      </mesh>
      <mesh ref={cloth} position={[0.55, 1.75, 0]}>
        <planeGeometry args={[1.1, 0.7]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.9} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
      <pointLight color={color} intensity={6} distance={9} position={[0, 1.6, 0]} />
    </group>
  );
}

function CustomArenaWorld({ blocks, spawnPoints, quality = "balanced" }: { blocks: ArenaBlock[]; spawnPoints: SpawnPoint[]; quality?: Quality }) {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[ARENA * 2, ARENA * 2]} />
        <meshStandardMaterial color="#1a1530" />
      </mesh>
      {quality !== "simple" && <gridHelper args={[ARENA * 2, quality === "fancy" ? 40 : 20, "#22d3ee", "#3b1d6b"]} position={[0, 0.01, 0]} />}
      {[
        [0, ARENA, ARENA * 2, 1],
        [0, -ARENA, ARENA * 2, 1],
        [ARENA, 0, 1, ARENA * 2],
        [-ARENA, 0, 1, ARENA * 2],
      ].map(([x, z, w, d], i) => (
        <mesh key={i} position={[x, 1.5, z]} castShadow>
          <boxGeometry args={[w as number, 3, d as number]} />
          <meshStandardMaterial color="#221b3d" emissive="#06b6d4" emissiveIntensity={0.15} />
        </mesh>
      ))}
      {blocks.map((b) => <ArenaBlockMesh key={b.id} block={b} />)}
      {spawnPoints.map((s) => (
        <group key={s.id} position={[s.x, 0.05, s.z]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.8, 1, 32]} />
            <meshBasicMaterial color="#22d3ee" toneMapped={false} transparent opacity={0.6} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

export function ArenaBlockMesh({ block }: { block: ArenaBlock }) {
  const yb = block.y ?? 0;
  if (block.kind === "cube") {
    return (
      <mesh position={[block.x, yb + 1, block.z]} castShadow receiveShadow>
        <boxGeometry args={[2, 2, 2]} />
        <meshStandardMaterial color="#2a1f4a" emissive="#ec4899" emissiveIntensity={0.3} />
      </mesh>
    );
  }
  if (block.kind === "plate") {
    return (
      <mesh position={[block.x, yb + 0.2, block.z]} castShadow receiveShadow>
        <boxGeometry args={[2, 0.4, 2]} />
        <meshStandardMaterial color="#221b3d" emissive="#22d3ee" emissiveIntensity={0.3} />
      </mesh>
    );
  }
  if (block.kind === "cylinder") {
    return (
      <mesh position={[block.x, yb + 1, block.z]} castShadow receiveShadow>
        <cylinderGeometry args={[1, 1, 2, 24]} />
        <meshStandardMaterial color="#2a1f4a" emissive="#a78bfa" emissiveIntensity={0.4} />
      </mesh>
    );
  }
  if (block.kind === "stairs") {
    return (
      <group position={[block.x, yb, block.z]} rotation={[0, block.rot ?? 0, 0]}>
        {[0, 1, 2].map((i) => (
          <mesh key={i} position={[0, 0.25 + i * 0.5, -0.66 + i * 0.66]} castShadow receiveShadow>
            <boxGeometry args={[2, 0.5, 0.66]} />
            <meshStandardMaterial color="#2a1f4a" emissive="#22d3ee" emissiveIntensity={0.25} />
          </mesh>
        ))}
      </group>
    );
  }
  if (block.kind === "jumppad") {
    return (
      <group position={[block.x, yb, block.z]}>
        <mesh position={[0, 0.15, 0]} receiveShadow>
          <boxGeometry args={[2, 0.3, 2]} />
          <meshStandardMaterial color="#0f172a" emissive="#22d3ee" emissiveIntensity={1.6} toneMapped={false} />
        </mesh>
        <mesh position={[0, 0.35, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.55, 0.85, 24]} />
          <meshBasicMaterial color="#22d3ee" toneMapped={false} />
        </mesh>
        <pointLight position={[0, 1, 0]} color="#22d3ee" intensity={2} distance={4} />
      </group>
    );
  }
  // speedpad
  return (
    <group position={[block.x, yb, block.z]} rotation={[0, block.rot ?? 0, 0]}>
      <mesh position={[0, 0.075, 0]} receiveShadow>
        <boxGeometry args={[2, 0.15, 2]} />
        <meshStandardMaterial color="#0f172a" emissive="#f97316" emissiveIntensity={1.4} toneMapped={false} />
      </mesh>
      {[-0.5, 0, 0.5].map((zo, i) => (
        <mesh key={i} position={[0, 0.17, zo]}>
          <coneGeometry args={[0.28, 0.6, 3]} />
          <meshBasicMaterial color="#fef08a" toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

function Explosions({ explosionsRef }: { explosionsRef: React.MutableRefObject<{ x: number; y: number; z: number; t: number }[]> }) {
  const group = useRef<THREE.Group>(null);
  const [, force] = useState(0);
  useFrame(() => {
    const now = performance.now();
    const before = explosionsRef.current.length;
    explosionsRef.current = explosionsRef.current.filter((e) => now - e.t < 500);
    if (explosionsRef.current.length !== before) force((n) => n + 1);
    if (!group.current) return;
    group.current.children.forEach((child, i) => {
      const e = explosionsRef.current[i];
      if (!e) return;
      const a = (now - e.t) / 500;
      const s = 0.5 + a * 5;
      child.scale.setScalar(s);
      const m = (child as THREE.Mesh).material as THREE.MeshBasicMaterial;
      m.opacity = 1 - a;
    });
  });
  return (
    <group ref={group}>
      {explosionsRef.current.map((e, i) => (
        <mesh key={i} position={[e.x, e.y, e.z]}>
          <sphereGeometry args={[1, 16, 16]} />
          <meshBasicMaterial color="#f97316" transparent opacity={1} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

function ViewmodelGun({
  controls,
  fireRef,
  viewBobbing = true,
}: {
  controls: React.MutableRefObject<Controls>;
  fireRef: React.MutableRefObject<number>;
  viewBobbing?: boolean;
}) {
  const { camera } = useThree();
  const group = useRef<THREE.Group>(null);
  const flash = useRef<THREE.Mesh>(null);
  const flashLight = useRef<THREE.PointLight>(null);
  const bobPhase = useRef(0);
  useFrame((_, dt) => {
    const g = group.current;
    if (!g) return;
    // Anchor to camera
    g.position.copy(camera.position);
    g.quaternion.copy(camera.quaternion);
    // Offset into camera-local space
    const right = new THREE.Vector3(0.28, -0.25, -0.55).applyQuaternion(camera.quaternion);
    g.position.add(right);

    // Bob while moving
    const moving = viewBobbing ? Math.hypot(controls.current.moveX, controls.current.moveY) : 0;
    bobPhase.current += dt * (6 + moving * 6);
    const bobY = Math.sin(bobPhase.current) * 0.012 * moving;
    const bobX = Math.cos(bobPhase.current * 0.5) * 0.01 * moving;
    const upDown = new THREE.Vector3(bobX, bobY, 0).applyQuaternion(camera.quaternion);
    g.position.add(upDown);

    // Recoil kick — back and up briefly after firing
    const since = (performance.now() - fireRef.current) / 1000;
    const recoil = since < 0.12 ? (1 - since / 0.12) : 0;
    const kick = new THREE.Vector3(0, recoil * 0.025, recoil * 0.08).applyQuaternion(camera.quaternion);
    g.position.add(kick);
    g.rotateX(-recoil * 0.35);

    // Muzzle flash visibility
    const flashOn = since < 0.06;
    if (flash.current) (flash.current.material as THREE.MeshBasicMaterial).opacity = flashOn ? 1 : 0;
    if (flashLight.current) flashLight.current.intensity = flashOn ? 4 : 0;
  });
  return (
    <group ref={group}>
      {/* body */}
      <mesh>
        <boxGeometry args={[0.12, 0.14, 0.55]} />
        <meshStandardMaterial color="#0f172a" emissive="#ec4899" emissiveIntensity={0.35} metalness={0.8} roughness={0.25} />
      </mesh>
      {/* barrel */}
      <mesh position={[0, 0.02, -0.4]}>
        <boxGeometry args={[0.05, 0.05, 0.35]} />
        <meshStandardMaterial color="#1a1530" emissive="#22d3ee" emissiveIntensity={0.6} metalness={0.9} roughness={0.2} />
      </mesh>
      {/* sight */}
      <mesh position={[0, 0.1, 0.05]}>
        <boxGeometry args={[0.04, 0.04, 0.12]} />
        <meshStandardMaterial color="#22d3ee" emissive="#22d3ee" emissiveIntensity={2} toneMapped={false} />
      </mesh>
      {/* grip */}
      <mesh position={[0, -0.12, 0.12]} rotation={[0.3, 0, 0]}>
        <boxGeometry args={[0.08, 0.18, 0.1]} />
        <meshStandardMaterial color="#0f172a" metalness={0.6} roughness={0.4} />
      </mesh>
      {/* magazine */}
      <mesh position={[0, -0.14, 0]}>
        <boxGeometry args={[0.08, 0.16, 0.14]} />
        <meshStandardMaterial color="#1a1530" emissive="#ec4899" emissiveIntensity={0.5} />
      </mesh>
      {/* muzzle flash */}
      <mesh ref={flash} position={[0, 0.02, -0.6]}>
        <sphereGeometry args={[0.09, 12, 12]} />
        <meshBasicMaterial color="#fef08a" transparent opacity={0} toneMapped={false} />
      </mesh>
      <pointLight ref={flashLight} position={[0, 0.02, -0.6]} color="#fbbf24" intensity={0} distance={6} />
    </group>
  );
}