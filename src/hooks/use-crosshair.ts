import { useEffect, useState } from "react";

// 15x15 grid, cell = boolean. Also color + thickness for the default renderer.
export type CrosshairConfig = {
  grid: number; // 15
  cells: boolean[]; // length = grid*grid
  color: string; // hex
  scale: number; // 1..4 (px per cell)
  useCustom: boolean;
};

const KEY = "neonfrag.crosshair.v1";
const GRID = 15;

function defaultCross(): boolean[] {
  const c = new Array(GRID * GRID).fill(false);
  const mid = Math.floor(GRID / 2);
  for (let i = 0; i < GRID; i++) {
    if (i === mid) continue;
    if (Math.abs(i - mid) <= 5) {
      c[mid * GRID + i] = true;
      c[i * GRID + mid] = true;
    }
  }
  return c;
}

export function defaultConfig(): CrosshairConfig {
  return { grid: GRID, cells: defaultCross(), color: "#22d3ee", scale: 2, useCustom: false };
}

function read(): CrosshairConfig {
  if (typeof window === "undefined") return defaultConfig();
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return defaultConfig();
    const p = JSON.parse(raw) as Partial<CrosshairConfig>;
    return {
      grid: GRID,
      cells: Array.isArray(p.cells) && p.cells.length === GRID * GRID ? p.cells.map(Boolean) : defaultCross(),
      color: typeof p.color === "string" ? p.color : "#22d3ee",
      scale: typeof p.scale === "number" && p.scale >= 1 && p.scale <= 4 ? p.scale : 2,
      useCustom: Boolean(p.useCustom),
    };
  } catch {
    return defaultConfig();
  }
}

export function useCrosshair() {
  const [config, setConfigState] = useState<CrosshairConfig>(() => defaultConfig());
  useEffect(() => { setConfigState(read()); }, []);
  const setConfig = (c: CrosshairConfig) => {
    setConfigState(c);
    try { window.localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* noop */ }
  };
  return { config, setConfig };
}

export const CROSSHAIR_GRID = GRID;