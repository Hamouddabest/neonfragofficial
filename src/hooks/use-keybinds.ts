import { useEffect, useRef, useState } from "react";

export type ActionId =
  | "moveForward" | "moveBack" | "moveLeft" | "moveRight"
  | "jump" | "reload" | "thirdPerson"
  | "weapon1" | "weapon2" | "weapon3" | "weapon4" | "weapon5"
  | "chat";

export const ACTION_LABELS: Record<ActionId, string> = {
  moveForward: "Move forward",
  moveBack: "Move back",
  moveLeft: "Strafe left",
  moveRight: "Strafe right",
  jump: "Jump",
  reload: "Reload",
  thirdPerson: "Toggle 3rd person",
  weapon1: "Weapon 1 (Rifle)",
  weapon2: "Weapon 2 (Sniper)",
  weapon3: "Weapon 3 (RPG)",
  weapon4: "Weapon 4 (SMG)",
  weapon5: "Weapon 5 (Shotgun)",
  chat: "Open chat",
};

export type KeyMap = Record<ActionId, string>;

export const DEFAULT_KEYS: KeyMap = {
  moveForward: "w",
  moveBack: "s",
  moveLeft: "a",
  moveRight: "d",
  jump: " ",
  reload: "r",
  thirdPerson: "v",
  weapon1: "1",
  weapon2: "2",
  weapon3: "3",
  weapon4: "4",
  weapon5: "5",
  chat: "t",
};

const KEY = "neonfrag.keys.v1";

function readKeys(): KeyMap {
  if (typeof window === "undefined") return { ...DEFAULT_KEYS };
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_KEYS };
    const parsed = JSON.parse(raw) as Partial<KeyMap>;
    const out = { ...DEFAULT_KEYS };
    for (const k of Object.keys(DEFAULT_KEYS) as ActionId[]) {
      if (typeof parsed[k] === "string" && parsed[k]) out[k] = parsed[k] as string;
    }
    return out;
  } catch { return { ...DEFAULT_KEYS }; }
}

export function keyDisplay(k: string): string {
  if (k === " ") return "Space";
  if (k === "arrowup") return "↑";
  if (k === "arrowdown") return "↓";
  if (k === "arrowleft") return "←";
  if (k === "arrowright") return "→";
  return k.length === 1 ? k.toUpperCase() : k;
}

/**
 * Both a piece of state (for the settings UI) and a live ref (for the
 * pointer-lock keydown handler, which must not re-attach on every keymap
 * change or it would drop events).
 */
export function useKeybinds() {
  const [keys, setKeys] = useState<KeyMap>(() => ({ ...DEFAULT_KEYS }));
  const ref = useRef<KeyMap>({ ...DEFAULT_KEYS });
  useEffect(() => {
    const loaded = readKeys();
    ref.current = loaded;
    setKeys(loaded);
  }, []);
  const update = (id: ActionId, k: string) => {
    const next = { ...ref.current, [id]: k.toLowerCase() };
    ref.current = next;
    setKeys(next);
    try { window.localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* noop */ }
  };
  const resetAll = () => {
    ref.current = { ...DEFAULT_KEYS };
    setKeys({ ...DEFAULT_KEYS });
    try { window.localStorage.setItem(KEY, JSON.stringify(DEFAULT_KEYS)); } catch { /* noop */ }
  };
  return { keys, keysRef: ref, update, resetAll };
}