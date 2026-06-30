import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Canvas, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useState } from "react";
import { Box, Square, Circle, ArrowUpRight, MapPin, Trash2, Check, Copy, X, RotateCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { ArenaBlockMesh, type ArenaBlock, type SpawnPoint } from "@/components/game/Arena";

type Tool = "cube" | "plate" | "cylinder" | "stairs" | "spawn" | "delete";
type Kind = Exclude<Tool, "delete" | "spawn">;

const SIZE = 30;
const CELL = 2;
const snap = (v: number) => Math.round(v / CELL) * CELL;

export const Route = createFileRoute("/_authenticated/build/$roomId")({
  head: () => ({ meta: [{ title: "Builder — NEONFRAG" }] }),
  ssr: false,
  component: Builder,
});

function Builder() {
  const { roomId } = Route.useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [tool, setTool] = useState<Tool>("cube");
  const [rot, setRot] = useState(0);
  const [blocks, setBlocks] = useState<ArenaBlock[]>([]);
  const [spawns, setSpawns] = useState<SpawnPoint[]>([]);
  const [saving, setSaving] = useState(false);

  function place(x: number, z: number) {
    const sx = snap(x), sz = snap(z);
    if (Math.abs(sx) > SIZE - 1 || Math.abs(sz) > SIZE - 1) return;
    if (tool === "delete") {
      setBlocks((b) => b.filter((bl) => !(bl.x === sx && bl.z === sz)));
      setSpawns((s) => s.filter((sp) => !(sp.x === sx && sp.z === sz)));
      return;
    }
    if (tool === "spawn") {
      setSpawns((s) => [...s.filter((sp) => !(sp.x === sx && sp.z === sz)), { id: crypto.randomUUID(), x: sx, z: sz }]);
      return;
    }
    const kind: Kind = tool;
    setBlocks((b) => {
      const filtered = b.filter((bl) => !(bl.x === sx && bl.z === sz));
      return [...filtered, { id: crypto.randomUUID(), kind, x: sx, z: sz, rot } as ArenaBlock];
    });
  }

  async function confirm() {
    if (!user) {
      toast.error("Sign up to save custom arenas");
      return;
    }
    if (spawns.length === 0) { toast.error("Place at least one spawn point"); return; }
    setSaving(true);
    const { error } = await supabase
      .from("custom_arenas")
      .upsert({
        room_id: roomId,
        owner_id: user.id,
        blocks: JSON.parse(JSON.stringify(blocks)),
        spawn_points: JSON.parse(JSON.stringify(spawns)),
        confirmed: true,
      });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Arena ready — dropping in");
    navigate({ to: "/game/$roomId", params: { roomId } });
  }

  function copyId() {
    navigator.clipboard.writeText(roomId).then(() => toast.success("Room ID copied — share it!"));
  }

  const tools: { id: Tool; label: string; Icon: typeof Box }[] = [
    { id: "cube", label: "Cube", Icon: Box },
    { id: "plate", label: "Plate", Icon: Square },
    { id: "cylinder", label: "Pillar", Icon: Circle },
    { id: "stairs", label: "Stairs", Icon: ArrowUpRight },
    { id: "spawn", label: "Spawn", Icon: MapPin },
    { id: "delete", label: "Delete", Icon: Trash2 },
  ];

  return (
    <div className="fixed inset-0 bg-black select-none touch-none">
      <Canvas shadows camera={{ position: [0, 28, 30], fov: 55 }}>
        <ambientLight intensity={0.55} />
        <directionalLight position={[15, 25, 10]} intensity={1.1} castShadow />
        <OrbitControls makeDefault enablePan={false} maxPolarAngle={Math.PI / 2.15} minDistance={10} maxDistance={70} />
        <Ground onPlace={place} />
        {blocks.map((b) => <ArenaBlockMesh key={b.id} block={b} />)}
        {spawns.map((s) => (
          <group key={s.id} position={[s.x, 0.05, s.z]}>
            <mesh rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[0.8, 1, 32]} />
              <meshBasicMaterial color="#22d3ee" toneMapped={false} />
            </mesh>
            <pointLight color="#22d3ee" intensity={1.5} distance={4} position={[0, 1, 0]} />
          </group>
        ))}
      </Canvas>

      {/* Top bar */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3">
        <div className="pointer-events-auto flex items-center gap-2">
          <Link to="/play" className="grid size-10 place-items-center rounded-md bg-black/70 text-primary backdrop-blur" aria-label="Leave">
            <X className="size-5" />
          </Link>
          <button onClick={copyId} className="flex items-center gap-2 rounded-md bg-black/70 px-3 py-2 backdrop-blur">
            <Copy className="size-4 text-accent" />
            <span className="font-display text-xs uppercase tracking-widest text-primary">ID {roomId}</span>
          </button>
        </div>
        <button
          onClick={confirm}
          disabled={saving}
          className="pointer-events-auto grid size-14 place-items-center rounded-full border-2 border-accent bg-accent text-accent-foreground shadow-[0_0_24px_var(--accent)] disabled:opacity-60"
          aria-label="Confirm arena"
        >
          <Check className="size-8" strokeWidth={3} />
        </button>
      </div>

      <div className="pointer-events-none absolute left-3 top-16 max-w-[60%] rounded bg-black/60 px-2 py-1 text-[11px] text-muted-foreground backdrop-blur">
        Tap the ground to place · Drag to orbit · Place at least 1 spawn
      </div>

      {/* Toolbar */}
      <div className="absolute inset-x-2 bottom-2 flex flex-wrap items-center justify-center gap-1.5 rounded-md bg-black/75 p-2 backdrop-blur">
        {tools.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => setTool(id)}
            className={`flex min-w-[60px] flex-col items-center gap-0.5 rounded-md border px-2 py-1.5 text-[10px] font-display uppercase tracking-widest ${
              tool === id
                ? "border-primary bg-primary/20 text-primary shadow-[0_0_12px_var(--primary)]"
                : "border-border bg-black/40 text-muted-foreground"
            }`}
          >
            <Icon className="size-5" />
            {label}
          </button>
        ))}
        {tool === "stairs" && (
          <button
            onClick={() => setRot((r) => (r + Math.PI / 2) % (Math.PI * 2))}
            className="flex min-w-[60px] flex-col items-center gap-0.5 rounded-md border border-accent/60 bg-accent/15 px-2 py-1.5 text-[10px] font-display uppercase tracking-widest text-accent"
          >
            <RotateCw className="size-5" />
            Rotate
          </button>
        )}
      </div>
    </div>
  );
}

function Ground({ onPlace }: { onPlace: (x: number, z: number) => void }) {
  return (
    <>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        onPointerDown={(e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          onPlace(e.point.x, e.point.z);
        }}
        receiveShadow
      >
        <planeGeometry args={[SIZE * 2, SIZE * 2]} />
        <meshStandardMaterial color="#1a1530" />
      </mesh>
      <gridHelper args={[SIZE * 2, SIZE, "#22d3ee", "#3b1d6b"]} position={[0, 0.01, 0]} />
    </>
  );
}