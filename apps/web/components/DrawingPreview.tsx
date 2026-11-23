"use client";
import { useMemo, useRef, useState } from "react";
import type { Entity, Found, FoundKind, Sheet } from "@xstruc/reader";

/** Colour of each kind of thing the reader found, drawn over the plan (the rest of the drawing stays grey). */
export const KIND_COLOUR: Record<FoundKind, string> = {
  grid: "#f0883e", slab: "#e8edf2", balcony: "#a371f7", opening: "#e5534b", setdown: "#3fb950", step: "#d6a243",
  column: "#8b98a6", note: "#58a6ff", callout: "#58a6ff", extent: "#58a6ff"
};
export const KIND_NAME: Record<FoundKind, string> = {
  grid: "Grid lines", slab: "Slab edge", balcony: "Balconies", opening: "Openings", setdown: "Set-downs", step: "Step",
  column: "Columns (seen)", note: "Notes read", callout: "Reo callouts", extent: "Distribution lines"
};

/**
 * The drawing as the reader saw it (SVG, drawing millimetres, y up), with what it found in colour and `focus`
 * (the entities behind an issue the pointer is on) in yellow. Wheel to zoom, drag to pan, double-click to fit.
 */
export function DrawingPreview({ sheet, found, focus, height = 560 }: { sheet: Sheet; found: Found[]; focus: string[]; height?: number }) {
  const colourOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of found) for (const id of f.ids) if (!m.has(id) || f.kind !== "slab") m.set(id, KIND_COLOUR[f.kind]);
    return m;
  }, [found]);
  const ext = sheet.extents ?? { min: [0, 0], max: [1000, 1000] };
  const fit = useMemo(() => {
    const w = ext.max[0] - ext.min[0], h = ext.max[1] - ext.min[1], pad = Math.max(w, h) * 0.03;
    return { x: ext.min[0] - pad, y: -(ext.max[1] + pad), w: w + 2 * pad, h: h + 2 * pad };
  }, [ext.min, ext.max]);
  const [vb, setVb] = useState(fit);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; vb: typeof vb } | null>(null);
  const focusSet = useMemo(() => new Set(focus), [focus]);

  const toUser = (cx: number, cy: number) => {
    const r = svg.current!.getBoundingClientRect(), s = Math.max(vb.w / r.width, vb.h / r.height);
    const ox = vb.x + (vb.w - r.width * s) / 2, oy = vb.y + (vb.h - r.height * s) / 2;
    return { x: ox + (cx - r.left) * s, y: oy + (cy - r.top) * s, s };
  };
  const onWheel = (e: React.WheelEvent) => {
    const p = toUser(e.clientX, e.clientY), k = e.deltaY > 0 ? 1.2 : 1 / 1.2;
    setVb(v => ({ x: p.x - (p.x - v.x) * k, y: p.y - (p.y - v.y) * k, w: v.w * k, h: v.h * k }));
  };
  const px = vb.w / 900;   // one screen pixel, roughly, in drawing mm (for text that would be too small to read)

  const draw = (e: Entity) => {
    const hot = focusSet.has(e.id), c = hot ? "#ffd33d" : colourOf.get(e.id);
    const stroke = c ?? "#4a5561", sw = hot ? 3 : c ? 1.6 : 1;
    const common = { stroke, strokeWidth: sw, fill: "none", vectorEffect: "non-scaling-stroke" as const };
    switch (e.kind) {
      case "line": return <line key={e.id} x1={e.a[0]} y1={-e.a[1]} x2={e.b[0]} y2={-e.b[1]} {...common} />;
      case "pline": case "leader": return <polyline key={e.id} points={(e.kind === "pline" && e.closed ? [...e.pts, e.pts[0]] : e.pts).map(p => p[0] + "," + -p[1]).join(" ")} {...common} />;
      case "circle": return <circle key={e.id} cx={e.c[0]} cy={-e.c[1]} r={e.r} {...common} />;
      case "arc": {
        const a0 = (e.a0 * Math.PI) / 180, a1 = (e.a1 * Math.PI) / 180, sweep = (((e.a1 - e.a0) % 360) + 360) % 360;
        const d = "M" + (e.c[0] + e.r * Math.cos(a0)) + "," + -(e.c[1] + e.r * Math.sin(a0)) + " A" + e.r + "," + e.r + " 0 " + (sweep > 180 ? 1 : 0) + " 0 " + (e.c[0] + e.r * Math.cos(a1)) + "," + -(e.c[1] + e.r * Math.sin(a1));
        return <path key={e.id} d={d} {...common} />;
      }
      case "hatch": return <path key={e.id} d={e.loops.map(l => "M" + l.map(p => p[0] + "," + -p[1]).join("L") + "Z").join("")} fill={c ?? "#4a5561"} fillOpacity={hot ? 0.5 : 0.18} stroke="none" />;
      case "dim": return <line key={e.id} x1={e.p1[0]} y1={-e.p1[1]} x2={e.p2[0]} y2={-e.p2[1]} {...common} strokeDasharray="4 3" />;
      case "text": {
        if (e.h < px * 3) return null;
        // centred in its box and turned with it, so vertical callouts read along their bars
        const cx = (e.box[0][0] + e.box[1][0]) / 2, cy = -(e.box[0][1] + e.box[1][1]) / 2, lines = e.text.split("\n"), lh = e.h * 1.667;
        return (
          <text key={e.id} transform={"translate(" + cx + "," + cy + ") rotate(" + -e.rot + ")"} fontSize={e.h} textAnchor="middle" fill={hot ? "#ffd33d" : c ?? "#8b98a6"} fontFamily="IBM Plex Mono, monospace">
            {lines.map((l, i) => <tspan key={i} x={0} y={(i - (lines.length - 1) / 2) * lh + e.h * 0.35}>{l}</tspan>)}
          </text>
        );
      }
    }
  };

  return (
    <div className="relative overflow-hidden rounded-lg border border-line bg-bg" style={{ height }}>
      <svg
        ref={svg} className="h-full w-full cursor-grab touch-none" viewBox={vb.x + " " + vb.y + " " + vb.w + " " + vb.h} data-testid="drawing"
        onWheel={onWheel} onDoubleClick={() => setVb(fit)}
        onPointerDown={e => { (e.target as Element).setPointerCapture?.(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, vb }; }}
        onPointerMove={e => { const d = drag.current; if (!d) return; const s = toUser(0, 0).s; setVb({ ...d.vb, x: d.vb.x - (e.clientX - d.x) * s, y: d.vb.y - (e.clientY - d.y) * s }); }}
        onPointerUp={() => { drag.current = null; }}
      >
        {sheet.entities.filter(e => !colourOf.has(e.id) && !focusSet.has(e.id)).map(draw)}
        {sheet.entities.filter(e => colourOf.has(e.id) && !focusSet.has(e.id)).map(draw)}
        {sheet.entities.filter(e => focusSet.has(e.id)).map(draw)}
      </svg>
      <p className="pointer-events-none absolute bottom-2 left-3 text-xs text-muted">Scroll to zoom, drag to pan, double-click to fit.</p>
    </div>
  );
}
