import { createFileRoute, Link } from "@tanstack/react-router";
import { Canvas } from "@react-three/fiber";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Coins, Gift, Hammer, Shirt, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useSkin } from "@/hooks/use-skin";
import { BlockyBody } from "@/components/game/Arena";
import {
  CUSTOM_CRAFT_COST,
  DEFAULT_SKIN,
  HAT_SHAPES,
  RARITY_STYLE,
  SKIN_TONES,
  sanitizeSkin,
  type HatShape,
  type PlayerSkin,
} from "@/lib/cosmetics";

export const Route = createFileRoute("/_authenticated/locker")({
  head: () => ({
    meta: [
      { title: "Locker — Skins, Cosmetics & Coins | NEONFRAG" },
      { name: "description", content: "Design your fighter, buy hats, shirts and pants with coins, craft custom cosmetics and claim daily rewards." },
      { property: "og:title", content: "NEONFRAG Locker" },
      { property: "og:description", content: "Skin editor, cosmetic shop and daily coin rewards." },
    ],
  }),
  component: Locker,
});

type CatalogItem = {
  id: string;
  name: string;
  slot: string;
  rarity: string;
  price: number;
  config: { shape?: HatShape; color?: string };
};

type CustomItem = { id: string; name: string; slot: string; config: { shape?: HatShape; color?: string } };

function Preview({ skin }: { skin: PlayerSkin }) {
  return (
    <Canvas camera={{ position: [0, 1.4, 3.6], fov: 40 }} dpr={[1, 2]}>
      <ambientLight intensity={0.9} />
      <directionalLight position={[3, 6, 4]} intensity={1.4} />
      <pointLight position={[-3, 2, 3]} intensity={20} color="#22d3ee" />
      <group position={[0, -0.85, 0]} rotation={[0, 0.5, 0]}>
        <BlockyBody color={skin.shirt} cosmetics={skin} showGun={false} />
      </group>
    </Canvas>
  );
}

function Swatches({ value, onChange, colors }: { value: string; onChange: (c: string) => void; colors: string[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {colors.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          style={{ background: c }}
          className={`size-8 rounded-md border-2 transition ${value === c ? "border-primary scale-110" : "border-border/50"}`}
          aria-label={c}
        />
      ))}
    </div>
  );
}

const PALETTE = [
  "#22d3ee", "#06b6d4", "#3b82f6", "#7c3aed", "#a855f7", "#ec4899", "#f43f5e",
  "#ef4444", "#f97316", "#facc15", "#84cc16", "#22c55e", "#14b8a6", "#ffffff",
  "#94a3b8", "#111827",
];

function Locker() {
  const { user } = useAuth();
  const { skin, setSkin, ready } = useSkin();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<PlayerSkin>(DEFAULT_SKIN);
  const [dirty, setDirty] = useState(false);
  const [customName, setCustomName] = useState("");
  const [customSlot, setCustomSlot] = useState<"hat" | "shirt" | "pants">("hat");
  const [customColor, setCustomColor] = useState("#22d3ee");
  const [customShape, setCustomShape] = useState<HatShape>("crown");

  useEffect(() => {
    if (ready && !dirty) setDraft(skin);
  }, [ready, skin, dirty]);

  const { data: wallet } = useQuery({
    queryKey: ["wallet", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase.rpc("ensure_wallet");
      return (data ?? null) as { coins: number; streak: number; last_daily: string | null } | null;
    },
  });

  const { data: catalog } = useQuery({
    queryKey: ["cosmetic-catalog"],
    queryFn: async () => {
      const { data } = await supabase.from("cosmetic_catalog").select("*").order("sort_order");
      return (data ?? []) as unknown as CatalogItem[];
    },
  });

  const { data: owned } = useQuery({
    queryKey: ["owned-cosmetics", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase.from("player_cosmetics").select("item_id");
      return new Set((data ?? []).map((r) => r.item_id));
    },
  });

  const { data: customs } = useQuery({
    queryKey: ["custom-cosmetics", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase.from("custom_cosmetics").select("id, name, slot, config").order("created_at", { ascending: false });
      return (data ?? []) as unknown as CustomItem[];
    },
  });

  const coins = wallet?.coins ?? 0;
  const claimedToday = wallet?.last_daily === new Date().toISOString().slice(0, 10);

  const grouped = useMemo(() => {
    const g: Record<string, CatalogItem[]> = { hat: [], shirt: [], pants: [] };
    for (const it of catalog ?? []) (g[it.slot] ??= []).push(it);
    return g;
  }, [catalog]);

  function apply(next: Partial<PlayerSkin>) {
    setDraft((d) => sanitizeSkin({ ...d, ...next }));
    setDirty(true);
  }

  async function claimDaily() {
    const { data, error } = await supabase.rpc("claim_daily_reward");
    if (error) return toast.error("Couldn't claim your reward");
    const res = data as unknown as { claimed: boolean; reward: number; streak: number };
    if (!res.claimed) toast.info("You already claimed today — come back tomorrow!");
    else toast.success(`+${res.reward} coins · day ${res.streak} streak`);
    qc.invalidateQueries({ queryKey: ["wallet"] });
  }

  async function buy(item: CatalogItem) {
    const { data, error } = await supabase.rpc("purchase_cosmetic", { _item_id: item.id });
    if (error) return toast.error("Purchase failed");
    const res = data as unknown as { ok: boolean; error?: string };
    if (!res.ok) return toast.error(res.error === "not enough coins" ? "Not enough coins" : "Already owned");
    toast.success(`${item.name} unlocked!`);
    qc.invalidateQueries({ queryKey: ["wallet"] });
    qc.invalidateQueries({ queryKey: ["owned-cosmetics"] });
  }

  async function craft() {
    const config = customSlot === "hat" ? { shape: customShape, color: customColor } : { color: customColor };
    const { data, error } = await supabase.rpc("craft_custom_cosmetic", {
      _name: customName || "Custom",
      _slot: customSlot,
      _config: config as unknown as never,
    });
    if (error) return toast.error("Couldn't create that item");
    const res = data as unknown as { ok: boolean; error?: string };
    if (!res.ok) return toast.error(res.error === "not enough coins" ? "Not enough coins" : "Couldn't create that item");
    toast.success("Custom cosmetic created!");
    setCustomName("");
    qc.invalidateQueries({ queryKey: ["wallet"] });
    qc.invalidateQueries({ queryKey: ["custom-cosmetics"] });
  }

  function equipItem(slot: string, config: { shape?: HatShape; color?: string }) {
    if (slot === "hat") apply({ hat: { shape: config.shape ?? "cap", color: config.color ?? "#ffffff" } });
    else if (slot === "shirt") apply({ shirt: config.color ?? DEFAULT_SKIN.shirt });
    else apply({ pants: config.color ?? DEFAULT_SKIN.pants });
  }

  return (
    <main className="min-h-dvh bg-background">
      <header className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
        <Button asChild variant="ghost" size="sm">
          <Link to="/play"><ArrowLeft className="mr-1 size-4" /> Lobby</Link>
        </Button>
        <h1 className="font-display text-xl font-black uppercase tracking-widest text-primary">Locker</h1>
        <div className="flex items-center gap-2 rounded-full border border-amber-400/50 bg-amber-400/10 px-3 py-1 text-sm font-bold text-amber-300">
          <Coins className="size-4" /> {coins}
        </div>
      </header>

      <div className="mx-auto grid max-w-5xl gap-4 p-4 md:grid-cols-[320px_1fr]">
        <div className="space-y-3">
          <div className="h-[300px] overflow-hidden rounded-xl border border-border/60 bg-gradient-to-b from-primary/10 to-background">
            <Preview skin={draft} />
          </div>
          <div className="flex gap-2">
            <Button
              className="flex-1"
              disabled={!dirty}
              onClick={async () => {
                await setSkin(draft);
                setDirty(false);
                toast.success("Look saved");
              }}
            >
              Save look
            </Button>
            <Button variant="outline" onClick={() => { setDraft(DEFAULT_SKIN); setDirty(true); }}>Reset</Button>
          </div>
          <Button variant="secondary" className="w-full" onClick={claimDaily} disabled={claimedToday}>
            <Gift className="mr-2 size-4" />
            {claimedToday ? "Daily reward claimed" : "Claim daily reward"}
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            Earn 10 coins per kill while you play, plus a daily bonus that grows with your streak.
          </p>
        </div>

        <Tabs defaultValue="editor">
          <TabsList className="w-full">
            <TabsTrigger value="editor" className="flex-1"><Shirt className="mr-1 size-4" /> Editor</TabsTrigger>
            <TabsTrigger value="shop" className="flex-1"><Sparkles className="mr-1 size-4" /> Shop</TabsTrigger>
            <TabsTrigger value="custom" className="flex-1"><Hammer className="mr-1 size-4" /> Custom</TabsTrigger>
          </TabsList>

          <TabsContent value="editor" className="space-y-5 pt-4">
            <section className="space-y-2">
              <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Skin tone</h2>
              <Swatches value={draft.tone} colors={SKIN_TONES} onChange={(c) => apply({ tone: c })} />
            </section>
            <section className="space-y-2">
              <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Shirt color</h2>
              <Swatches value={draft.shirt} colors={PALETTE} onChange={(c) => apply({ shirt: c })} />
            </section>
            <section className="space-y-2">
              <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Pants color</h2>
              <Swatches value={draft.pants} colors={PALETTE} onChange={(c) => apply({ pants: c })} />
            </section>
            <section className="space-y-2">
              <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Hat</h2>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant={draft.hat ? "outline" : "default"} onClick={() => apply({ hat: null })}>None</Button>
                {HAT_SHAPES.filter((sh) => (owned ? [...owned].some((id) => (catalog ?? []).find((c) => c.id === id)?.config?.shape === sh) : false)).map((sh) => (
                  <Button
                    key={sh}
                    size="sm"
                    variant={draft.hat?.shape === sh ? "default" : "outline"}
                    onClick={() => apply({ hat: { shape: sh, color: draft.hat?.color ?? "#ffffff" } })}
                  >
                    {sh}
                  </Button>
                ))}
              </div>
              {draft.hat && (
                <div className="pt-2">
                  <p className="mb-2 text-xs text-muted-foreground">Hat color</p>
                  <Swatches value={draft.hat.color} colors={PALETTE} onChange={(c) => apply({ hat: { shape: draft.hat!.shape, color: c } })} />
                </div>
              )}
              <p className="text-xs text-muted-foreground">Buy hats in the shop to unlock more shapes.</p>
            </section>
          </TabsContent>

          <TabsContent value="shop" className="space-y-6 pt-4">
            {(["hat", "shirt", "pants"] as const).map((slot) => (
              <section key={slot} className="space-y-2">
                <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">{slot}s</h2>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {(grouped[slot] ?? []).map((it) => {
                    const has = owned?.has(it.id);
                    return (
                      <div key={it.id} className={`rounded-lg border bg-card/60 p-3 ${RARITY_STYLE[it.rarity] ?? ""}`}>
                        <div className="mb-2 h-6 w-full rounded" style={{ background: it.config.color ?? "#666" }} />
                        <p className="truncate text-sm font-semibold text-foreground">{it.name}</p>
                        <p className="text-[11px] uppercase tracking-wider">{it.rarity}</p>
                        {has ? (
                          <Button size="sm" variant="secondary" className="mt-2 w-full" onClick={() => equipItem(it.slot, it.config)}>
                            Equip
                          </Button>
                        ) : (
                          <Button size="sm" className="mt-2 w-full" onClick={() => buy(it)}>
                            <Coins className="mr-1 size-3" /> {it.price}
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </TabsContent>

          <TabsContent value="custom" className="space-y-4 pt-4">
            <p className="text-sm text-muted-foreground">
              Design your own item for {CUSTOM_CRAFT_COST} coins. Pick a slot, a color, and (for hats) a shape.
            </p>
            <Input placeholder="Item name" value={customName} maxLength={24} onChange={(e) => setCustomName(e.target.value)} />
            <div className="flex gap-2">
              {(["hat", "shirt", "pants"] as const).map((s) => (
                <Button key={s} size="sm" variant={customSlot === s ? "default" : "outline"} onClick={() => setCustomSlot(s)}>{s}</Button>
              ))}
            </div>
            {customSlot === "hat" && (
              <div className="flex flex-wrap gap-2">
                {HAT_SHAPES.map((sh) => (
                  <Button key={sh} size="sm" variant={customShape === sh ? "default" : "outline"} onClick={() => setCustomShape(sh)}>{sh}</Button>
                ))}
              </div>
            )}
            <Swatches value={customColor} colors={PALETTE} onChange={setCustomColor} />
            <Button onClick={craft} disabled={coins < CUSTOM_CRAFT_COST}>
              <Hammer className="mr-2 size-4" /> Create for {CUSTOM_CRAFT_COST} coins
            </Button>

            <section className="space-y-2 pt-4">
              <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">My creations</h2>
              {(customs ?? []).length === 0 && <p className="text-sm text-muted-foreground">Nothing yet.</p>}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {(customs ?? []).map((c) => (
                  <div key={c.id} className="rounded-lg border border-border/60 bg-card/60 p-3">
                    <div className="mb-2 h-6 w-full rounded" style={{ background: c.config.color ?? "#666" }} />
                    <p className="truncate text-sm font-semibold text-foreground">{c.name}</p>
                    <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{c.slot}</p>
                    <Button size="sm" variant="secondary" className="mt-2 w-full" onClick={() => equipItem(c.slot, c.config)}>Equip</Button>
                  </div>
                ))}
              </div>
            </section>
          </TabsContent>
        </Tabs>
      </div>
    </main>
  );
}
