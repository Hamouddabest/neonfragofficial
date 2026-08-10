import { useEffect, useState } from "react";
import type { Quality } from "@/components/game/Arena";

export type CrosshairCfg = { size: number; gap: number; thickness: number; color: string; dot: boolean; outline: boolean };
export const CROSSHAIR_DEFAULT: CrosshairCfg = { size: 10, gap: 4, thickness: 2, color: "#22d3ee", dot: true, outline: true };
export const CROSSHAIR_COLORS = ["#22d3ee", "#4ade80", "#f43f5e", "#facc15", "#ffffff", "#a78bfa", "#f97316"];

export function CustomCrosshair({ cfg }: { cfg: CrosshairCfg }) {
  const shadow = cfg.outline ? "0 0 0 1px rgba(0,0,0,0.9), 0 0 6px currentColor" : "0 0 6px currentColor";
  const arm = (style: React.CSSProperties, key: string) => (
    <span key={key} style={{ position: "absolute", background: cfg.color, color: cfg.color, boxShadow: shadow, borderRadius: 1, ...style }} />
  );
  return (
    <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
      <div style={{ position: "relative", width: 1, height: 1 }}>
        {arm({ width: cfg.thickness, height: cfg.size, left: -cfg.thickness / 2, top: -(cfg.gap + cfg.size) }, "t")}
        {arm({ width: cfg.thickness, height: cfg.size, left: -cfg.thickness / 2, top: cfg.gap }, "b")}
        {arm({ width: cfg.size, height: cfg.thickness, top: -cfg.thickness / 2, left: -(cfg.gap + cfg.size) }, "l")}
        {arm({ width: cfg.size, height: cfg.thickness, top: -cfg.thickness / 2, left: cfg.gap }, "r")}
        {cfg.dot && arm({ width: cfg.thickness, height: cfg.thickness, left: -cfg.thickness / 2, top: -cfg.thickness / 2, borderRadius: "50%" }, "d")}
      </div>
    </div>
  );
}

function read<T>(key: string, fallback: T, parse: (raw: string) => T | null): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    return parse(raw) ?? fallback;
  } catch {
    return fallback;
  }
}

/** Shared settings UI. Writes to the same localStorage keys the match HUD reads. */
export function GameSettings() {
  const [fov, setFov] = useState(() => read("neonfrag.fov", 75, (r) => (Number(r) >= 60 && Number(r) <= 110 ? Number(r) : null)));
  const [bobbing, setBobbing] = useState(() => read("neonfrag.bobbing", true, (r) => r !== "0"));
  const [quality, setQuality] = useState<Quality>(() =>
    read<Quality>("neonfrag.quality", "balanced", (r) => (r === "simple" || r === "balanced" || r === "fancy" ? r : null)),
  );
  const [crosshair, setCrosshair] = useState<CrosshairCfg>(() =>
    read("neonfrag.crosshair", CROSSHAIR_DEFAULT, (r) => ({ ...CROSSHAIR_DEFAULT, ...(JSON.parse(r) as Partial<CrosshairCfg>) })),
  );

  useEffect(() => { try { localStorage.setItem("neonfrag.fov", String(fov)); } catch { /* noop */ } }, [fov]);
  useEffect(() => { try { localStorage.setItem("neonfrag.bobbing", bobbing ? "1" : "0"); } catch { /* noop */ } }, [bobbing]);
  useEffect(() => { try { localStorage.setItem("neonfrag.quality", quality); } catch { /* noop */ } }, [quality]);
  useEffect(() => { try { localStorage.setItem("neonfrag.crosshair", JSON.stringify(crosshair)); } catch { /* noop */ } }, [crosshair]);

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div>
        <label className="block text-xs font-display uppercase tracking-widest text-accent">
          Field of view · <span className="text-primary">{fov}°</span>
        </label>
        <input type="range" min={60} max={110} value={fov} onChange={(e) => setFov(Number(e.target.value))} className="mt-2 w-full accent-[var(--primary)]" />
        <div className="mt-1 flex justify-between text-[10px] text-muted-foreground"><span>60</span><span>75</span><span>90</span><span>110</span></div>

        <label className="mt-5 flex items-center justify-between text-xs font-display uppercase tracking-widest text-accent">
          <span>View bobbing</span>
          <button
            type="button"
            onClick={() => setBobbing((v) => !v)}
            aria-pressed={bobbing}
            className={`relative h-6 w-11 rounded-full border transition-colors ${bobbing ? "border-accent bg-accent/40" : "border-border bg-black/60"}`}
          >
            <span className={`absolute top-0.5 size-5 rounded-full transition-all ${bobbing ? "left-[22px] bg-accent shadow-[0_0_10px_var(--accent)]" : "left-0.5 bg-muted-foreground"}`} />
          </button>
        </label>

        <div className="mt-5 text-xs font-display uppercase tracking-widest text-accent">Graphics</div>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {(["simple", "balanced", "fancy"] as Quality[]).map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => setQuality(q)}
              aria-pressed={quality === q}
              className={`rounded-md border px-2 py-2 text-[10px] font-display uppercase tracking-widest transition-colors ${
                quality === q ? "border-primary bg-primary/25 text-primary shadow-[0_0_12px_var(--primary)]" : "border-border bg-black/40 text-muted-foreground hover:text-foreground"
              }`}
            >
              {q}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
          {quality === "simple"
            ? "Lowest resolution, no sky or shadows — best FPS on phones."
            : quality === "balanced"
              ? "Sky and grid on, shadows off."
              : "Sun shadows, bloom, fog and full resolution."}
        </p>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <div className="text-xs font-display uppercase tracking-widest text-accent">Crosshair</div>
          <button type="button" onClick={() => setCrosshair(CROSSHAIR_DEFAULT)} className="text-[10px] uppercase tracking-widest text-muted-foreground hover:text-primary">
            Reset
          </button>
        </div>
        <div className="mt-3 grid h-16 place-items-center rounded-md border border-border bg-black/60">
          <div className="relative size-10"><CustomCrosshair cfg={crosshair} /></div>
        </div>
        <label className="mt-3 block text-[10px] uppercase tracking-widest text-muted-foreground">
          Length · {crosshair.size}px
          <input type="range" min={2} max={24} value={crosshair.size} onChange={(e) => setCrosshair((c) => ({ ...c, size: Number(e.target.value) }))} className="mt-1 w-full accent-[var(--primary)]" />
        </label>
        <label className="mt-2 block text-[10px] uppercase tracking-widest text-muted-foreground">
          Spread · {crosshair.gap}px
          <input type="range" min={0} max={24} value={crosshair.gap} onChange={(e) => setCrosshair((c) => ({ ...c, gap: Number(e.target.value) }))} className="mt-1 w-full accent-[var(--primary)]" />
        </label>
        <label className="mt-2 block text-[10px] uppercase tracking-widest text-muted-foreground">
          Thickness · {crosshair.thickness}px
          <input type="range" min={1} max={8} value={crosshair.thickness} onChange={(e) => setCrosshair((c) => ({ ...c, thickness: Number(e.target.value) }))} className="mt-1 w-full accent-[var(--primary)]" />
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
            className={`flex-1 rounded-md border px-2 py-2 text-[10px] font-display uppercase tracking-widest ${crosshair.dot ? "border-primary bg-primary/25 text-primary" : "border-border bg-black/40 text-muted-foreground"}`}
          >
            Center dot
          </button>
          <button
            type="button"
            onClick={() => setCrosshair((c) => ({ ...c, outline: !c.outline }))}
            aria-pressed={crosshair.outline}
            className={`flex-1 rounded-md border px-2 py-2 text-[10px] font-display uppercase tracking-widest ${crosshair.outline ? "border-primary bg-primary/25 text-primary" : "border-border bg-black/40 text-muted-foreground"}`}
          >
            Outline
          </button>
        </div>
      </div>
    </div>
  );
}
