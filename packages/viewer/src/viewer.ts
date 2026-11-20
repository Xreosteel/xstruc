// The 3D view of an engine model with three.js: bars as instanced cylinders per layer (in fixing order: the current
// layer solid, the layers below it faint, the rest hidden), translucent concrete, orbit camera with iso / plan / side
// views, and picking a bar under the pointer. Framework-free; apps/web wraps it in a React component.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import type { Bar, Model } from "@xstruc/engine";
import { sceneData, stepLayers, toScene, type SceneData, type Segment, type Prism } from "./scene-data.ts";

export type ViewKind = "iso" | "plan" | "side";
export interface ViewerOptions {
  background?: string;
  onPick?: (bar: Bar | null) => void;
}
export interface Viewer {
  setModel(model: Model): void;
  /** Fixing step: the index into the model's layer order, or null for the finished element. */
  setStep(step: number | null): void;
  setGhost(on: boolean): void;
  /** Run tags and distribution lines for the layers being fixed (shown on a fixing step, not on the finished view). */
  setTags(on: boolean): void;
  view(kind: ViewKind): void;
  select(bar: Bar | null): void;
  pickAt(clientX: number, clientY: number): Bar | null;
  /** Where on screen (client px) the middle of a bar's longest leg is drawn, for tests and tooltips. */
  screenOf(bar: Bar): { x: number; y: number } | null;
  data(): SceneData | null;
  dispose(): void;
}

const UP = new THREE.Vector3(0, 1, 0);
const CYL = new THREE.CylinderGeometry(1, 1, 1, 8, 1, false);   // unit cylinder along y, scaled per segment

function segmentsMesh(segs: Segment[], material: THREE.Material): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(CYL, material, Math.max(1, segs.length));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), a = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3(), s = new THREE.Vector3();
  segs.forEach((seg, i) => {
    a.set(...seg.a); b.set(...seg.b); d.subVectors(b, a);
    const len = d.length();
    q.setFromUnitVectors(UP, len > 0 ? d.clone().normalize() : UP);
    s.set(seg.r, Math.max(len, 1e-6), seg.r);
    m.compose(a.clone().add(b).multiplyScalar(0.5), q, s);
    mesh.setMatrixAt(i, m);
  });
  mesh.count = segs.length;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}

function prismMesh(p: Prism, material: THREE.Material): THREE.Mesh {
  // plan (x, y) in mm → shape; extrude along z by the prism's height; then into the scene frame
  const shape = new THREE.Shape(p.outline.map(q => new THREE.Vector2(q[0] / 1000, q[1] / 1000)));
  shape.holes = p.holes.map(h => new THREE.Path(h.map(q => new THREE.Vector2(q[0] / 1000, q[1] / 1000))));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: (p.z1 - p.z0) / 1000, bevelEnabled: false });
  geo.translate(0, 0, p.z0 / 1000);
  geo.rotateX(-Math.PI / 2);   // model z up → scene y up, model y north → scene −z
  return new THREE.Mesh(geo, material);
}

export function createViewer(container: HTMLElement, opts: ViewerOptions = {}): Viewer {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setClearColor(new THREE.Color(opts.background || "#11151a"));
  container.appendChild(renderer.domElement);
  renderer.domElement.style.display = "block";
  const labels = new CSS2DRenderer();   // grid bubbles and run tags as HTML over the canvas
  labels.domElement.style.position = "absolute"; labels.domElement.style.inset = "0"; labels.domElement.style.pointerEvents = "none";
  container.appendChild(labels.domElement);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(30, 50, 20); scene.add(sun);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 2000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  const root = new THREE.Group(); scene.add(root);
  let data: SceneData | null = null, step: number | null = null, ghost = true, tagsOn = true, selected: Bar | null = null;
  let solidMeshes: { mesh: THREE.InstancedMesh; segs: Segment[] }[] = [];
  let selMesh: THREE.InstancedMesh | null = null;
  const disposables: { dispose(): void }[] = [];

  const resize = () => {
    const w = container.clientWidth || 800, h = container.clientHeight || 500;
    renderer.setSize(w, h, false); renderer.domElement.style.width = w + "px"; renderer.domElement.style.height = h + "px";
    camera.aspect = w / h; camera.updateProjectionMatrix();
    labels.setSize(w, h);
  };
  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
  ro?.observe(container); resize();

  const label = (text: string, cls: string, color?: string, title?: string) => {
    const el = document.createElement("div");
    el.className = cls; el.textContent = text; if (title) el.title = title;
    Object.assign(el.style, cls === "xs-grid"
      ? { width: "22px", height: "22px", borderRadius: "50%", border: "1.5px solid #8b98a6", color: "#e8edf2", font: "600 11px system-ui, sans-serif", boxSizing: "border-box", textAlign: "center", lineHeight: "19px", background: "rgba(17,21,26,0.85)" }
      : { padding: "1px 6px", borderRadius: "3px", border: "1px solid " + color, color: "#e8edf2", font: "500 11px ui-monospace, monospace", background: "rgba(17,21,26,0.85)", whiteSpace: "nowrap" });
    return new CSS2DObject(el);
  };
  function clear() {
    root.traverse(o => { if (o instanceof CSS2DObject) o.element.remove(); });
    root.clear(); solidMeshes = []; selMesh = null;
    disposables.splice(0).forEach(d => d.dispose());
  }

  function draw() {
    clear();
    if (!data) return;
    const vis = stepLayers(data.order, step);
    const conc = new THREE.MeshStandardMaterial({ color: 0xb8c0c8, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide });
    disposables.push(conc);
    for (const p of data.concrete) { const mesh = prismMesh(p, conc); disposables.push(mesh.geometry); root.add(mesh); }
    const layerMesh = (id: string, faint: boolean) => {
      const L = data!.layers[id]; if (!L || !L.segments.length) return;
      const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(L.color), roughness: 0.55, metalness: 0.2, transparent: faint, opacity: faint ? 0.22 : 1, depthWrite: !faint });
      disposables.push(mat);
      const mesh = segmentsMesh(L.segments, mat); mesh.userData.layer = id; root.add(mesh);
      if (!faint) solidMeshes.push({ mesh, segs: L.segments });
    };
    vis.solid.forEach(id => layerMesh(id, false));
    if (ghost) vis.ghost.forEach(id => layerMesh(id, true)); else vis.ghost.forEach(id => layerMesh(id, false));
    // grid lines and bubbles (floor), run tags with their distribution lines (the layers of the current step)
    const gridMat = new THREE.LineDashedMaterial({ color: 0x5b6672, dashSize: 0.4, gapSize: 0.25 }); disposables.push(gridMat);
    for (const g of data.grids) {
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...g.a), new THREE.Vector3(...g.b)]); disposables.push(geo);
      const line = new THREE.Line(geo, gridMat); line.computeLineDistances(); root.add(line);
      for (const end of [g.a, g.b]) { const b = label(g.name, "xs-grid"); b.position.set(...end); root.add(b); }
    }
    if (tagsOn && step != null) {
      for (const t of data.tags.filter(t => vis.solid.includes(t.layer))) {
        const color = data.layers[t.layer]?.color || "#cccccc";
        const tag = label(t.label, "xs-tag", color, t.callout); tag.position.set(...t.at); root.add(tag);
        if (t.line) {
          const geo = new THREE.BufferGeometry().setFromPoints(t.line.map(p => new THREE.Vector3(...p))); disposables.push(geo);
          const mat = new THREE.LineBasicMaterial({ color: new THREE.Color(color) }); disposables.push(mat);
          root.add(new THREE.Line(geo, mat));
        }
      }
    }
    if (data.context.length) {
      const mat = new THREE.MeshStandardMaterial({ color: 0x7d8fa3, transparent: true, opacity: 0.25, depthWrite: false });
      disposables.push(mat); root.add(segmentsMesh(data.context, mat));
    }
    if (selected) {
      const i = data.bars.indexOf(selected);
      const segs = Object.values(data.layers).flatMap(L => L.segments).filter(s => s.bar === i).map(s => ({ ...s, r: s.r * 1.6 }));
      if (segs.length) {
        const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.9 });
        disposables.push(mat); selMesh = segmentsMesh(segs, mat); selMesh.renderOrder = 10; root.add(selMesh);
      }
    }
  }

  function view(kind: ViewKind) {
    if (!data) return;
    const { min, max } = data.bounds;
    const c = new THREE.Vector3((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
    const size = Math.max(max[0] - min[0], max[2] - min[2], (max[1] - min[1]) * 2, 1);
    const dist = size / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) * (camera.aspect < 1 ? 1.6 / camera.aspect : 1.15);
    const dir = kind === "plan" ? new THREE.Vector3(0, 1, 0.0001) : kind === "side" ? new THREE.Vector3(0, 0.12, 1) : new THREE.Vector3(-0.8, 0.9, 1.1);
    camera.position.copy(c).add(dir.normalize().multiplyScalar(dist));
    controls.target.copy(c); camera.near = dist / 200; camera.far = dist * 20; camera.updateProjectionMatrix(); controls.update();
  }

  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  function pickAt(clientX: number, clientY: number): Bar | null {
    if (!data) return null;
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(solidMeshes.map(s => s.mesh), false);
    for (const h of hits) {
      const owner = solidMeshes.find(s => s.mesh === h.object);
      if (owner && h.instanceId != null) return data.bars[owner.segs[h.instanceId].bar] || null;
    }
    return null;
  }

  let down: { x: number; y: number } | null = null;
  const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY }; };
  const onUp = (e: PointerEvent) => {
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5) { const b = pickAt(e.clientX, e.clientY); api.select(b); opts.onPick?.(b); }
    down = null;
  };
  renderer.domElement.addEventListener("pointerdown", onDown);
  renderer.domElement.addEventListener("pointerup", onUp);

  let raf = 0, alive = true;
  const loop = () => { if (!alive) return; controls.update(); renderer.render(scene, camera); labels.render(scene, camera); raf = requestAnimationFrame(loop); };
  loop();

  const api: Viewer = {
    setModel(model) {
      const before = data;
      data = model && !(model.errors || []).length ? sceneData(model) : data;   // a model with errors keeps the last good view
      if (step != null && data && step >= data.order.length) step = null;
      selected = null; draw();
      // refit when this is a different element (first model, floor ↔ panel, or a size change of more than a fifth)
      const span = (d: SceneData) => Math.max(d.bounds.max[0] - d.bounds.min[0], d.bounds.max[2] - d.bounds.min[2]);
      if (data && (!before || before.kind !== data.kind || Math.abs(span(before) - span(data)) > 0.2 * span(before))) view("iso");
    },
    setStep(s) { step = s; draw(); },
    setGhost(on) { ghost = on; draw(); },
    setTags(on) { tagsOn = on; draw(); },
    view,
    select(bar) { selected = bar; draw(); },
    pickAt,
    screenOf(bar) {
      if (!data) return null;
      const i = data.bars.indexOf(bar); if (i < 0) return null;
      const segs = Object.values(data.layers).flatMap(L => L.segments).filter(s => s.bar === i);
      if (!segs.length) return null;
      const seg = segs.reduce((a, b) => (Math.hypot(b.b[0] - b.a[0], b.b[1] - b.a[1], b.b[2] - b.a[2]) > Math.hypot(a.b[0] - a.a[0], a.b[1] - a.a[1], a.b[2] - a.a[2]) ? b : a));
      const v = new THREE.Vector3((seg.a[0] + seg.b[0]) / 2, (seg.a[1] + seg.b[1]) / 2, (seg.a[2] + seg.b[2]) / 2).project(camera);
      const r = renderer.domElement.getBoundingClientRect();
      return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height };
    },
    data: () => data,
    dispose() {
      alive = false; cancelAnimationFrame(raf); ro?.disconnect(); clear(); controls.dispose();
      renderer.domElement.removeEventListener("pointerdown", onDown); renderer.domElement.removeEventListener("pointerup", onUp);
      renderer.dispose(); renderer.domElement.remove(); labels.domElement.remove();
    }
  };
  return api;
}

export { toScene };
