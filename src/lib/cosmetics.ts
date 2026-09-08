export type HatShape =
  | "cap"
  | "beanie"
  | "bucket"
  | "headphones"
  | "visor"
  | "cowboy"
  | "helmet"
  | "tophat"
  | "horns"
  | "party"
  | "halo"
  | "crown";

export const HAT_SHAPES: HatShape[] = [
  "cap",
  "beanie",
  "bucket",
  "headphones",
  "visor",
  "cowboy",
  "helmet",
  "tophat",
  "horns",
  "party",
  "halo",
  "crown",
];

export type PlayerSkin = {
  shirt: string;
  pants: string;
  tone: string;
  hat: { shape: HatShape; color: string } | null;
};

export const DEFAULT_SKIN: PlayerSkin = {
  shirt: "#22d3ee",
  pants: "#2b3a67",
  tone: "#e0ac69",
  hat: null,
};

export const SKIN_TONES = ["#f8d7b4", "#e0ac69", "#c68642", "#8d5524", "#5b3a1e", "#a3e635", "#7dd3fc"];

const HEX = /^#[0-9a-fA-F]{6}$/;

function col(v: unknown, fallback: string): string {
  return typeof v === "string" && HEX.test(v) ? v : fallback;
}

export function sanitizeSkin(raw: unknown): PlayerSkin {
  const o = (raw ?? {}) as Record<string, unknown>;
  const hatRaw = o["hat"] as Record<string, unknown> | null | undefined;
  const shape = hatRaw && typeof hatRaw["shape"] === "string" ? (hatRaw["shape"] as HatShape) : null;
  return {
    shirt: col(o["shirt"], DEFAULT_SKIN.shirt),
    pants: col(o["pants"], DEFAULT_SKIN.pants),
    tone: col(o["tone"], DEFAULT_SKIN.tone),
    hat: shape && HAT_SHAPES.includes(shape) ? { shape, color: col(hatRaw?.["color"], "#ffffff") } : null,
  };
}

export const RARITY_STYLE: Record<string, string> = {
  common: "text-slate-300 border-slate-500/40",
  rare: "text-cyan-300 border-cyan-400/50",
  epic: "text-fuchsia-300 border-fuchsia-400/50",
  legendary: "text-amber-300 border-amber-400/60",
};

export const GUEST_SKIN_KEY = "neonfrag_skin";

export function readLocalSkin(): PlayerSkin {
  if (typeof window === "undefined") return DEFAULT_SKIN;
  try {
    const raw = window.localStorage.getItem(GUEST_SKIN_KEY);
    if (raw) return sanitizeSkin(JSON.parse(raw));
  } catch {
    /* noop */
  }
  return DEFAULT_SKIN;
}

export function writeLocalSkin(skin: PlayerSkin): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(GUEST_SKIN_KEY, JSON.stringify(skin));
  } catch {
    /* noop */
  }
}

export const CUSTOM_CRAFT_COST = 500;
