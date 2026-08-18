"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { FloorTable } from "./floor-table";
import { CANVAS_H, CANVAS_W } from "@/lib/floor";
import {
  addProductToTable,
  changeItemQuantity,
  closeOrder,
  openTable,
  releaseEmptyTable,
  removeItem,
  toggleTableAssignment,
} from "../actions";
import {
  CATEGORY_LABELS,
  formatMoney,
  PAYMENT_LABELS,
  PAYMENT_METHODS,
  type PaymentMethod,
  type AlertType,
  type OrderItemWithProduct,
  type Product,
  type ProductCategory,
  type Sector,
  type TableDetail,
} from "@/lib/types";

/** Líneas que todavía esperan a la barra o a la cocina. */
function pendientesDe(items: OrderItemWithProduct[]): number {
  return items.filter((i) => i.status !== "listo").length;
}

type Props = {
  tables: TableDetail[];
  products: Product[];
  /** id de perfil → nombre del mozo. */
  waiters: Record<string, string>;
  currentUserId: string;
  /** id de mesa → tipos de alerta pendientes. */
  pendingAlerts: Record<string, AlertType[]>;
  /** Sin turno de caja abierto no se puede cobrar. */
  hasOpenShift: boolean;
  sectors: Sector[];
  /** Motivo por el que la pantalla anterior lo mandó para acá, si lo hubo. */
  notice?: string | null;
};

const CATEGORIES: ProductCategory[] = ["bebida", "comida", "otro"];

export function SalonBoard({
  tables,
  products,
  waiters,
  currentUserId,
  pendingAlerts,
  hasOpenShift,
  sectors,
  notice,
}: Props) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Mesas que quedaron sin sector: mejor una pestaña de más que una mesa que
  // no aparece en ninguna pantalla.
  const huerfanas = tables.some((t) => t.table.sector_id === null);
  const tabs: { id: string | null; name: string }[] = [
    ...sectors.map((s) => ({ id: s.id as string | null, name: s.name })),
    ...(huerfanas ? [{ id: null, name: "Sin sector" }] : []),
  ];

  const [sectorId, setSectorId] = useState<string | null>(
    tabs[0]?.id ?? null
  );

  // El plano se guarda en unidades fijas y cada pantalla lo escala a su ancho:
  // el mismo salón se ve igual en el monitor de la caja y en la tablet.
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setScale(Math.min(1, entry.contentRect.width / CANVAS_W));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const selected = useMemo(
    () => tables.find((t) => t.table.id === selectedId) ?? null,
    [tables, selectedId]
  );

  // Varios mozos operan a la vez desde distintos dispositivos: cualquier cambio
  // en mesas, cuentas o líneas repinta el tablero de todos.
  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    const channel = supabase
      .channel("salon-board")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tables" },
        () => router.refresh()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders" },
        () => router.refresh()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "order_items" },
        () => router.refresh()
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [router]);

  // Si se cobró la mesa abierta en el panel, cerrarlo.
  useEffect(() => {
    if (selectedId && !tables.some((t) => t.table.id === selectedId)) {
      setSelectedId(null);
    }
  }, [tables, selectedId]);

  const ocupadas = tables.filter((t) => t.table.status === "ocupada").length;
  const enSalon = tables.reduce((sum, t) => sum + (t.order?.total ?? 0), 0);
  const conComanda = tables.filter((t) => pendientesDe(t.items) > 0).length;

  return (
    <>
      <main className="mx-auto max-w-7xl px-4 py-6">
        <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Salón</h1>
            <p className="text-sm text-[var(--color-muted)]">
              {ocupadas} de {tables.length} mesas ocupadas
              {conComanda > 0 ? (
                <span className="text-[var(--color-accent)]">
                  {" · "}
                  {conComanda} con comanda pendiente
                </span>
              ) : null}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs tracking-wide text-[var(--color-muted)] uppercase">
              Sin cobrar
            </p>
            <p className="text-xl font-semibold tabular-nums">
              {formatMoney(enSalon)}
            </p>
          </div>
        </header>

        {error ? (
          <p
            role="alert"
            className="mb-4 rounded-lg border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-3 py-2 text-sm text-[var(--color-danger)]"
          >
            {error}
          </p>
        ) : null}

        {notice ? (
          <p
            role="status"
            className="mb-4 rounded-lg border border-[var(--color-busy)]/40 bg-[var(--color-busy)]/10 px-3 py-2 text-sm text-[var(--color-busy)]"
          >
            {notice}
          </p>
        ) : null}

        {!hasOpenShift ? (
          // Se avisa acá y no recién al cobrar: enterarse con la mesa esperando
          // y el ticket en la mano es la peor forma de descubrirlo.
          <p className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-[var(--color-busy)]/40 bg-[var(--color-busy)]/10 px-3 py-2 text-sm text-[var(--color-busy)]">
            La caja está cerrada: se puede tomar pedidos, pero no cobrar.
            <Link
              href="/admin/caja"
              className="rounded-lg border border-[var(--color-busy)]/60 px-2.5 py-1 font-medium transition-colors hover:bg-[var(--color-busy)]/20"
            >
              Abrir caja
            </Link>
          </p>
        ) : null}

        {tabs.length > 1 ? (
          <div className="mb-3 flex flex-wrap items-center gap-1">
            {tabs.map((tab) => {
              const cuantas = tables.filter(
                (t) => t.table.sector_id === tab.id
              ).length;

              return (
                <button
                  key={tab.id ?? "sin-sector"}
                  type="button"
                  onClick={() => setSectorId(tab.id)}
                  className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                    tab.id === sectorId
                      ? "bg-[var(--color-surface-2)] text-[var(--color-ink)]"
                      : "text-[var(--color-muted)] hover:text-[var(--color-ink)]"
                  }`}
                >
                  {tab.name}
                  <span className="ml-1.5 text-xs text-[var(--color-muted)]">
                    {cuantas}
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}

        <div
          ref={wrapRef}
          // El escalado es una transformación y no encoge la caja: sin fijarle
          // la altura, el plano deja un hueco enorme debajo.
          style={{ height: CANVAS_H * scale }}
          className="overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]"
        >
          <div
            className="relative origin-top-left"
            style={{
              width: CANVAS_W,
              height: CANVAS_H,
              transform: `scale(${scale})`,
            }}
          >
            {tables
              .filter((detail) => detail.table.sector_id === sectorId)
              .map((detail) => (
                <FloorTableCard
                  key={detail.table.id}
                  detail={detail}
                  waiterName={
                    detail.table.assigned_waiter
                      ? waiters[detail.table.assigned_waiter]
                      : undefined
                  }
                  alerts={pendingAlerts[detail.table.id] ?? []}
                  onSelect={() => {
                    setError(null);
                    setSelectedId(detail.table.id);
                  }}
                />
              ))}
          </div>
        </div>
      </main>

      {selected ? (
        <TablePanel
          key={selected.table.id}
          detail={selected}
          products={products}
          waiterName={
            selected.table.assigned_waiter
              ? waiters[selected.table.assigned_waiter]
              : undefined
          }
          isMine={selected.table.assigned_waiter === currentUserId}
          hasOpenShift={hasOpenShift}
          onClose={() => setSelectedId(null)}
          onError={setError}
        />
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------

function FloorTableCard({
  detail,
  waiterName,
  alerts,
  onSelect,
}: {
  detail: TableDetail;
  waiterName?: string;
  alerts: AlertType[];
  onSelect: () => void;
}) {
  const { table, order, items } = detail;
  const ocupada = table.status === "ocupada";
  // Tres estados por color, como los ve el encargado de lejos: libre, abierta,
  // y abierta con algo que barra o cocina todavía no entregaron.
  const pendientes = pendientesDe(items);

  const tono = !ocupada
    ? "border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-muted)] hover:border-[var(--color-free)]"
    : pendientes > 0
      ? "border-[var(--color-accent)] bg-[var(--color-accent)]/15 text-[var(--color-ink)]"
      : "border-[var(--color-busy)] bg-[var(--color-busy)]/15 text-[var(--color-ink)]";

  return (
    <FloorTable
      table={table}
      label={`Mesa ${table.number}`}
      title={
        waiterName ? `Mesa ${table.number} · atiende ${waiterName}` : undefined
      }
      className={`cursor-pointer transition-all hover:brightness-125 ${tono}`}
      onClick={onSelect}
    >
      {alerts.length > 0 ? (
        <span className="mb-0.5 flex items-center gap-1 rounded-full bg-[var(--color-danger)] px-1.5 text-[10px] font-bold text-white">
          <span className="inline-block size-1.5 animate-ping rounded-full bg-white" />
          {alerts.length}
        </span>
      ) : null}

      <span className="text-xl leading-none font-bold tabular-nums">
        {table.number}
      </span>

      {ocupada && order ? (
        <span className="mt-0.5 text-xs font-medium tabular-nums">
          {formatMoney(order.total)}
        </span>
      ) : (
        <span className="mt-0.5 text-[10px] opacity-70">{table.seats} 🪑</span>
      )}

      {pendientes > 0 ? (
        <span className="mt-0.5 text-[10px] font-medium text-[var(--color-accent)]">
          {pendientes} sin entregar
        </span>
      ) : null}
    </FloorTable>
  );
}

// ---------------------------------------------------------------------------

function TablePanel({
  detail,
  products,
  waiterName,
  isMine,
  hasOpenShift,
  onClose,
  onError,
}: {
  detail: TableDetail;
  products: Product[];
  waiterName?: string;
  isMine: boolean;
  hasOpenShift: boolean;
  onClose: () => void;
  onError: (msg: string | null) => void;
}) {
  const { table, order, items } = detail;
  const [isPending, startTransition] = useTransition();
  const [category, setCategory] = useState<ProductCategory | "todos">("todos");
  const [search, setSearch] = useState("");
  const [confirmingClose, setConfirmingClose] = useState(false);

  useEffect(() => {
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [onClose]);

  function run(fn: () => Promise<{ error: string | null }>) {
    onError(null);
    startTransition(async () => {
      const result = await fn();
      if (result.error) onError(result.error);
    });
  }

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return products.filter(
      (p) =>
        (category === "todos" || p.category === category) &&
        (term === "" || p.name.toLowerCase().includes(term))
    );
  }, [products, category, search]);

  const total = order?.total ?? 0;
  const unidades = items.reduce((n, i) => n + i.quantity, 0);

  function cobrar(method: PaymentMethod) {
    if (!order) return;
    run(async () => {
      const result = await closeOrder(order.id, method);
      if (!result.error) onClose();
      return result;
    });
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div
        role="presentation"
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`Mesa ${table.number}`}
        className="relative flex h-full w-full flex-col border-l border-[var(--color-border)] bg-[var(--color-bg)] shadow-2xl sm:max-w-xl"
      >
        {/* Encabezado */}
        <header className="flex items-center gap-3 border-b border-[var(--color-border)] px-5 py-4">
          <div>
            <h2 className="text-xl font-semibold">Mesa {table.number}</h2>
            <p className="text-xs text-[var(--color-muted)]">
              {table.status === "ocupada" ? "Ocupada" : "Libre"}
              {waiterName ? ` · atiende ${waiterName}` : ""}
            </p>
          </div>

          <button
            type="button"
            onClick={() => run(() => toggleTableAssignment(table.id))}
            disabled={isPending}
            className={`ml-auto rounded-lg border px-3 py-1.5 text-sm transition-colors disabled:opacity-50 ${
              isMine
                ? "border-[var(--color-accent)] text-[var(--color-accent)]"
                : "border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-ink)]"
            }`}
          >
            {isMine ? "Soltar mesa" : "Tomar mesa"}
          </button>

          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar panel"
            className="rounded-lg px-2.5 py-1.5 text-[var(--color-muted)] transition-colors hover:text-[var(--color-ink)]"
          >
            ✕
          </button>
        </header>

        {/* Cuenta */}
        <div className="max-h-[38%] overflow-y-auto border-b border-[var(--color-border)] px-5 py-3">
          {items.length === 0 ? (
            <p className="py-6 text-center text-sm text-[var(--color-muted)]">
              La mesa todavía no tiene consumos.
            </p>
          ) : (
            <ul className="grid gap-1.5">
              {items.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-[var(--color-surface)]"
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 truncate text-sm">
                      {item.product?.name ?? "Producto eliminado"}
                      {item.status !== "listo" ? (
                        <span
                          className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] tracking-wide uppercase ${
                            item.status === "preparando"
                              ? "bg-[var(--color-busy)]/20 text-[var(--color-busy)]"
                              : "bg-[var(--color-surface-2)] text-[var(--color-muted)]"
                          }`}
                        >
                          {item.status === "pedido"
                            ? "pedido"
                            : item.station === "cocina"
                              ? "en cocina"
                              : "en barra"}
                        </span>
                      ) : null}
                    </p>
                    <p className="text-xs text-[var(--color-muted)] tabular-nums">
                      {item.quantity} × {formatMoney(item.unit_price)}
                    </p>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      aria-label="Restar una unidad"
                      disabled={isPending}
                      onClick={() => run(() => changeItemQuantity(item.id, -1))}
                      className="size-8 rounded-lg border border-[var(--color-border)] text-[var(--color-muted)] transition-colors hover:text-[var(--color-ink)] disabled:opacity-50"
                    >
                      −
                    </button>
                    <span className="w-7 text-center text-sm tabular-nums">
                      {item.quantity}
                    </span>
                    <button
                      type="button"
                      aria-label="Sumar una unidad"
                      disabled={isPending}
                      onClick={() => run(() => changeItemQuantity(item.id, 1))}
                      className="size-8 rounded-lg border border-[var(--color-border)] text-[var(--color-muted)] transition-colors hover:text-[var(--color-ink)] disabled:opacity-50"
                    >
                      +
                    </button>
                  </div>

                  <span className="w-20 text-right text-sm font-medium tabular-nums">
                    {formatMoney(item.subtotal)}
                  </span>

                  <button
                    type="button"
                    aria-label="Quitar de la cuenta"
                    disabled={isPending}
                    onClick={() => run(() => removeItem(item.id))}
                    className="rounded-lg px-1.5 py-1 text-sm text-[var(--color-muted)] transition-colors hover:text-[var(--color-danger)] disabled:opacity-50"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Catálogo */}
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-2 px-5 py-3">
            <div className="flex gap-1">
              <CategoryTab
                active={category === "todos"}
                onClick={() => setCategory("todos")}
              >
                Todo
              </CategoryTab>
              {CATEGORIES.map((c) => (
                <CategoryTab
                  key={c}
                  active={category === c}
                  onClick={() => setCategory(c)}
                >
                  {CATEGORY_LABELS[c]}
                </CategoryTab>
              ))}
            </div>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar…"
              className="ml-auto w-32 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-1.5 text-sm outline-none focus:border-[var(--color-accent)]"
            />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
            {visible.length === 0 ? (
              <p className="py-8 text-center text-sm text-[var(--color-muted)]">
                No hay productos que coincidan.
              </p>
            ) : (
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {visible.map((product) => (
                  <li key={product.id}>
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() =>
                        run(() => addProductToTable(table.id, product.id))
                      }
                      className="flex h-full w-full flex-col items-start gap-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-left transition-colors hover:border-[var(--color-accent)] active:bg-[var(--color-surface-2)] disabled:opacity-50"
                    >
                      <span className="text-sm leading-tight">{product.name}</span>
                      <span className="mt-auto text-sm font-semibold tabular-nums text-[var(--color-accent)]">
                        {formatMoney(product.price)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Cierre de mesa */}
        <footer className="border-t border-[var(--color-border)] px-5 py-4">
          <div className="mb-3 flex items-end justify-between">
            <span className="text-sm text-[var(--color-muted)]">
              Total {unidades > 0 ? `· ${unidades} ítems` : ""}
            </span>
            <span className="text-2xl font-semibold tabular-nums">
              {formatMoney(total)}
            </span>
          </div>

          {!order || items.length === 0 ? (
            table.status === "ocupada" ? (
              // Mesa abierta sin consumos: no se puede cobrar, pero tampoco
              // puede quedar ocupada para siempre.
              <div className="grid gap-2">
                <p className="text-center text-sm text-[var(--color-muted)]">
                  Cargá productos para poder cobrar.
                </p>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() =>
                    run(async () => {
                      const result = await releaseEmptyTable(table.id);
                      if (!result.error) onClose();
                      return result;
                    })
                  }
                  className="w-full rounded-xl border border-[var(--color-border)] px-4 py-3 text-sm text-[var(--color-muted)] transition-colors hover:border-[var(--color-danger)] hover:text-[var(--color-danger)] disabled:opacity-50"
                >
                  Liberar mesa sin cobrar
                </button>
              </div>
            ) : (
              <button
                type="button"
                disabled={isPending}
                onClick={() => run(() => openTable(table.id))}
                className="w-full rounded-xl border border-[var(--color-border)] px-4 py-3 text-sm text-[var(--color-muted)] disabled:opacity-40"
              >
                Abrir mesa
              </button>
            )
          ) : confirmingClose ? (
            <div className="grid gap-2">
              <p className="text-center text-sm text-[var(--color-muted)]">
                {isPending ? "Cobrando…" : "¿Con qué paga?"}
              </p>
              <div className="grid grid-cols-2 gap-2">
                {PAYMENT_METHODS.map((method) => (
                  <button
                    key={method}
                    type="button"
                    disabled={isPending}
                    onClick={() => cobrar(method)}
                    className={`rounded-xl px-4 py-3.5 text-sm font-semibold disabled:opacity-50 ${
                      method === "efectivo"
                        ? "bg-[var(--color-free)] text-[#04140a]"
                        : "border border-[var(--color-border)] transition-colors hover:border-[var(--color-free)]"
                    }`}
                  >
                    {PAYMENT_LABELS[method]}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setConfirmingClose(false)}
                disabled={isPending}
                className="rounded-xl px-4 py-2.5 text-sm text-[var(--color-muted)] transition-colors hover:text-[var(--color-ink)] disabled:opacity-50"
              >
                Cancelar
              </button>
            </div>
          ) : hasOpenShift ? (
            <button
              type="button"
              disabled={isPending}
              onClick={() => setConfirmingClose(true)}
              className="w-full rounded-xl bg-[var(--color-accent)] px-4 py-3.5 font-semibold text-[#04121c] disabled:opacity-50"
            >
              Cobrar y cerrar mesa
            </button>
          ) : (
            <div className="grid gap-2">
              <button
                type="button"
                disabled
                className="w-full cursor-not-allowed rounded-xl bg-[var(--color-surface-2)] px-4 py-3.5 font-semibold text-[var(--color-muted)]"
              >
                Cobrar y cerrar mesa
              </button>
              <p className="text-center text-xs text-[var(--color-busy)]">
                Hay que abrir la caja antes de cobrar.
              </p>
            </div>
          )}
        </footer>
      </aside>
    </div>
  );
}

function CategoryTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
        active
          ? "bg-[var(--color-surface-2)] text-[var(--color-ink)]"
          : "text-[var(--color-muted)] hover:text-[var(--color-ink)]"
      }`}
    >
      {children}
    </button>
  );
}
