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
  const { camera } = useThree();
  const player = useRef({ pos: new THREE.Vector3(0, 1.6, 8), hp: 100, kills: 0, deaths: 0, ammo: 30 });
  const lastFire = useRef(0);
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
    }

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

  return null;
}