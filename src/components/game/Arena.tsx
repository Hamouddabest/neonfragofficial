import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Sky, Text, Billboard } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

const ARENA = 30;

export type GameState = {
  hp: number;
  kills: number;
  deaths: number;
  ammo: number;
};

export type Controls = {
  moveX: number; // -1..1
  moveY: number; // -1..1 (forward positive)
  yaw: number;
  pitch: number;
  fire: boolean;
  reload: boolean;
};

export type RemotePlayer = {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  alive: boolean;
};

export type PlayerPose = {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  alive: boolean;
};

export type ShotEvent = {
  ox: number; oy: number; oz: number;
  dx: number; dy: number; dz: number;
  shooterId: string;
  shooterName: string;
};

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
}: {
  controls: React.MutableRefObject<Controls>;
  onStateChange: (s: GameState) => void;
  onKillFeed: (msg: string) => void;
  remotePlayersRef: React.MutableRefObject<Map<string, RemotePlayer>>;
  remoteIds: string[];
  onPose: (p: PlayerPose) => void;
  onShoot: (s: ShotEvent, hitId: string | null) => void;
  incomingHitRef: React.MutableRefObject<number>;
  onLocalDeath: (killerName: string) => void;
  onFireSound?: () => void;
  onReloadSound?: () => void;
}) {
  const fireRef = useRef(0);
  return (
    <Canvas shadows camera={{ fov: 75, near: 0.05, far: 200 }}>
      <Sky sunPosition={[100, 20, 100]} turbidity={6} rayleigh={2} />
      <ambientLight intensity={0.45} />
      <directionalLight position={[20, 30, 10]} intensity={1.1} castShadow />
      <ArenaWorld />
      {remoteIds.map((id) => (
        <RemotePlayerView key={id} id={id} remotePlayersRef={remotePlayersRef} />
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
      />
      <ViewmodelGun controls={controls} fireRef={fireRef} />
    </Canvas>
  );
}

function RemotePlayerView({
  id,
  remotePlayersRef,
}: {
  id: string;
  remotePlayersRef: React.MutableRefObject<Map<string, RemotePlayer>>;
}) {
  const ref = useRef<THREE.Group>(null);
  const legL = useRef<THREE.Mesh>(null);
  const legR = useRef<THREE.Mesh>(null);
  const armL = useRef<THREE.Mesh>(null);
  const armR = useRef<THREE.Mesh>(null);
  const prev = useRef({ x: 0, z: 0, phase: 0 });
  const [name, setName] = useState<string>(() => remotePlayersRef.current.get(id)?.name ?? "Rival");
  const color = useMemo(() => {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
    return `hsl(${h}, 90%, 60%)`;
  }, [id]);
  useFrame((_, dt) => {
    const r = remotePlayersRef.current.get(id);
    if (!r || !ref.current) return;
    ref.current.position.set(r.x, r.y - 0.9, r.z);
    ref.current.rotation.y = r.yaw;
    ref.current.visible = r.alive;
    if (r.name && r.name !== name) setName(r.name);
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
        <Text
          fontSize={0.35}
          color="#22d3ee"
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

function ArenaWorld() {
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
      <gridHelper args={[ARENA * 2, 40, "#22d3ee", "#3b1d6b"]} position={[0, 0.01, 0]} />
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
}: {
  controls: React.MutableRefObject<Controls>;
  onStateChange: (s: GameState) => void;
  onKillFeed: (msg: string) => void;
  remotePlayersRef: React.MutableRefObject<Map<string, RemotePlayer>>;
  onPose: (p: PlayerPose) => void;
  onShoot: (s: ShotEvent, hitId: string | null) => void;
  incomingHitRef: React.MutableRefObject<number>;
  onLocalDeath: (killerName: string) => void;
  fireRef: React.MutableRefObject<number>;
  onFireSound?: () => void;
  onReloadSound?: () => void;
}) {
  const { camera } = useThree();
  const player = useRef({ pos: new THREE.Vector3(0, 1.6, 8), hp: 100, kills: 0, deaths: 0, ammo: 30 });
  const lastFire = useRef(0);
  const muzzleFlash = useRef<{ t: number }>({ t: 0 });
  const lastPose = useRef(0);
  const remoteGroup = useRef<THREE.Group>(null);
  const reloadEnd = useRef(0);

  useEffect(() => {
    camera.position.copy(player.current.pos);
  }, [camera]);

  useFrame((_, dt) => {
    const c = controls.current;
    const now = performance.now();
    // camera rotation
    const euler = new THREE.Euler(c.pitch, c.yaw, 0, "YXZ");
    camera.quaternion.setFromEuler(euler);

    // movement relative to yaw
    const speed = 6;
    const forward = new THREE.Vector3(-Math.sin(c.yaw), 0, -Math.cos(c.yaw));
    const right = new THREE.Vector3(Math.cos(c.yaw), 0, -Math.sin(c.yaw));
    const move = new THREE.Vector3()
      .addScaledVector(forward, c.moveY * speed * dt)
      .addScaledVector(right, c.moveX * speed * dt);
    player.current.pos.add(move);
    player.current.pos.x = THREE.MathUtils.clamp(player.current.pos.x, -ARENA + 1, ARENA - 1);
    player.current.pos.z = THREE.MathUtils.clamp(player.current.pos.z, -ARENA + 1, ARENA - 1);
    camera.position.copy(player.current.pos);

    // Apply incoming damage from network
    if (incomingHitRef.current > 0 && player.current.hp > 0) {
      player.current.hp -= incomingHitRef.current;
      incomingHitRef.current = 0;
      if (player.current.hp <= 0) {
        player.current.hp = 100;
        player.current.deaths += 1;
        player.current.pos.set(
          (Math.random() - 0.5) * ARENA,
          1.6,
          (Math.random() - 0.5) * ARENA,
        );
        onLocalDeath("");
      }
    }

    // Reload trigger
    if (c.reload && reloadEnd.current === 0 && player.current.ammo < 30 && player.current.hp > 0) {
      reloadEnd.current = now + 1500;
      onReloadSound?.();
    }
    if (reloadEnd.current > 0 && now >= reloadEnd.current) {
      player.current.ammo = 30;
      reloadEnd.current = 0;
    }
    // Auto-reload when empty
    if (player.current.ammo <= 0 && reloadEnd.current === 0 && player.current.hp > 0) {
      reloadEnd.current = now + 1500;
      onReloadSound?.();
    }

    const reloading = reloadEnd.current > 0;
    // Fire
    if (c.fire && !reloading && now - lastFire.current > 180 && player.current.ammo > 0 && player.current.hp > 0) {
      lastFire.current = now;
      player.current.ammo -= 1;
      muzzleFlash.current.t = now;
      fireRef.current = now;
      onFireSound?.();
      // hitscan vs remote players
      const origin = camera.position.clone();
      const dir = new THREE.Vector3();
      camera.getWorldDirection(dir);
      const ray = new THREE.Raycaster(origin, dir, 0.1, 80);
      let best: { id: string; dist: number } | null = null;
      for (const r of remotePlayersRef.current.values()) {
        if (!r.alive) continue;
        const sphere = new THREE.Sphere(new THREE.Vector3(r.x, 1.1, r.z), 0.7);
        const hit = ray.ray.intersectSphere(sphere, new THREE.Vector3());
        if (hit) {
          const dist = hit.distanceTo(origin);
          if (!best || dist < best.dist) best = { id: r.id, dist };
        }
      }
      onShoot(
        {
          ox: origin.x, oy: origin.y, oz: origin.z,
          dx: dir.x, dy: dir.y, dz: dir.z,
          shooterId: "", shooterName: "",
        },
        best?.id ?? null,
      );
      if (best) {
        player.current.kills += 1;
        const r = remotePlayersRef.current.get(best.id);
        if (r) onKillFeed(`You eliminated ${r.name}`);
      }
    }

    // Broadcast pose ~15Hz
    if (now - lastPose.current > 66) {
      lastPose.current = now;
      onPose({
        x: player.current.pos.x,
        y: player.current.pos.y,
        z: player.current.pos.z,
        yaw: c.yaw,
        pitch: c.pitch,
        alive: player.current.hp > 0,
      });
    }

    onStateChange({
      hp: Math.max(0, Math.round(player.current.hp)),
      kills: player.current.kills,
      deaths: player.current.deaths,
      ammo: Math.floor(player.current.ammo),
    });
  });

  return <group ref={remoteGroup} />;
}

function ViewmodelGun({
  controls,
  fireRef,
}: {
  controls: React.MutableRefObject<Controls>;
  fireRef: React.MutableRefObject<number>;
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
    const moving = Math.hypot(controls.current.moveX, controls.current.moveY);
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