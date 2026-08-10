import { useEffect, useMemo, useState } from "react";
import { useAuth } from "./use-auth";

const GUEST_KEY = "neonfrag_guest";

export type Identity = {
  id: string;
  name: string;
  isGuest: boolean;
};

type StoredGuest = { id: string; name: string };

function readGuest(): StoredGuest | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(GUEST_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.id === "string" && typeof parsed.name === "string") {
      return { id: parsed.id, name: parsed.name };
    }
  } catch {
    /* noop */
  }
  return null;
}

export function ensureGuest(): StoredGuest {
  const existing = readGuest();
  if (existing) return existing;
  const num = Math.floor(1000 + Math.random() * 9000);
  const guest: StoredGuest = {
    id: `guest-${crypto.randomUUID().slice(0, 8)}${num}`,
    name: `Guest#${num}`,
  };
  window.localStorage.setItem(GUEST_KEY, JSON.stringify(guest));
  return guest;
}

export function clearGuest(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(GUEST_KEY);
}

export function useIdentity(): { identity: Identity | null; loading: boolean } {
  const { user, loading } = useAuth();
  const [guest, setGuest] = useState<StoredGuest | null>(() => readGuest());

  useEffect(() => {
    setGuest(readGuest());
    function onStorage(e: StorageEvent) {
      if (e.key === GUEST_KEY) setGuest(readGuest());
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [user]);

  // Stable object identity: effects elsewhere (realtime channels, voice rooms)
  // depend on `identity` and must NOT resubscribe on every render.
  const userId = user?.id ?? null;
  const guestId = guest?.id ?? null;
  const guestName = guest?.name ?? null;

  const identity = useMemo<Identity | null>(() => {
    if (loading) return null;
    if (userId) return { id: userId, name: "", isGuest: false };
    if (guestId) return { id: guestId, name: guestName ?? "Guest", isGuest: true };
    return null;
  }, [loading, userId, guestId, guestName]);

  return { identity, loading };
}