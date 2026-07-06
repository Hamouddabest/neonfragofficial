import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useIsOwner } from "@/hooks/use-is-owner";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Hammer, Pencil, Play, Star, Trash2, Globe, Plus } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/my-maps")({
  head: () => ({ meta: [{ title: "My Maps — NEONFRAG" }] }),
  ssr: false,
  component: MyMaps,
});

function generateRoomCode() {
  return Array.from({ length: 6 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]).join("");
}

function MyMaps() {
  const { user } = useAuth();
  const { isOwner } = useIsOwner();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: maps, isLoading } = useQuery({
    queryKey: ["my-maps", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("custom_arenas")
        .select("room_id, name, is_official, published, updated_at, blocks, spawn_points")
        .eq("owner_id", user!.id)
        .order("updated_at", { ascending: false });
      return data ?? [];
    },
  });

  async function deleteMap(roomId: string) {
    if (!confirm("Delete this map? This can't be undone.")) return;
    const { error } = await supabase.from("custom_arenas").delete().eq("room_id", roomId);
    if (error) return toast.error(error.message);
    toast.success("Map deleted");
    qc.invalidateQueries({ queryKey: ["my-maps"] });
    qc.invalidateQueries({ queryKey: ["official-maps"] });
  }

  function newMap() {
    const code = generateRoomCode();
    navigate({ to: "/build/$roomId", params: { roomId: code } });
  }

  const count = maps?.length ?? 0;

  return (
    <main className="relative min-h-dvh px-6 py-10">
      <div className="absolute inset-0 scanlines pointer-events-none opacity-40" />
      <div className="relative z-10 mx-auto max-w-4xl">
        <header className="mb-8 flex items-center justify-between">
          <Button asChild variant="ghost" size="sm">
            <Link to="/play"><ArrowLeft className="mr-2 size-4" /> Lobby</Link>
          </Button>
          <div className="flex gap-2">
            {isOwner && (
              <Button onClick={newMap} className="bg-accent text-accent-foreground hover:bg-accent/90 shadow-[0_0_16px_var(--accent)]">
                <Star className="mr-2 size-4" /> New official map
              </Button>
            )}
            <Button onClick={newMap}>
              <Plus className="mr-2 size-4" /> New map
            </Button>
          </div>
        </header>

        <div className="mb-8">
          <h1 className="font-display text-4xl font-black uppercase tracking-tight md:text-5xl">
            My <span className="text-primary neon-text">Maps</span>
          </h1>
          <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
            <Hammer className="size-4 text-primary" />
            You've built <span className="font-display text-primary">{count}</span> {count === 1 ? "map" : "maps"}
          </p>
        </div>

        {isLoading && <div className="text-muted-foreground">Loading…</div>}
        {!isLoading && count === 0 && (
          <div className="rounded-xl border border-dashed border-border p-10 text-center">
            <Hammer className="mx-auto mb-3 size-8 text-muted-foreground" />
            <p className="text-muted-foreground">No maps yet. Build your first arena.</p>
            <Button onClick={newMap} className="mt-5"><Plus className="mr-2 size-4" /> New map</Button>
          </div>
        )}

        <div className="grid gap-3 md:grid-cols-2">
          {maps?.map((m) => {
            const blockCount = Array.isArray(m.blocks) ? m.blocks.length : 0;
            const spawnCount = Array.isArray(m.spawn_points) ? m.spawn_points.length : 0;
            return (
              <div key={m.room_id} className="rounded-xl border border-border bg-card/70 p-5 backdrop-blur">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate font-display text-lg font-bold uppercase tracking-wider">
                        {m.name || m.room_id}
                      </h3>
                      {m.is_official && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-accent/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-accent">
                          <Star className="size-3" /> Official
                        </span>
                      )}
                      {m.published && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-primary/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-primary">
                          <Globe className="size-3" /> Live
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      ID {m.room_id} · {blockCount} blocks · {spawnCount} spawns
                    </div>
                  </div>
                </div>
                <div className="mt-4 flex gap-2">
                  <Button asChild size="sm" variant="outline" className="flex-1">
                    <Link to="/build/$roomId" params={{ roomId: m.room_id }}>
                      <Pencil className="mr-1 size-4" /> Edit
                    </Link>
                  </Button>
                  <Button asChild size="sm" className="flex-1">
                    <Link to="/game/$roomId" params={{ roomId: m.room_id }}>
                      <Play className="mr-1 size-4" /> Play
                    </Link>
                  </Button>
                  <Button onClick={() => deleteMap(m.room_id)} size="sm" variant="ghost" className="text-destructive">
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </main>
  );
}
