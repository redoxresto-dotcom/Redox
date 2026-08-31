"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  addDrink,
  changeDrinkQty,
  chargeTab,
  removeDrinkLine,
} from "./actions";
import { TicketModal } from "./ticket";
import {
  formatMoney,
  nombreMesa,
  PAYMENT_LABELS,
  PAYMENT_METHODS,
  type BarTable,
  type Order,
  type OrderItemWithProduct,
  type PaymentMethod,
  type Product,
  type TicketData,
} from "@/lib/types";

export type BarTab = {
  table: BarTable;
  order: Order | null;
  items: OrderItemWithProduct[];
};

type Props = {
  tabs: BarTab[];
  products: Product[];
  hasOpenShift: boolean;
  cajero: string;
};

function lineaTotal(it: OrderItemWithProduct): number {
  const sub = Number(it.subtotal);
  return sub > 0 ? sub : it.quantity * Number(it.unit_price);
}

function totalTab(tab: BarTab): number {
  if (tab.order && Number(tab.order.total) > 0) return Number(tab.order.total);
  return tab.items.reduce((n, it) => n + lineaTotal(it), 0);
}

export function BarraBoard({ tabs, products, hasOpenShift, cajero }: Props) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ticket, setTicket] = useState<TicketData | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    const channel = supabase
      .channel("barra")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders" },
        () => router.refresh(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "order_items" },
        () => router.refresh(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [router]);

  function run(fn: () => Promise<{ error: string | null }>, onOk?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (result.error) setError(result.error);
      else {
        onOk?.();
        router.refresh();
      }
    });
  }

  const abiertas = tabs.filter((t) => t.order).length;
  const activo = openId ? tabs.find((t) => t.table.id === openId) ?? null : null;

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold">Ventas de barra</h1>
        <p className="text-sm text-[var(--color-muted)]">
          {tabs.length} mesa{tabs.length === 1 ? "" : "s"} · {abiertas} con cuenta
          abierta
        </p>
      </header>

      {!hasOpenShift ? (
        <p className="mb-4 rounded-lg border border-[var(--color-busy)]/40 bg-[var(--color-busy)]/10 px-3 py-2 text-sm text-[var(--color-busy)]">
          No hay un turno de caja abierto. Se puede tomar el pedido, pero para
          cobrar hay que abrir la caja primero.
        </p>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="mb-4 rounded-lg border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-3 py-2 text-sm text-[var(--color-danger)]"
        >
          {error}
        </p>
      ) : null}

      {tabs.length === 0 ? (
        <p className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-12 text-center text-sm text-[var(--color-muted)]">
          No hay mesas de barra configuradas.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {tabs.map((tab) => {
            const total = totalTab(tab);
            const abierta = tab.table.id === openId;
            return (
              <li key={tab.table.id}>
                <button
                  type="button"
                  onClick={() =>
                    setOpenId((id) =>
                      id === tab.table.id ? null : tab.table.id,
                    )
                  }
                  className={`flex w-full items-center justify-between gap-2 rounded-2xl border-2 p-4 text-left transition-colors ${
                    abierta
                      ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10"
                      : tab.order
                        ? "border-[var(--color-free)]/50 bg-[var(--color-surface)]"
                        : "border-[var(--color-border)] bg-[var(--color-surface)]"
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">
                      {nombreMesa(tab.table.number, tab.table.name)}
                    </span>
                    <span className="text-xs text-[var(--color-muted)]">
                      {tab.order
                        ? `${tab.items.length} ítem${tab.items.length === 1 ? "" : "s"}`
                        : "Libre"}
                    </span>
                  </span>
                  <span className="shrink-0 font-medium tabular-nums">
                    {tab.order ? formatMoney(total) : ""}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {activo ? (
        <TabPanel
          key={activo.table.id}
          tab={activo}
          products={products}
          hasOpenShift={hasOpenShift}
          cajero={cajero}
          isPending={isPending}
          onRun={run}
          onTicket={setTicket}
        />
      ) : null}

      {ticket ? (
        <TicketModal data={ticket} onClose={() => setTicket(null)} />
      ) : null}
    </main>
  );
}

// ---------------------------------------------------------------------------

function TabPanel({
  tab,
  products,
  hasOpenShift,
  cajero,
  isPending,
  onRun,
  onTicket,
}: {
  tab: BarTab;
  products: Product[];
  hasOpenShift: boolean;
  cajero: string;
  isPending: boolean;
  onRun: (fn: () => Promise<{ error: string | null }>, onOk?: () => void) => void;
  onTicket: (t: TicketData) => void;
}) {
  const [pago, setPago] = useState<PaymentMethod>("efectivo");
  const tableId = tab.table.id;
  const total = totalTab(tab);
  const mesaLabel = nombreMesa(tab.table.number, tab.table.name);

  const ticketData = useMemo<TicketData>(
    () => ({
      emisor: { nombre: "Redox", linea2: "Punta Carretas" },
      comprobante: {
        numero: (tab.order?.id ?? "").slice(0, 8).toUpperCase() || "—",
        fecha: new Date().toLocaleString("es-UY", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }),
        mesa: mesaLabel,
        cajero,
      },
      lineas: tab.items.map((it) => ({
        cantidad: it.quantity,
        descripcion: it.product?.name ?? "Producto",
        unitario: Number(it.unit_price),
        total: lineaTotal(it),
      })),
      total,
      medioPago: pago,
    }),
    [tab.items, tab.order?.id, mesaLabel, cajero, total, pago],
  );

  return (
    <section className="mt-5 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-medium">{mesaLabel}</h2>
        <span className="text-sm text-[var(--color-muted)]">
          Total{" "}
          <span className="font-semibold text-[var(--color-ink)] tabular-nums">
            {formatMoney(total)}
          </span>
        </span>
      </div>

      {/* Productos: solo bebidas */}
      <div className="mb-4 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        {products.map((p) => (
          <button
            key={p.id}
            type="button"
            disabled={isPending}
            onClick={() => onRun(() => addDrink(tableId, p.id))}
            className="flex flex-col rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-2 text-left text-sm transition-colors hover:border-[var(--color-accent)] disabled:opacity-50"
          >
            <span className="truncate font-medium">{p.name}</span>
            <span className="text-xs text-[var(--color-muted)] tabular-nums">
              {formatMoney(p.price)}
            </span>
          </button>
        ))}
        {products.length === 0 ? (
          <p className="col-span-full text-sm text-[var(--color-muted)]">
            No hay bebidas activas en el catálogo.
          </p>
        ) : null}
      </div>

      {/* Líneas de la cuenta */}
      {tab.items.length === 0 ? (
        <p className="rounded-lg bg-[var(--color-surface-2)] px-3 py-4 text-center text-sm text-[var(--color-muted)]">
          Todavía no hay nada cargado. Tocá una bebida para empezar.
        </p>
      ) : (
        <ul className="grid gap-1.5">
          {tab.items.map((it) => (
            <li
              key={it.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg bg-[var(--color-surface-2)] px-3 py-2 text-sm"
            >
              <span className="min-w-0 flex-1 basis-32 truncate">
                {it.product?.name ?? "Producto"}
              </span>
              <span className="tabular-nums text-[var(--color-muted)]">
                {formatMoney(lineaTotal(it))}
              </span>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => onRun(() => changeDrinkQty(it.id, -1))}
                  aria-label="Quitar una unidad"
                  className="size-7 rounded-md border border-[var(--color-border)] text-[var(--color-muted)] transition-colors hover:text-[var(--color-ink)] disabled:opacity-40"
                >
                  −
                </button>
                <span className="w-6 text-center tabular-nums">
                  {it.quantity}
                </span>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => onRun(() => changeDrinkQty(it.id, 1))}
                  aria-label="Sumar una unidad"
                  className="size-7 rounded-md border border-[var(--color-border)] text-[var(--color-muted)] transition-colors hover:text-[var(--color-ink)] disabled:opacity-40"
                >
                  +
                </button>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => onRun(() => removeDrinkLine(it.id))}
                  aria-label="Quitar la línea"
                  className="ml-1 size-7 rounded-md border border-[var(--color-border)] text-[var(--color-muted)] transition-colors hover:border-[var(--color-danger)] hover:text-[var(--color-danger)] disabled:opacity-40"
                >
                  ✕
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Cobro */}
      <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-[var(--color-border)] pt-4">
        <label className="grid gap-1">
          <span className="text-xs text-[var(--color-muted)]">Medio de pago</span>
          <select
            value={pago}
            onChange={(e) => setPago(e.target.value as PaymentMethod)}
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
          >
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {PAYMENT_LABELS[m]}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          disabled={
            isPending || !hasOpenShift || !tab.order || tab.items.length === 0
          }
          onClick={() => {
            if (!tab.order) return;
            const datos = ticketData;
            onRun(
              () => chargeTab(tab.order!.id, pago),
              () => onTicket(datos),
            );
          }}
          className="rounded-lg bg-[var(--color-accent)] px-5 py-2.5 text-sm font-semibold text-[#04121c] disabled:opacity-50"
        >
          Cobrar {formatMoney(total)}
        </button>

        {tab.order && tab.items.length > 0 ? (
          <button
            type="button"
            onClick={() => onTicket(ticketData)}
            className="rounded-lg border border-[var(--color-border)] px-4 py-2.5 text-sm text-[var(--color-muted)] transition-colors hover:text-[var(--color-ink)]"
          >
            Ver ticket
          </button>
        ) : null}
      </div>

      {!tab.order ? (
        <p className="mt-3 text-xs text-[var(--color-muted)]">
          La cuenta se abre sola al cargar la primera bebida.
        </p>
      ) : null}
    </section>
  );
}
