import { requireManager } from "@/lib/auth";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import {
  getCancelled,
  getCancelledSummary,
  getDeliveryTimes,
  getByHour,
  getByPayment,
  getByProduct,
  getByWaiter,
  getByWeekday,
  getSummary,
  parseRange,
  WEEKDAY_LABELS,
  type Range,
} from "./data";
import {
  formatMoney,
  isPaymentMethod,
  PAYMENT_LABELS,
  STATION_LABELS,
  type PaymentMethod,
  type Product,
  type Station,
} from "@/lib/types";
import { ImportVentas, type VentaManual } from "./import-ventas";

export const dynamic = "force-dynamic";

export default async function ReportesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  // Los reportes son del gerente: ni el mozo ni el admin ven la facturación.
  await requireManager();

  const params = await searchParams;
  const range = parseRange(params);
  const supabase = await getSupabaseServerClient();

  const [
    resumen,
    medios,
    productos,
    horas,
    dias,
    mozos,
    entregas,
    catalogoRes,
    canceladosResumen,
    cancelados,
  ] = await Promise.all([
    getSummary(supabase, range),
    getByPayment(supabase, range),
    getByProduct(supabase, range),
    getByHour(supabase, range),
    getByWeekday(supabase, range),
    getByWaiter(supabase, range),
    getDeliveryTimes(supabase, range),
    supabase.from("products").select("id, name").eq("active", true),
    getCancelledSummary(supabase, range),
    getCancelled(supabase, range),
  ]);

  // Ventas cargadas a mano (corte de luz): entran a los cuadros de arriba por
  // ser orders 'cobrada'; acá se listan aparte para poder revisarlas o borrarlas.
  const [manualesRes, perfilesRes] = await Promise.all([
    supabase
      .from("orders")
      .select("id, closed_at, total, payment_method, opened_by")
      .eq("origin", "manual")
      .eq("status", "cobrada")
      .gte("closed_at", range.from)
      .lt("closed_at", range.to)
      .order("closed_at"),
    supabase.from("profiles").select("id, full_name"),
  ]);

  const nombrePerfil = new Map(
    ((perfilesRes.data ?? []) as { id: string; full_name: string }[]).map((p) => [
      p.id,
      p.full_name,
    ]),
  );
  const manuales: VentaManual[] = (
    (manualesRes.data ?? []) as {
      id: string;
      closed_at: string;
      total: number;
      payment_method: PaymentMethod | null;
      opened_by: string | null;
    }[]
  ).map((o) => ({
    id: o.id,
    closed_at: o.closed_at,
    total: o.total,
    payment_method: o.payment_method,
    mozo: o.opened_by ? (nombrePerfil.get(o.opened_by) ?? null) : null,
  }));

  const vendidos = new Set(productos.map((p) => p.product_id));
  const sinVentas = ((catalogoRes.data ?? []) as Pick<Product, "id" | "name">[])
    .filter((p) => !vendidos.has(p.id))
    .slice(0, 12);

  const masVendidos = productos.slice(0, 10);
  const menosVendidos = [...productos].reverse().slice(0, 5);

  const maxHora = Math.max(1, ...horas.map((h) => Number(h.total)));
  const maxDia = Math.max(1, ...dias.map((d) => Number(d.total)));
  const maxMozo = Math.max(1, ...mozos.map((m) => Number(m.total)));

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Reportes</h1>
          <p className="text-sm text-[var(--color-muted)]">
            Ventas cobradas entre el {range.desde} y el {range.hasta}
            {manuales.length > 0
              ? ` · incluye ${manuales.length} venta${
                  manuales.length === 1 ? "" : "s"
                } cargada${manuales.length === 1 ? "" : "s"} a mano`
              : ""}
          </p>
        </div>

        <form method="get" className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1">
            <span className="text-xs text-[var(--color-muted)]">Desde</span>
            <input
              type="date"
              name="desde"
              defaultValue={range.desde}
              className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
            />
          </label>
          <label className="grid gap-1">
            <span className="text-xs text-[var(--color-muted)]">Hasta</span>
            <input
              type="date"
              name="hasta"
              defaultValue={range.hasta}
              className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
            />
          </label>
          <button
            type="submit"
            className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-[#04121c]"
          >
            Ver
          </button>
        </form>
      </header>

      <ImportVentas manuales={manuales} />

      <section className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Vendido" value={formatMoney(Number(resumen.total))} />
        <Metric label="Tickets" value={String(resumen.tickets)} />
        <Metric
          label="Ticket promedio"
          value={formatMoney(Number(resumen.ticket_avg))}
        />
        <Metric label="Unidades" value={String(resumen.items_units)} />
        <Metric
          label="Cancelados"
          value={`${canceladosResumen.pedidos} · ${formatMoney(Number(canceladosResumen.total))}`}
        />
      </section>

      <section className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Por medio de pago">
          {medios.length === 0 ? (
            <Vacio />
          ) : (
            <ul className="grid gap-2">
              {medios.map((m) => (
                <li
                  key={m.payment_method}
                  className="flex items-baseline justify-between gap-3 text-sm"
                >
                  <span>
                    {isPaymentMethod(m.payment_method)
                      ? PAYMENT_LABELS[m.payment_method]
                      : m.payment_method}
                    <span className="ml-2 text-xs text-[var(--color-muted)]">
                      {m.tickets} ticket{Number(m.tickets) === 1 ? "" : "s"}
                    </span>
                  </span>
                  <span className="font-medium tabular-nums">
                    {formatMoney(Number(m.total))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Por día de la semana">
          {dias.length === 0 ? (
            <Vacio />
          ) : (
            <ul className="grid gap-1.5">
              {dias.map((d) => (
                <Barra
                  key={d.weekday}
                  label={WEEKDAY_LABELS[d.weekday] ?? String(d.weekday)}
                  value={Number(d.total)}
                  max={maxDia}
                />
              ))}
            </ul>
          )}
        </Card>

        <Card title="Por franja horaria" wide>
          {horas.length === 0 ? (
            <Vacio />
          ) : (
            <ul className="grid gap-1.5">
              {horas.map((h) => (
                <Barra
                  key={h.hour}
                  label={`${String(h.hour).padStart(2, "0")}:00`}
                  value={Number(h.total)}
                  max={maxHora}
                />
              ))}
            </ul>
          )}
        </Card>

        <Card title="Demora en llegar a la mesa">
          {entregas.length === 0 ? (
            <p className="py-6 text-center text-sm text-[var(--color-muted)]">
              Todavía no hay entregas registradas en el período.
            </p>
          ) : (
            <>
              <ul className="grid gap-2">
                {entregas.map((e) => (
                  <li
                    key={e.station}
                    className="flex items-baseline justify-between gap-3 text-sm"
                  >
                    <span>
                      {STATION_LABELS[e.station as Station] ?? e.station}
                      <span className="ml-2 text-xs text-[var(--color-muted)]">
                        {e.entregas} entrega
                        {Number(e.entregas) === 1 ? "" : "s"}
                      </span>
                    </span>
                    <span className="shrink-0 tabular-nums">
                      <span
                        className={`font-medium ${
                          Number(e.promedio_min) >= 5
                            ? "text-[var(--color-busy)]"
                            : ""
                        }`}
                      >
                        {Number(e.promedio_min)} min
                      </span>
                      <span className="ml-2 text-xs text-[var(--color-muted)]">
                        peor {Number(e.peor_min)} min
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-[var(--color-muted)]">
                Cuánto pasa entre que la estación marca un ítem como pronto y
                que el mozo lo deja en la mesa. Es la comida que se enfría
                esperando sobre la barra.
              </p>
            </>
          )}
        </Card>

        <Card title="Más vendidos">
          {masVendidos.length === 0 ? (
            <Vacio />
          ) : (
            <ol className="grid gap-2">
              {masVendidos.map((p, i) => (
                <li
                  key={p.product_id}
                  className="flex items-baseline justify-between gap-3 text-sm"
                >
                  <span className="min-w-0 truncate">
                    <span className="mr-2 text-xs text-[var(--color-muted)] tabular-nums">
                      {i + 1}
                    </span>
                    {p.name}
                  </span>
                  <span className="shrink-0 tabular-nums">
                    <span className="font-medium">{p.units}</span>
                    <span className="ml-2 text-xs text-[var(--color-muted)]">
                      {formatMoney(Number(p.total))}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Card>

        <Card title="Menos vendidos">
          {menosVendidos.length === 0 ? (
            <Vacio />
          ) : (
            <>
              <ul className="grid gap-2">
                {menosVendidos.map((p) => (
                  <li
                    key={p.product_id}
                    className="flex items-baseline justify-between gap-3 text-sm"
                  >
                    <span className="min-w-0 truncate">{p.name}</span>
                    <span className="shrink-0 tabular-nums">
                      <span className="font-medium">{p.units}</span>
                      <span className="ml-2 text-xs text-[var(--color-muted)]">
                        {formatMoney(Number(p.total))}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>

              {sinVentas.length > 0 ? (
                <div className="mt-4 border-t border-[var(--color-border)] pt-3">
                  <p className="mb-1.5 text-xs tracking-wide text-[var(--color-muted)] uppercase">
                    Sin una sola venta en el período
                  </p>
                  <p className="text-sm text-[var(--color-muted)]">
                    {sinVentas.map((p) => p.name).join(" · ")}
                  </p>
                </div>
              ) : null}
            </>
          )}
        </Card>
      </section>

      <section className="mt-4">
        <Card title="Ventas por mozo" wide>
          {mozos.length === 0 ? (
            <Vacio />
          ) : (
            <>
              <ul className="grid gap-1.5">
                {mozos.map((m) => (
                  <Barra
                    key={m.waiter_id ?? "sin-mozo"}
                    label={m.waiter_name}
                    value={Number(m.total)}
                    max={maxMozo}
                  />
                ))}
              </ul>

              <div className="mt-4 overflow-x-auto border-t border-[var(--color-border)] pt-3">
                <table className="w-full min-w-[420px] text-sm">
                  <thead>
                    <tr className="text-left text-xs tracking-wide text-[var(--color-muted)] uppercase">
                      <th className="pb-1.5 font-normal">Mozo</th>
                      <th className="pb-1.5 text-right font-normal">
                        Tickets
                      </th>
                      <th className="pb-1.5 text-right font-normal">
                        Ticket promedio
                      </th>
                      <th className="pb-1.5 text-right font-normal">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mozos.map((m) => (
                      <tr
                        key={m.waiter_id ?? "sin-mozo"}
                        className="border-t border-[var(--color-border)]"
                      >
                        <td className="py-1.5">{m.waiter_name}</td>
                        <td className="py-1.5 text-right tabular-nums">
                          {m.tickets}
                        </td>
                        <td className="py-1.5 text-right tabular-nums">
                          {formatMoney(Number(m.ticket_avg))}
                        </td>
                        <td className="py-1.5 text-right font-medium tabular-nums">
                          {formatMoney(Number(m.total))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <p className="mt-3 text-xs text-[var(--color-muted)]">
                Se cuenta la venta de quien abrió la mesa, no de quien cobró:
                es lo que refleja a quién atendió al cliente.
              </p>
            </>
          )}
        </Card>
      </section>

      <section className="mt-4">
        <Card title="Pedidos cancelados" wide>
          {cancelados.length === 0 ? (
            <p className="py-6 text-center text-sm text-[var(--color-muted)]">
              No hubo pedidos cancelados en el período.
            </p>
          ) : (
            <ul className="grid gap-2">
              {cancelados.map((c) => (
                <li
                  key={c.order_id}
                  className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-[var(--color-border)] pb-2 text-sm last:border-0 last:pb-0"
                >
                  <span className="min-w-0">
                    <span className="font-medium">
                      Mesa {c.table_number}
                      {c.table_name ? ` · ${c.table_name}` : ""}
                    </span>
                    <span className="ml-2 text-xs text-[var(--color-muted)]">
                      {new Date(c.cancelled_at).toLocaleString("es-UY", {
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                      {c.cancelled_by ? ` · ${c.cancelled_by}` : ""}
                    </span>
                    {c.reason ? (
                      <span className="block text-xs text-[var(--color-muted)]">
                        {c.reason}
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0 font-medium tabular-nums text-[var(--color-danger)]">
                    {formatMoney(Number(c.total))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      <section className="mt-6">
        <h2 className="mb-2 text-sm tracking-wide text-[var(--color-muted)] uppercase">
          Exportar para el contador
        </h2>
        <div className="flex flex-wrap gap-2">
          <Exportar range={range} tipo="dias" label="Ventas por día" />
          <Exportar range={range} tipo="productos" label="Por producto" />
          <Exportar range={range} tipo="medios" label="Por medio de pago" />
          <Exportar range={range} tipo="horas" label="Por franja horaria" />
          <Exportar range={range} tipo="mozos" label="Por mozo" />
          <Exportar
            range={range}
            tipo="dias-semana"
            label="Por día de la semana"
          />
        </div>
        <p className="mt-2 text-xs text-[var(--color-muted)]">
          Salen en CSV con punto y coma y coma decimal: Excel en español los
          abre de un doble clic, sin pasar por el asistente de importación.
        </p>
      </section>

      <p className="mt-6 text-xs text-[var(--color-muted)]">
        Son reportes de venta: cuánto salió de cada cosa, cuándo y cómo se pagó.
        No calculan rentabilidad por trago, porque el costo que hay cargado es
        el del catálogo y no el de la última compra al proveedor. Para eso va el
        módulo de stock.
      </p>
    </main>
  );
}

// ---------------------------------------------------------------------------

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <p className="text-xs tracking-wide text-[var(--color-muted)] uppercase">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function Card({
  title,
  wide,
  children,
}: {
  title: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 ${
        wide ? "lg:col-span-2" : ""
      }`}
    >
      <h2 className="mb-3 text-sm tracking-wide text-[var(--color-muted)] uppercase">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Barra({
  label,
  value,
  max,
}: {
  label: string;
  value: number;
  max: number;
}) {
  return (
    <li className="flex items-center gap-3 text-sm">
      <span className="w-16 shrink-0 text-[var(--color-muted)] tabular-nums">
        {label}
      </span>
      <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
        <span
          className="block h-full rounded-full bg-[var(--color-accent)]"
          style={{ width: `${Math.max(2, (value / max) * 100)}%` }}
        />
      </span>
      <span className="w-24 shrink-0 text-right tabular-nums">
        {formatMoney(value)}
      </span>
    </li>
  );
}

function Vacio() {
  return (
    <p className="py-6 text-center text-sm text-[var(--color-muted)]">
      No hubo ventas en el período.
    </p>
  );
}

function Exportar({
  range,
  tipo,
  label,
}: {
  range: Range;
  tipo: string;
  label: string;
}) {
  const query = new URLSearchParams({
    desde: range.desde,
    hasta: range.hasta,
    tipo,
  });

  return (
    <a
      href={`/admin/reportes/export?${query}`}
      className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-muted)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-ink)]"
    >
      ↓ {label}
    </a>
  );
}
