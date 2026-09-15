"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { addDrink, changeDrinkQty, chargeTab, removeDrinkLine } from "./actions";
import { TicketModal } from "./ticket";
import {
  formatMoney,
  PAYMENT_LABELS,
  PAYMENT_METHODS,
  type Order,
  type OrderItemWithProduct,
  type PaymentMethod,
  type Product,
  type TicketData,
} from "@/lib/types";

type Props = {
  mesa: { id: string; label: string } | null;
  order: Order | null;
  items: OrderItemWithProduct[];
  products: Product[];
  hasOpenShift: boolean;
  cajero: string;
};

function lineaTotal(it: OrderItemWithProduct): number {
  const sub = Number(it.subtotal);
  return sub > 0 ? sub : it.quantity * Number(it.unit_price);
}

export function BarraBoard({
  mesa,
  order,
  items,
  products,
  hasOpenShift,
  cajero,
}: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pago, setPago] = useState<PaymentMethod>("efectivo");
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

  const total = useMemo(() => {
    if (order && Number(order.total) > 0) return Number(order.total);
    return items.reduce((n, it) => n + lineaTotal(it), 0);
  }, [order, items]);

  const ticketData = useMemo<TicketData>(
    () => ({
      emisor: { nombre: "Redox", linea2: "Punta Carretas" },
      comprobante: {
        numero: (order?.id ?? "").slice(0, 8).toUpperCase() || "—",
        fecha: new Date().toLocaleString("es-UY", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }),
        mesa: "Barra",
        cajero,
      },
      lineas: items.map((it) => ({
        cantidad: it.quantity,
        descripcion: it.product?.name ?? "Producto",
        unitario: Number(it.unit_price),
        total: lineaTotal(it),
      })),
      total,
      medioPago: pago,
    }),
    [order?.id, items, cajero, total, pago],
  );

  if (!mesa) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-6">
        <h1 className="text-2xl font-semibold">Ventas de barra</h1>
        <p className="mt-4 rounded-2xl bg-[var(--color-busy)]/15 px-4 py-6 text-sm text-[var(--color-busy)] backdrop-blur-xl">
          Falta la mesa interna de barra. Corré la migración{" "}
          <code>027_barra_mesa_unica.sql</code> en Supabase.
        </p>
      </main>
    );
  }

  const vacio = items.length === 0;

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold">Ventas de barra</h1>
        <span className="text-sm text-[var(--color-muted)]">
          Venta en curso{" "}
          <span className="font-semibold text-[var(--color-ink)] tabular-nums">
            {formatMoney(total)}
          </span>
        </span>
      </header>

      {!hasOpenShift ? (
        <p className="mb-4 rounded-lg bg-[var(--color-busy)]/15 px-3 py-2 text-sm text-[var(--color-busy)] backdrop-blur-md">
          No hay un turno de caja abierto. Se puede armar la venta, pero para
          cobrar hay que abrir la caja primero.
        </p>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="mb-4 rounded-lg bg-[var(--color-danger)]/15 px-3 py-2 text-sm text-[var(--color-danger)] backdrop-blur-md"
        >
          {error}
        </p>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
        {/* Menú de bebidas */}
        <section>
          <h2 className="mb-2 text-sm font-medium tracking-wide text-[var(--color-muted)] uppercase">
            Bebidas
          </h2>
          {products.length === 0 ? (
            <p className="rounded-lg bg-[var(--color-surface-2)] px-3 py-4 text-sm text-[var(--color-muted)]">
              No hay bebidas activas en el catálogo.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {products.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  disabled={isPending}
                  onClick={() => run(() => addDrink(mesa.id, p.id))}
                  className="flex flex-col rounded-lg bg-white/5 px-2 py-2 text-left text-sm backdrop-blur-md transition-colors hover:bg-white/10 disabled:opacity-50"
                >
                  <span className="truncate font-medium">{p.name}</span>
                  <span className="text-xs text-[var(--color-muted)] tabular-nums">
                    {formatMoney(p.price)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* Ticket en curso */}
        <section className="rounded-2xl bg-white/5 p-4 shadow-lg shadow-black/10 backdrop-blur-xl">
          <h2 className="mb-3 text-sm font-medium tracking-wide text-[var(--color-muted)] uppercase">
            Venta
          </h2>

          {vacio ? (
            <p className="rounded-lg bg-[var(--color-surface-2)] px-3 py-4 text-center text-sm text-[var(--color-muted)]">
              Tocá una bebida para empezar.
            </p>
          ) : (
            <ul className="grid gap-1.5">
              {items.map((it) => (
                <li
                  key={it.id}
                  className="flex items-center gap-2 rounded-lg bg-[var(--color-surface-2)] px-2.5 py-2 text-sm"
                >
                  <span className="min-w-0 flex-1 truncate">
                    {it.product?.name ?? "Producto"}
                    <span className="ml-1.5 text-xs text-[var(--color-muted)] tabular-nums">
                      {formatMoney(lineaTotal(it))}
                    </span>
                  </span>
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => run(() => changeDrinkQty(it.id, -1))}
                    aria-label="Quitar una unidad"
                    className="size-7 shrink-0 rounded-md bg-white/5 text-[var(--color-muted)] backdrop-blur-md transition-colors hover:bg-white/10 hover:text-[var(--color-ink)] disabled:opacity-40"
                  >
                    −
                  </button>
                  <span className="w-5 shrink-0 text-center tabular-nums">
                    {it.quantity}
                  </span>
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => run(() => changeDrinkQty(it.id, 1))}
                    aria-label="Sumar una unidad"
                    className="size-7 shrink-0 rounded-md bg-white/5 text-[var(--color-muted)] backdrop-blur-md transition-colors hover:bg-white/10 hover:text-[var(--color-ink)] disabled:opacity-40"
                  >
                    +
                  </button>
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => run(() => removeDrinkLine(it.id))}
                    aria-label="Quitar la línea"
                    className="size-7 shrink-0 rounded-md bg-white/5 text-[var(--color-muted)] backdrop-blur-md transition-colors hover:bg-[var(--color-danger)]/15 hover:text-[var(--color-danger)] disabled:opacity-40"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-3 flex items-baseline justify-between border-t border-white/10 pt-3">
            <span className="text-sm text-[var(--color-muted)]">Total</span>
            <span className="text-lg font-semibold tabular-nums">
              {formatMoney(total)}
            </span>
          </div>

          <label className="mt-3 grid gap-1">
            <span className="text-xs text-[var(--color-muted)]">
              Medio de pago
            </span>
            <select
              value={pago}
              onChange={(e) => setPago(e.target.value as PaymentMethod)}
              className="rounded-lg bg-white/5 px-3 py-2 text-sm shadow-inner shadow-black/20 backdrop-blur-md outline-none focus:bg-white/10"
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
            disabled={isPending || !hasOpenShift || !order || vacio}
            onClick={() => {
              if (!order) return;
              const datos = ticketData;
              run(
                () => chargeTab(order.id, pago),
                () => setTicket(datos),
              );
            }}
            className="mt-3 w-full rounded-lg bg-[var(--color-accent)] px-5 py-3 text-sm font-semibold text-[#04121c] disabled:opacity-50"
          >
            Cobrar e imprimir {formatMoney(total)}
          </button>

          {!vacio ? (
            <button
              type="button"
              onClick={() => setTicket(ticketData)}
              className="mt-2 w-full rounded-lg bg-white/5 px-4 py-2 text-sm text-[var(--color-muted)] backdrop-blur-md transition-colors hover:bg-white/10 hover:text-[var(--color-ink)]"
            >
              Ver ticket
            </button>
          ) : null}
        </section>
      </div>

      {ticket ? (
        <TicketModal data={ticket} onClose={() => setTicket(null)} />
      ) : null}
    </main>
  );
}
