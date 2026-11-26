import type { Model } from "@xstruc/engine";

interface CastIn { item: string; qty: string; where: string; supply: string }

/** The bar schedule of a model: one row per mark; then any cast-ins and accessories (a footing cage's). */
export function Schedule({ model }: { model: Model }) {
  const small = model.kg < 1000;   // a cage of a few dozen kilograms: kilograms to two places, as a cage schedule gives them
  const kg = (v: number) => (small ? v.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : Math.round(v).toLocaleString("en-AU"));
  const castins = (model.castins as CastIn[] | undefined) ?? [];
  return (
    <div className="grid gap-4">
      <div className="overflow-x-auto">
        <table className="sched">
          <thead><tr><th>Mark</th><th>Size</th><th>Shape</th><th>Dims</th><th>Cut length</th><th>Qty</th><th>Layer</th><th>kg</th></tr></thead>
          <tbody>
            {model.marks.map(m => (
              <tr key={m.mark}><td>{m.mark}</td><td>{m.type === "N" || m.type === "R" ? m.type + m.size : String(m.type)}</td><td>{m.code}</td><td>{m.dimStr ?? ""}</td><td>{Math.round(m.len).toLocaleString("en-AU")}</td><td>{m.qty}</td><td>{m.layer}</td><td>{kg(m.kg)}</td></tr>
            ))}
          </tbody>
          {small && model.marks.length > 0 && <tfoot><tr><td>Total</td><td /><td /><td /><td /><td>{model.marks.reduce((n, m) => n + m.qty, 0)}</td><td /><td>{kg(model.kg)}</td></tr></tfoot>}
        </table>
      </div>
      {castins.length > 0 && (
        <div className="overflow-x-auto" data-testid="castins">
          <h3 className="mb-1 font-semibold">Cast-in steel and accessories</h3>
          <table className="sched">
            <thead><tr><th>Item</th><th>Qty</th><th>Where and how</th><th>Supply</th></tr></thead>
            <tbody>{castins.map((c, i) => <tr key={i}><td>{c.item}</td><td>{c.qty}</td><td>{c.where}</td><td>{c.supply}</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
