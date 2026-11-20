import { describe, expect, it } from "vitest";
import { DEFAULT_CFG, PANEL_CFG } from "@xstruc/engine";
import { addElement, addProject, backupText, empty, findElement, load, mergeBackup, parseBackup, removeElement, removeProject, save, STORE_KEY, updateElement } from "@/lib/local-jobs";

const mem = () => { const m = new Map<string, string>(); return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; };
const T = "2026-11-20T03:00:00.000Z";

describe("jobs on this device", () => {
  it("adds projects and elements, updates and removes them, and keeps them through storage", () => {
    let d = addProject(empty(), { name: "  Lot 12 Salisbury ", jobNumber: "J-1042" }, "p1", T);
    d = addElement(d, "p1", { kind: "floor", name: "Level 1", inputs: DEFAULT_CFG }, "e1", T);
    d = addElement(d, "p1", { kind: "panel", name: "P1", inputs: PANEL_CFG }, "e2", T);
    d = updateElement(d, "p1", "e1", { inputs: { ...DEFAULT_CFG, T: 250 } as typeof DEFAULT_CFG, summary: { bars: 1, marks: 1, kg: 1, meshSheets: 0, errors: 0, warnings: 0 } }, "2026-11-20T04:00:00.000Z");
    expect(d.projects[0].name).toBe("Lot 12 Salisbury");
    expect((findElement(d, "p1", "e1")!.inputs as { T: number }).T).toBe(250);
    expect(findElement(d, "p1", "e1")!.updated).toBe("2026-11-20T04:00:00.000Z");
    const s = mem();
    expect(save(s, d)).toBe(true);
    expect(s.m.has(STORE_KEY)).toBe(true);
    expect(load(s)).toEqual(d);
    d = removeElement(d, "p1", "e2");
    expect(d.projects[0].elements.map(e => e.id)).toEqual(["e1"]);
    expect(removeProject(d, "p1").projects).toEqual([]);
  });

  it("refuses blank names and unknown projects", () => {
    expect(() => addProject(empty(), { name: " " }, "p", T)).toThrow(/name/);
    expect(() => addElement(empty(), "nope", { kind: "floor", name: "L1", inputs: DEFAULT_CFG }, "e", T)).toThrow(/not on this device/);
  });

  it("reads damaged or foreign storage as an empty list and a refusing browser as false", () => {
    const s = mem(); s.setItem(STORE_KEY, "{oops");
    expect(load(s)).toEqual(empty());
    s.setItem(STORE_KEY, JSON.stringify({ version: 2, projects: [] }));
    expect(load(s)).toEqual(empty());
    expect(save({ getItem: () => null, setItem: () => { throw new Error("QuotaExceededError"); } }, empty())).toBe(false);
  });

  it("backs up and restores, replacing a project with the same id", () => {
    let d = addProject(empty(), { name: "A" }, "a", T);
    d = addElement(d, "a", { kind: "floor", name: "L1", inputs: DEFAULT_CFG }, "e", T);
    const back = parseBackup(backupText(d, T));
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.data).toEqual(d);
    const here = addProject(addProject(empty(), { name: "A (old)" }, "a", T), { name: "B" }, "b", T);
    const m = mergeBackup(here, back.data);
    expect(m.added).toBe(0); expect(m.replaced).toBe(1);
    expect(m.data.projects.map(p => p.name)).toEqual(["B", "A"]);
    expect(parseBackup("not json").ok).toBe(false);
    expect(parseBackup(JSON.stringify({ version: 1, projects: [{ id: "x", name: "X", elements: [{ id: "e", name: "E", kind: "wall", inputs: {} }] }] }))).toEqual({ ok: false, error: "A floor or panel in project X is damaged." });
  });
});
