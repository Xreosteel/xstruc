// Jobs kept on this device (no accounts): projects, each with its floors and panels and their inputs, in the
// browser's localStorage. Pure functions over a plain object, so they are tested in Node; the React hook that reads
// and writes the storage is in components/useLocalJobs.ts.
import type { ElementInput } from "@xstruc/engine";
import type { Summary } from "@/lib/engine-run";

export const STORE_KEY = "xstruc.web.jobs.v1";

export type Kind = "floor" | "panel";
export interface LocalElement { id: string; kind: Kind; name: string; inputs: ElementInput; updated: string; summary?: Summary }
export interface LocalProject { id: string; name: string; jobNumber: string; site: string; created: string; elements: LocalElement[] }
export interface LocalData { version: 1; projects: LocalProject[] }

export const empty = (): LocalData => ({ version: 1, projects: [] });

interface KV { getItem(k: string): string | null; setItem(k: string, v: string): void }

/** Reads the device's jobs; anything unreadable gives an empty list rather than a broken page. */
export function load(store: KV): LocalData {
  try {
    const raw = store.getItem(STORE_KEY);
    if (!raw) return empty();
    const d = parseBackup(raw);
    return d.ok ? d.data : empty();
  } catch { return empty(); }
}

/** Writes the device's jobs; false when the browser refuses (storage full or blocked). */
export function save(store: KV, data: LocalData): boolean {
  try { store.setItem(STORE_KEY, JSON.stringify(data)); return true; } catch { return false; }
}

const clean = (s: unknown, max: number) => String(s ?? "").trim().slice(0, max);

export function addProject(d: LocalData, p: { name: string; jobNumber?: string; site?: string }, id: string, now: string): LocalData {
  const name = clean(p.name, 200);
  if (!name) throw new Error("Give the project a name.");
  return { ...d, projects: [...d.projects, { id, name, jobNumber: clean(p.jobNumber, 40), site: clean(p.site, 200), created: now, elements: [] }] };
}

export function removeProject(d: LocalData, id: string): LocalData {
  return { ...d, projects: d.projects.filter(p => p.id !== id) };
}

const withProject = (d: LocalData, pid: string, f: (p: LocalProject) => LocalProject): LocalData => {
  if (!d.projects.some(p => p.id === pid)) throw new Error("That project is not on this device.");
  return { ...d, projects: d.projects.map(p => (p.id === pid ? f(p) : p)) };
};

export function addElement(d: LocalData, pid: string, e: { kind: Kind; name: string; inputs: ElementInput }, id: string, now: string): LocalData {
  const name = clean(e.name, 200);
  if (!name) throw new Error("Give the floor or panel a name.");
  if (e.kind !== "floor" && e.kind !== "panel") throw new Error("Pick floor slab or precast panel.");
  return withProject(d, pid, p => ({ ...p, elements: [...p.elements, { id, kind: e.kind, name, inputs: e.inputs, updated: now }] }));
}

export function updateElement(d: LocalData, pid: string, eid: string, change: { inputs?: ElementInput; summary?: Summary; name?: string }, now: string): LocalData {
  return withProject(d, pid, p => {
    if (!p.elements.some(e => e.id === eid)) throw new Error("That floor or panel is not on this device.");
    return {
      ...p,
      elements: p.elements.map(e => (e.id !== eid ? e : {
        ...e,
        ...(change.inputs !== undefined ? { inputs: change.inputs } : {}),
        ...(change.summary !== undefined ? { summary: change.summary } : {}),
        ...(change.name !== undefined && clean(change.name, 200) ? { name: clean(change.name, 200) } : {}),
        updated: now
      }))
    };
  });
}

export function removeElement(d: LocalData, pid: string, eid: string): LocalData {
  return withProject(d, pid, p => ({ ...p, elements: p.elements.filter(e => e.id !== eid) }));
}

export const findProject = (d: LocalData, pid: string) => d.projects.find(p => p.id === pid) ?? null;
export const findElement = (d: LocalData, pid: string, eid: string) => findProject(d, pid)?.elements.find(e => e.id === eid) ?? null;

/** A backup file's text: the same shape the device keeps, with a note on what it is. */
export function backupText(d: LocalData, now: string): string {
  return JSON.stringify({ app: "X Struc", saved: now, ...d }, null, 1);
}

/** Reads a backup (or the stored text), checking its shape so a wrong file cannot break the page. */
export function parseBackup(text: string): { ok: true; data: LocalData } | { ok: false; error: string } {
  let o: unknown;
  try { o = JSON.parse(text); } catch { return { ok: false, error: "That file is not an X Struc backup (not JSON)." }; }
  const d = o as { version?: unknown; projects?: unknown };
  if (!d || typeof d !== "object" || d.version !== 1 || !Array.isArray(d.projects)) return { ok: false, error: "That file is not an X Struc backup." };
  const projects: LocalProject[] = [];
  for (const raw of d.projects as Record<string, unknown>[]) {
    if (!raw || typeof raw.id !== "string" || typeof raw.name !== "string" || !Array.isArray(raw.elements)) return { ok: false, error: "A project in that backup is damaged." };
    const elements: LocalElement[] = [];
    for (const e of raw.elements as Record<string, unknown>[]) {
      if (!e || typeof e.id !== "string" || typeof e.name !== "string" || (e.kind !== "floor" && e.kind !== "panel") || !e.inputs || typeof e.inputs !== "object") {
        return { ok: false, error: "A floor or panel in project " + raw.name + " is damaged." };
      }
      elements.push({ id: e.id, kind: e.kind, name: e.name, inputs: e.inputs as ElementInput, updated: String(e.updated ?? ""), ...(e.summary ? { summary: e.summary as Summary } : {}) });
    }
    projects.push({ id: raw.id, name: raw.name, jobNumber: String(raw.jobNumber ?? ""), site: String(raw.site ?? ""), created: String(raw.created ?? ""), elements });
  }
  return { ok: true, data: { version: 1, projects } };
}

/** Restoring a backup adds its projects; one already on this device (same id) is replaced by the backup's copy. */
export function mergeBackup(d: LocalData, b: LocalData): { data: LocalData; added: number; replaced: number } {
  const ids = new Set(b.projects.map(p => p.id));
  const replaced = d.projects.filter(p => ids.has(p.id)).length;
  return { data: { version: 1, projects: [...d.projects.filter(p => !ids.has(p.id)), ...b.projects] }, added: b.projects.length - replaced, replaced };
}
