"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/types";
import type { CancelledRow, HourRow, WaiterRow } from "./data";

const PAGE_SIZE = 10;

/**
 * Tarjeta retraíble: cada sección se puede plegar para no alargar la
 * ventana de reportes. Arranca desplegada para no cambiarle la vista a
 * nadie de un día para el otro.
 */
export function CollapsibleCard({
  title,
  wide,
  children,
}: {
  title: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);

  return (
    <section
      className={`rounded-2xl bg-white/5 p-5 shadow-lg shadow-black/10 backdrop-blur-xl ${
        wide ? "lg:col-span-2" : ""
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mb-3 flex w-full items-center justify-between gap-2 text-left"
      >
        <h2 className="text-sm tracking-wide text-[var(--color-muted)] uppercase">
          {title}
        </h2>
        <span className="shrink-0 text-xs text-[var(--color-muted)]">
          {open ? "Retraer −" : "Desplegar +"}
        </span>
      </button>
      {open ? children : null}
    </section>
  );
}

function Pager({
  page,
  pageCount,
  onChange,
}: {
  page: number;
  pageCount: number;
  onChange: (p: number) => void;
}) {
  if (pageCount <= 1) return null;

  return (
    <div className="mt-3 flex items-center justify-center gap-3 border-t border-white/10 pt-3 text-xs">
      <button
        type="button"
        disabled={page === 0}
        onClick={() => onChange(page - 1)}
        className="rounded-md bg-white/5 px-2 py-1 backdrop-blur-md transition-colors hover:bg-white/10 disabled:opacity-30"
      >
        ← Anterior
      </button>
      <span className="text-[var(--color-muted)] tabular-nums">
        Página {page + 1} de {pageCount}
      </span>
      <button
        type="button"
        disabled={page >= pageCount - 1}
        onClick={() => onChange(page + 1)}
        className="rounded-md bg-white/5 px-2 py-1 backdrop-blur-md transition-colors hover:bg-white/10 disabled:opacity-30"
      >
        Siguiente →
      </button>
    </div>
  );
}

export function Vacio() {
  return (
    <p className="py-6 text-center text-sm text-[var(--color-muted)]">
      No hubo ventas en el período.
    </p>
  );
}

export function Barra({
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

/** Ventas por franja horaria: hasta 24 filas, una por hora del día. */
export function HoursList({ horas }: { horas: HourRow[] }) {
  const [page, setPage] = useState(0);

  if (horas.length === 0) return <Vacio />;

  const max = Math.max(1, ...horas.map((h) => Number(h.total)));
  const pageCount = Math.max(1, Math.ceil(horas.length / PAGE_SIZE));
  const actual = Math.min(page, pageCount - 1);
  const slice = horas.slice(actual * PAGE_SIZE, actual * PAGE_SIZE + PAGE_SIZE);

  return (
    <>
      <ul className="grid gap-1.5">
        {slice.map((h) => (
          <Barra
            key={h.hour}
            label={`${String(h.hour).padStart(2, "0")}:00`}
            value={Number(h.total)}
            max={max}
          />
        ))}
      </ul>
      <Pager page={actual} pageCount={pageCount} onChange={setPage} />
    </>
  );
}

/** Ventas por mozo: barras y tabla comparten la misma página. */
export function WaiterSection({ mozos }: { mozos: WaiterRow[] }) {
  const [page, setPage] = useState(0);

  if (mozos.length === 0) return <Vacio />;

  const max = Math.max(1, ...mozos.map((m) => Number(m.total)));
  const pageCount = Math.max(1, Math.ceil(mozos.length / PAGE_SIZE));
  const actual = Math.min(page, pageCount - 1);
  const slice = mozos.slice(actual * PAGE_SIZE, actual * PAGE_SIZE + PAGE_SIZE);

  return (
    <>
      <ul className="grid gap-1.5">
        {slice.map((m) => (
          <Barra
            key={m.waiter_id ?? "sin-mozo"}
            label={m.waiter_name}
            value={Number(m.total)}
            max={max}
          />
        ))}
      </ul>

      <div className="mt-4 overflow-x-auto border-t border-white/10 pt-3">
        <table className="w-full min-w-[420px] text-sm">
          <thead>
            <tr className="text-left text-xs tracking-wide text-[var(--color-muted)] uppercase">
              <th className="pb-1.5 font-normal">Mozo</th>
              <th className="pb-1.5 text-right font-normal">Tickets</th>
              <th className="pb-1.5 text-right font-normal">
                Ticket promedio
              </th>
              <th className="pb-1.5 text-right font-normal">Total</th>
            </tr>
          </thead>
          <tbody>
            {slice.map((m) => (
              <tr key={m.waiter_id ?? "sin-mozo"} className="border-t border-white/10">
                <td className="py-1.5">{m.waiter_name}</td>
                <td className="py-1.5 text-right tabular-nums">{m.tickets}</td>
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

      <Pager page={actual} pageCount={pageCount} onChange={setPage} />

      <p className="mt-3 text-xs text-[var(--color-muted)]">
        Se cuenta la venta de quien abrió la mesa, no de quien cobró: es lo
        que refleja a quién atendió al cliente.
      </p>
    </>
  );
}

/** Pedidos cancelados: la lista que más crece con un período largo. */
export function CancelledList({ cancelados }: { cancelados: CancelledRow[] }) {
  const [page, setPage] = useState(0);

  if (cancelados.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-[var(--color-muted)]">
        No hubo pedidos cancelados en el período.
      </p>
    );
  }

  const pageCount = Math.max(1, Math.ceil(cancelados.length / PAGE_SIZE));
  const actual = Math.min(page, pageCount - 1);
  const slice = cancelados.slice(
    actual * PAGE_SIZE,
    actual * PAGE_SIZE + PAGE_SIZE,
  );

  return (
    <>
      <ul className="grid gap-2">
        {slice.map((c) => (
          <li
            key={c.order_id}
            className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-white/10 pb-2 text-sm last:border-0 last:pb-0"
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
      <Pager page={actual} pageCount={pageCount} onChange={setPage} />
    </>
  );
}
