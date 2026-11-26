// What a new floor, panel, pit or footing cage starts from: the engine's examples. A cage has three (the sample cages
// F1, F2, F3); the others one each.
import { CAGE_EXAMPLES, DEFAULT_CFG, PANEL_CFG, PIT_CFG, type ElementInput } from "@xstruc/engine";
import type { Kind } from "@/lib/local-jobs";

/** The choices in the new-element form: a kind, or a kind and its example ("cage:F2"). */
export const STARTS: { value: string; label: string }[] = [
  { value: "floor", label: "Floor slab" },
  { value: "panel", label: "Precast panel" },
  { value: "pit", label: "Pit (mud trap)" },
  ...Object.keys(CAGE_EXAMPLES).map(k => ({ value: "cage:" + k, label: "Footing cage (" + k + ")" }))
];

/** The kind and starting inputs for a choice in STARTS. */
export function start(value: string): { kind: Kind; inputs: ElementInput } {
  const [kind, ex] = value.split(":") as [Kind, string | undefined];
  return { kind, inputs: structuredClone(exampleFor(kind, ex)) };
}

/** The example an element of this kind goes back to; a cage goes back to the sample cage of its name (F1 otherwise). */
export function exampleFor(kind: Kind, which?: string | ElementInput): ElementInput {
  if (kind === "panel") return PANEL_CFG;
  if (kind === "pit") return PIT_CFG;
  if (kind === "cage") {
    const name = typeof which === "string" ? which : (which as { name?: string } | undefined)?.name ?? "";
    const key = (Object.keys(CAGE_EXAMPLES) as (keyof typeof CAGE_EXAMPLES)[]).find(k => name === k || name.startsWith(k + " "));
    return CAGE_EXAMPLES[key ?? "F1"];
  }
  return DEFAULT_CFG;
}

/** The plain word for an element of this kind ("Delete cage", "Finished cage"). */
export const NOUN: Record<Kind, string> = { floor: "floor", panel: "panel", pit: "pit", cage: "cage" };
