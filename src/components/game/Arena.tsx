import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Sky } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

type Bot = {
  id: number;
  pos: THREE.Vector3;
  dir: THREE.Vector3;
  hp: number;
  alive: boolean;
  respawnAt: number;
  name: string;
};

const ARENA = 30;
const NAMES = ["VIPER", "GHOST", "RAVEN", "NOVA", "ECHO", "BLITZ", "ZERO"];

function createBots(n: number): Bot[] {
  return Array.from({ length: n }, (_, i) => ({
    id: i,
    pos: new THREE.Vector3((Math.random() - 0.5) * ARENA, 0.9, (Math.random() - 0.5) * ARENA),
    dir: new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize(),
    hp: 100,
    alive: true,
    respawnAt: 0,
    name: NAMES[i % NAMES.length],
  }));
}

export type GameState = {
  hp: number;
  kills: number;
  deaths: number;
  ammo: number;
};

type Controls = {
  moveX: number; // -1..1
  moveY: number; // -1..1 (forward positive)
  yaw: number;
  pitch: number;
  fire: boolean;
};

export function ArenaScene({
  controls,
  onStateChange,
  onKillFeed,
}: {
  controls: React.MutableRefObject<Controls>;
  onStateChange: (s: GameState) => void;
  onKillFeed: (msg: string) => void;
}) {
  return (
    <Canvas shadows camera={{ fov: 75, near: 0.05, far: 200 }}>
      <Sky sunPosition={[100, 20, 100]} turbidity={6} rayleigh={2} />
      <ambientLight intensity={0.45} />
      <directionalLight position={[20, 30, 10]} intensity={1.1} castShadow />
      <ArenaWorld />
      <Game controls={controls} onStateChange={onStateChange} onKillFeed={onKillFeed} />
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
}: {
  controls: React.MutableRefObject<Controls>;
  onStateChange: (s: GameState) => void;
  onKillFeed: (msg: string) => void;
}) {
  const { camera, scene } = useThree();
  const player = useRef({ pos: new THREE.Vector3(0, 1.6, 8), hp: 100, kills: 0, deaths: 0, ammo: 30 });
  const [bots, setBots] = useState<Bot[]>(() => createBots(5));
  const botsRef = useRef(bots);
  botsRef.current = bots;
  const lastFire = useRef(0);
  const lastBotShot = useRef<Record<number, number>>({});
  const muzzleFlash = useRef<{ t: number }>({ t: 0 });

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

    // Fire
    if (c.fire && now - lastFire.current > 180 && player.current.ammo > 0 && player.current.hp > 0) {
      lastFire.current = now;
      player.current.ammo -= 1;
      muzzleFlash.current.t = now;
      // hitscan
      const origin = camera.position.clone();
      const dir = new THREE.Vector3();
      camera.getWorldDirection(dir);
      const ray = new THREE.Raycaster(origin, dir, 0.1, 80);
      let best: { bot: Bot; dist: number } | null = null;
      for (const b of botsRef.current) {
        if (!b.alive) continue;
        const sphere = new THREE.Sphere(b.pos.clone().setY(1.1), 0.7);
        const hit = ray.ray.intersectSphere(sphere, new THREE.Vector3());
        if (hit) {
          const dist = hit.distanceTo(origin);
          if (!best || dist < best.dist) best = { bot: b, dist };
        }
      }
      if (best) {
        best.bot.hp -= 34;
        if (best.bot.hp <= 0) {
          best.bot.alive = false;
          best.bot.respawnAt = now + 3000;
          player.current.kills += 1;
          onKillFeed(`You eliminated ${best.bot.name}`);
        }
        setBots([...botsRef.current]);
      }
    }

    // Bot AI
    let updated = false;
    for (const b of botsRef.current) {
      if (!b.alive) {
        if (now >= b.respawnAt) {
          b.alive = true;
          b.hp = 100;
          b.pos.set((Math.random() - 0.5) * ARENA, 0.9, (Math.random() - 0.5) * ARENA);
          updated = true;
        }
        continue;
      }
      // wander + chase player
      const toPlayer = player.current.pos.clone().setY(0.9).sub(b.pos);
      const distP = toPlayer.length();
      if (distP < 18) b.dir.copy(toPlayer.normalize());
      else if (Math.random() < 0.01)
        b.dir.set(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
      b.pos.addScaledVector(b.dir, 2.5 * dt);
      b.pos.x = THREE.MathUtils.clamp(b.pos.x, -ARENA + 1, ARENA - 1);
      b.pos.z = THREE.MathUtils.clamp(b.pos.z, -ARENA + 1, ARENA - 1);

      // shoot
      const last = lastBotShot.current[b.id] ?? 0;
      if (distP < 14 && now - last > 1200 && player.current.hp > 0) {
        lastBotShot.current[b.id] = now;
        // hit chance falls with distance
        if (Math.random() < Math.max(0.15, 0.7 - distP / 25)) {
          player.current.hp -= 12;
          if (player.current.hp <= 0) {
            player.current.hp = 100;
            player.current.deaths += 1;
            player.current.pos.set(
              (Math.random() - 0.5) * ARENA,
              1.6,
              (Math.random() - 0.5) * ARENA,
            );
            onKillFeed(`${b.name} eliminated you`);
          }
        }
      }
    }
    if (updated) setBots([...botsRef.current]);

    // ammo regen
    if (player.current.ammo < 30 && Math.floor(now / 600) % 2 === 0) {
      player.current.ammo = Math.min(30, player.current.ammo + (dt * 4));
    }

    onStateChange({
      hp: Math.max(0, Math.round(player.current.hp)),
      kills: player.current.kills,
      deaths: player.current.deaths,
      ammo: Math.floor(player.current.ammo),
    });
  });

  return (
    <group>
      {bots.map((b) =>
        b.alive ? (
          <group key={b.id} position={[b.pos.x, b.pos.y, b.pos.z]}>
            <mesh castShadow position={[0, 0.2, 0]}>
              <capsuleGeometry args={[0.4, 0.9, 4, 8]} />
              <meshStandardMaterial color="#ec4899" emissive="#ec4899" emissiveIntensity={0.6} />
            </mesh>
            <mesh position={[0, 1.1, 0]}>
              <sphereGeometry args={[0.3, 12, 12]} />
              <meshStandardMaterial color="#22d3ee" emissive="#22d3ee" emissiveIntensity={0.8} />
            </mesh>
          </group>
        ) : null,
      )}
    </group>
  );
}