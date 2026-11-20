import type { Model } from "@xstruc/engine";

/** The bar schedule of a model: one row per mark. */
export function Schedule({ model }: { model: Model }) {
  return (
    <div className="overflow-x-auto">
      <table className="sched">
        <thead><tr><th>Mark</th><th>Size</th><th>Shape</th><th>Dims</th><th>Cut length</th><th>Qty</th><th>Layer</th><th>kg</th></tr></thead>
        <tbody>
          {model.marks.map(m => (
            <tr key={m.mark}><td>{m.mark}</td><td>{m.type === "N" || m.type === "R" ? m.type + m.size : String(m.type)}</td><td>{m.code}</td><td>{m.dimStr ?? ""}</td><td>{Math.round(m.len).toLocaleString("en-AU")}</td><td>{m.qty}</td><td>{m.layer}</td><td>{Math.round(m.kg).toLocaleString("en-AU")}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
