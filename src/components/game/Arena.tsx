import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Sky } from "@react-three/drei";
import { useEffect, useMemo, useRef } from "react";
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
  onPose,
  onShoot,
  incomingHitRef,
  onLocalDeath,
}: {
  controls: React.MutableRefObject<Controls>;
  onStateChange: (s: GameState) => void;
  onKillFeed: (msg: string) => void;
  remotePlayersRef: React.MutableRefObject<Map<string, RemotePlayer>>;
  onPose: (p: PlayerPose) => void;
  onShoot: (s: ShotEvent, hitId: string | null) => void;
  incomingHitRef: React.MutableRefObject<number>;
  onLocalDeath: (killerName: string) => void;
}) {
  return (
    <Canvas shadows camera={{ fov: 75, near: 0.05, far: 200 }}>
      <Sky sunPosition={[100, 20, 100]} turbidity={6} rayleigh={2} />
      <ambientLight intensity={0.45} />
      <directionalLight position={[20, 30, 10]} intensity={1.1} castShadow />
      <ArenaWorld />
      <Game
        controls={controls}
        onStateChange={onStateChange}
        onKillFeed={onKillFeed}
        remotePlayersRef={remotePlayersRef}
        onPose={onPose}
        onShoot={onShoot}
        incomingHitRef={incomingHitRef}
        onLocalDeath={onLocalDeath}
      />
    </Canvas>
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
}: {
  controls: React.MutableRefObject<Controls>;
  onStateChange: (s: GameState) => void;
  onKillFeed: (msg: string) => void;
  remotePlayersRef: React.MutableRefObject<Map<string, RemotePlayer>>;
  onPose: (p: PlayerPose) => void;
  onShoot: (s: ShotEvent, hitId: string | null) => void;
  incomingHitRef: React.MutableRefObject<number>;
  onLocalDeath: (killerName: string) => void;
}) {
  const { camera } = useThree();
  const player = useRef({ pos: new THREE.Vector3(0, 1.6, 8), hp: 100, kills: 0, deaths: 0, ammo: 30 });
  const lastFire = useRef(0);
  const muzzleFlash = useRef<{ t: number }>({ t: 0 });
  const lastPose = useRef(0);
  const remoteGroup = useRef<THREE.Group>(null);

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

    // Fire
    if (c.fire && now - lastFire.current > 180 && player.current.ammo > 0 && player.current.hp > 0) {
      lastFire.current = now;
      player.current.ammo -= 1;
      muzzleFlash.current.t = now;
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

    // ammo regen
    if (player.current.ammo < 30 && Math.floor(now / 600) % 2 === 0) {
      player.current.ammo = Math.min(30, player.current.ammo + (dt * 4));
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

    // Update remote meshes
    if (remoteGroup.current) {
      const g = remoteGroup.current;
      const seen = new Set<string>();
      for (const r of remotePlayersRef.current.values()) {
        seen.add(r.id);
        let child = g.getObjectByName(r.id) as THREE.Group | undefined;
        if (!child) {
          child = new THREE.Group();
          child.name = r.id;
          const body = new THREE.Mesh(
            new THREE.CapsuleGeometry(0.4, 0.9, 4, 8),
            new THREE.MeshStandardMaterial({ color: "#ec4899", emissive: "#ec4899", emissiveIntensity: 0.6 }),
          );
          body.position.y = 0.2;
          const head = new THREE.Mesh(
            new THREE.SphereGeometry(0.3, 12, 12),
            new THREE.MeshStandardMaterial({ color: "#22d3ee", emissive: "#22d3ee", emissiveIntensity: 0.8 }),
          );
          head.position.y = 1.1;
          child.add(body, head);
          g.add(child);
        }
        child.position.set(r.x, r.y - 0.9, r.z);
        child.rotation.y = r.yaw;
        child.visible = r.alive;
      }
      // remove stale
      for (const obj of [...g.children]) {
        if (!seen.has(obj.name)) g.remove(obj);
      }
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