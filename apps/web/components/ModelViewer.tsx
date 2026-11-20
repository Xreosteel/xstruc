"use client";
import { useEffect, useRef, useState } from "react";
import type { Bar, Model } from "@xstruc/engine";
import { createViewer, type Viewer, type ViewKind } from "@xstruc/viewer";

interface LayerInfo { id: string; name: string; color: string }

/**
 * The 3D view of a model (packages/viewer) with the fixing-order stepper, iso / plan / side views and a card for
 * the bar under the pointer. Client-only: the viewer is created after mount and disposed on unmount.
 */
export function ModelViewer({ model, height = 520 }: { model: Model; height?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const viewer = useRef<Viewer | null>(null);
  const [layers, setLayers] = useState<LayerInfo[]>([]);
  const [step, setStep] = useState<number | null>(null);
  const [ghost, setGhost] = useState(true);
  const [tags, setTags] = useState(true);
  const [bar, setBar] = useState<Bar | null>(null);

  useEffect(() => {
    const v = createViewer(box.current!, { onPick: setBar });
    viewer.current = v;
    (window as unknown as { xstrucViewer?: Viewer }).xstrucViewer = v;   // handle for the browser tests
    return () => { v.dispose(); viewer.current = null; };
  }, []);
  useEffect(() => {
    const v = viewer.current; if (!v) return;
    v.setModel(model);
    const d = v.data();
    setLayers(d ? d.order.map(id => ({ id, name: d.layers[id].name, color: d.layers[id].color })) : []);
    setStep(null); setBar(null);
  }, [model]);
  useEffect(() => { viewer.current?.setStep(step); }, [step]);
  useEffect(() => { viewer.current?.setGhost(ghost); }, [ghost]);
  useEffect(() => { viewer.current?.setTags(tags); }, [tags]);

  const n = layers.length;
  const label = step == null ? "Finished " + (model.kind === "panel" ? "panel" : "floor") + " · all layers" : "Step " + (step + 1) + " of " + n + " · " + (layers[step]?.name ?? "");
  const view = (k: ViewKind) => viewer.current?.view(k);
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button className="btn" type="button" onClick={() => view("iso")}>3D</button>
        <button className="btn" type="button" onClick={() => view("plan")}>Plan</button>
        <button className="btn" type="button" onClick={() => view("side")}>Side</button>
        <span className="mx-2 h-6 w-px bg-line" />
        <button className="btn" type="button" aria-label="Previous step" onClick={() => setStep(s => (s == null ? n - 1 : Math.max(0, s - 1)))}>◀</button>
        <span className="min-w-[16rem] font-mono" data-testid="step-label">{label}</span>
        <button className="btn" type="button" aria-label="Next step" onClick={() => setStep(s => (s == null ? 0 : s + 1 >= n ? null : s + 1))}>▶</button>
        <button className="btn" type="button" onClick={() => setStep(null)}>All</button>
        <label className="ml-2 flex items-center gap-2 text-muted"><input type="checkbox" checked={ghost} onChange={e => setGhost(e.target.checked)} /> Show layers below faint</label>
        <label className="flex items-center gap-2 text-muted"><input type="checkbox" checked={tags} onChange={e => setTags(e.target.checked)} /> Tags on each step</label>
      </div>
      <div className="relative overflow-hidden rounded-lg border border-line" style={{ height }}>
        <div ref={box} className="absolute inset-0" data-testid="viewer" />
        <ul className="pointer-events-none absolute left-3 top-3 grid gap-1 rounded bg-bg/80 p-2 text-xs">
          {layers.map((l, i) => (
            <li key={l.id} className={"flex items-center gap-2 " + (step != null && i > step ? "opacity-30" : "")}>
              <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: l.color }} />{l.name}
            </li>
          ))}
        </ul>
        {bar && (
          <div className="absolute bottom-3 right-3 w-72 rounded-lg border border-line bg-panel p-3 text-sm" data-testid="bar-card">
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-lg">{bar.mark ?? "—"}</span>
              <button className="text-muted" type="button" aria-label="Close" onClick={() => { setBar(null); viewer.current?.select(null); }}>×</button>
            </div>
            <div className="font-mono">{(bar.type === "W" ? "wire Ø" : bar.type) + bar.size}{bar.code ? " · shape " + bar.code : ""}{bar.dimStr ? " · " + bar.dimStr : ""}</div>
            <div className="mt-1"><span className="label inline">Cut length</span> <span className="font-mono text-base">{Math.round(bar.len || 0).toLocaleString("en-AU")}</span></div>
            <div className="text-muted">{layers.find(l => l.id === bar.layer)?.name ?? bar.layer}</div>
            {bar.setout && <div className="mt-1">{bar.setout}</div>}
            {bar.note && <div className="mt-1 text-muted">{bar.note}</div>}
          </div>
        )}
      </div>
      <p className="text-xs text-muted">Drag to orbit, scroll to zoom, right-drag to pan, click a bar for its details.</p>
    </div>
  );
}
