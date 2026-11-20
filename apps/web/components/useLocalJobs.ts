"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { empty, load, save, STORE_KEY, type LocalData } from "@/lib/local-jobs";

// The browser's storage, or none when the browser blocks it (some private windows): then jobs live only while the
// page is open and the page says so.
function store(): Storage | null {
  try { const s = window.localStorage; s.getItem(STORE_KEY); return s; } catch { return null; }
}

export const newId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);

/** The jobs kept on this device: `data` is null until read (the server renders nothing device-specific). */
export function useLocalJobs() {
  const [data, setData] = useState<LocalData | null>(null);
  const [notKept, setNotKept] = useState(false);
  const ref = useRef<LocalData>(empty());

  useEffect(() => {
    const s = store();
    const d = s ? load(s) : empty();
    ref.current = d; setData(d); setNotKept(!s);
    const other = (e: StorageEvent) => { if (e.key === STORE_KEY && s) { ref.current = load(s); setData(ref.current); } };   // another tab changed them
    window.addEventListener("storage", other);
    return () => window.removeEventListener("storage", other);
  }, []);

  /** Applies a change and stores it; returns the change's error message, or null. */
  const change = useCallback((f: (d: LocalData) => LocalData): string | null => {
    let next: LocalData;
    try { next = f(ref.current); } catch (e) { return (e as Error).message; }
    ref.current = next; setData(next);
    const s = store();
    setNotKept(!s || !save(s, next));
    return null;
  }, []);

  return { data, change, notKept };
}
