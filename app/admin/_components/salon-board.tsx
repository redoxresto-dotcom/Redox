"use client";

import {
  useEffect,
  useMemo,
  useOptimistic,
  useRef,
  useState,
  useTransition,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { FloorTable } from "./floor-table";
import { CANVAS_H, CANVAS_W, fitScale } from "@/lib/floor";
import {
  addProductToTable,
  cancelOrder,
  deliverItem,
  deliverTable,
  changeItemQuantity,
  closeOrder,
  openTable,
  releaseTable,
  removeItem,
  takeTable,
  transferTable,
} from "../actions";
import {
  CATEGORY_LABELS,
  formatMoney,
  hasRank,
  PAYMENT_LABELS,
  PAYMENT_METHODS,
  type PaymentMethod,
  type AlertType,
  type OrderItemWithProduct,
  type Product,
  type ProductCategory,
  type Sector,
  type StaffRole,
  type TableDetail,
} from "@/lib/types";

/** Cómo se dibuja el salón. */
type Vista = "plano" | "grilla";

const VISTA_KEY = "pos-vista-salon";

/**
 * Cuatro estados por color, como los ve el encargado desde lejos.
 *
 * El verde es el pedido completo: barra y cocina terminaron todo lo de esa
 * mesa y está esperando que el mozo lo levante. Mientras falte algo en una
 * estación la mesa sigue celeste, aunque ya haya cosas prontas: media comanda
 * pronta no es una bandeja para llevar.
 */
type EstadoMesa = "libre" | "abierta" | "preparando" | "pronto";

function estadoDeMesa(detail: TableDetail): EstadoMesa {
  if (detail.table.status !== "ocupada") return "libre";

  const { enEstacion, porEntregar } = comandaDe(detail.items);
  if (enEstacion > 0) return "preparando";
  if (porEntregar > 0) return "pronto";
  return "abierta";
}

/*
 * Estos bordes de color no son decoración: son la señal de estado que se lee
 * desde lejos (ver el comentario de EstadoMesa arriba). Se mantienen aunque
 * el resto de la pantalla pase a vidrio sin bordes — "libre", que no exige
 * atención, sí pasa a vidrio liso.
 */
const TONO_TARJETA: Record<EstadoMesa, string> = {
  libre:
    "border-transparent bg-white/5 backdrop-blur-xl hover:bg-white/10",
  abierta:
    "border-[var(--color-busy)]/50 bg-[var(--color-busy)]/10 backdrop-blur-xl hover:border-[var(--color-busy)]",
  preparando:
    "border-[var(--color-accent)]/60 bg-[var(--color-accent)]/10 backdrop-blur-xl hover:border-[var(--color-accent)]",
  pronto:
    "border-[var(--color-free)] bg-[var(--color-free)]/15 backdrop-blur-xl hover:border-[var(--color-free)]",
};

const TONO_PLANO: Record<EstadoMesa, string> = {
  libre:
    "border-transparent bg-white/10 text-[var(--color-muted)] backdrop-blur-xl hover:bg-white/15",
  abierta:
    "border-[var(--color-busy)] bg-[var(--color-busy)]/15 text-[var(--color-ink)] backdrop-blur-xl",
  preparando:
    "border-[var(--color-accent)] bg-[var(--color-accent)]/15 text-[var(--color-ink)] backdrop-blur-xl",
  pronto:
    "border-[var(--color-free)] bg-[var(--color-free)]/20 text-[var(--color-ink)] backdrop-blur-xl",
};

const PUNTO: Record<EstadoMesa, string> = {
  libre: "bg-[var(--color-free)]",
  abierta: "bg-[var(--color-busy)]",
  preparando: "animate-pulse bg-[var(--color-accent)]",
  pronto: "animate-pulse bg-[var(--color-free)]",
};

/**
 * Los dos pendientes de una mesa, que son cosas distintas:
 *
 *   enEstacion  → la barra o la cocina todavía lo tienen
 *   porEntregar → está pronto sobre la barra esperando al mozo
 *
 * Cuando no queda nada en estación y sí hay algo por entregar, el pedido está
 * completo: es el cartel verde.
 */
function comandaDe(items: OrderItemWithProduct[]) {
  const enEstacion = items.filter(
    (i) => i.status === "pedido" || i.status === "preparando",
  ).length;
  const porEntregar = items.filter((i) => i.status === "listo").length;

  return {
    enEstacion,
    porEntregar,
    completo: enEstacion === 0 && porEntregar > 0,
  };
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
  /** Nivel de quien mira: decide con qué vista arranca la pantalla. */
  role: StaffRole;
  /**
   * "salon": las mesas libres más las propias (el encargado ve todas).
   * "mias": solo las que tomó quien está mirando.
   */
  scope?: "salon" | "mias";
  /** Personal activo al que se le puede pasar una mesa. */
  staff: { id: string; full_name: string }[];
  /** Motivo por el que la pantalla anterior lo mandó para acá, si lo hubo. */
  notice?: string | null;
  /** Mesas que además son mesas de pool: se marcan en el tablero. */
  poolTableIds: string[];
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
  role,
  scope = "salon",
  staff,
  notice,
  poolTableIds,
}: Props) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const poolSet = useMemo(() => new Set(poolTableIds), [poolTableIds]);

  // Mesas que quedaron sin sector: mejor una pestaña de más que una mesa que
  // no aparece en ninguna pantalla.
  const huerfanas = tables.some((t) => t.table.sector_id === null);
  const tabs: { id: string | null; name: string }[] = [
    ...sectors.map((s) => ({ id: s.id as string | null, name: s.name })),
    ...(huerfanas ? [{ id: null, name: "Sin sector" }] : []),
  ];

  const [sectorId, setSectorId] = useState<string | null>(tabs[0]?.id ?? null);

  /**
   * Vista por defecto según el nivel.
   *
   * El plano es una herramienta de quien maneja el salón desde una pantalla
   * fija: sirve para ubicar la mesa en el espacio. El mozo la mira desde el
   * celular, en movimiento, y lo que necesita es encontrar la mesa 7 rápido,
   * no ubicarla contra la ventana. Cada uno arranca con lo suyo y puede
   * cambiar; la elección queda guardada en ese dispositivo.
   */
  const [vista, setVista] = useState<Vista>(
    hasRank(role, "admin") ? "plano" : "grilla",
  );

  // Se lee después del primer render a propósito: el servidor no conoce el
  // localStorage y pintar distinto de lo que ya está en pantalla rompe la
  // hidratación.
  useEffect(() => {
    const guardada = window.localStorage.getItem(VISTA_KEY);
    if (guardada === "plano" || guardada === "grilla") setVista(guardada);
  }, []);

  function cambiarVista(next: Vista) {
    setVista(next);
    window.localStorage.setItem(VISTA_KEY, next);
  }

  // El plano se guarda en unidades fijas y cada pantalla lo escala a su ancho:
  // el mismo salón se ve igual en el monitor de la caja y en la tablet.
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setScale(fitScale(entry.contentRect.width));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [vista]);

  const selected = useMemo(
    () => tables.find((t) => t.table.id === selectedId) ?? null,
    [tables, selectedId],
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
        () => router.refresh(),
      )
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

  // Si se cobró la mesa abierta en el panel, cerrarlo.
  useEffect(() => {
    if (selectedId && !tables.some((t) => t.table.id === selectedId)) {
      setSelectedId(null);
    }
  }, [tables, selectedId]);

  const esEncargado = hasRank(role, "admin");

  /**
   * Una mesa tomada desaparece del salón de los demás mozos: dos mozos sobre la
   * misma mesa es la forma más rápida de duplicar un pedido. El encargado sigue
   * viendo todo, porque es quien tiene que destrabar cuando algo se traba.
   */
  const delTurno = tables.filter(({ table }) => {
    if (scope === "mias") return table.assigned_waiter === currentUserId;
    if (esEncargado) return true;
    return (
      table.assigned_waiter === null || table.assigned_waiter === currentUserId
    );
  });

  const visibles = delTurno.filter((t) => t.table.sector_id === sectorId);
  const ocupadas = delTurno.filter((t) => t.table.status === "ocupada").length;
  const enSalon = delTurno.reduce((sum, t) => sum + (t.order?.total ?? 0), 0);
  const enPreparacion = delTurno.filter(
    (t) => comandaDe(t.items).enEstacion > 0,
  ).length;
  const prontas = delTurno.filter((t) => comandaDe(t.items).completo).length;

  return (
    <>
      <main className="mx-auto max-w-7xl px-4 py-6">
        <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">
              {scope === "mias" ? "Mis mesas" : "Salón"}
            </h1>
            <p className="text-sm text-[var(--color-muted)]">
              {ocupadas} de {delTurno.length} mesas ocupadas
              {enPreparacion > 0 ? (
                <span className="text-[var(--color-accent)]">
                  {" · "}
                  {enPreparacion} en preparación
                </span>
              ) : null}
              {prontas > 0 ? (
                <span className="font-medium text-[var(--color-free)]">
                  {" · "}
                  {prontas} {prontas === 1 ? "pronta" : "prontas"} para llevar
                </span>
              ) : null}
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex rounded-lg bg-white/5 p-0.5 backdrop-blur-md">
              {(["plano", "grilla"] as Vista[]).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => cambiarVista(v)}
                  className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                    vista === v
                      ? "bg-[var(--color-surface-2)] text-[var(--color-ink)]"
                      : "text-[var(--color-muted)] hover:text-[var(--color-ink)]"
                  }`}
                >
                  {v === "plano" ? "Plano" : "Lista"}
                </button>
              ))}
            </div>

            <div className="text-right">
              <p className="text-xs tracking-wide text-[var(--color-muted)] uppercase">
                Sin cobrar
              </p>
              <p className="text-xl font-semibold tabular-nums">
                {formatMoney(enSalon)}
              </p>
            </div>
          </div>
        </header>

        {error ? (
          <p
            role="alert"
            className="mb-4 rounded-lg bg-[var(--color-danger)]/15 px-3 py-2 text-sm text-[var(--color-danger)] backdrop-blur-md"
          >
            {error}
          </p>
        ) : null}

        {notice ? (
          <p
            role="status"
            className="mb-4 rounded-lg bg-[var(--color-busy)]/15 px-3 py-2 text-sm text-[var(--color-busy)] backdrop-blur-md"
          >
            {notice}
          </p>
        ) : null}

        {!hasOpenShift ? (
          // Se avisa acá y no recién al cobrar: enterarse con la mesa esperando
          // y el ticket en la mano es la peor forma de descubrirlo.
          <p className="mb-4 flex flex-wrap items-center gap-2 rounded-lg bg-[var(--color-busy)]/15 px-3 py-2 text-sm text-[var(--color-busy)] backdrop-blur-md">
            La caja está cerrada: se puede tomar pedidos, pero no cobrar.
            <Link
              href="/admin/caja"
              className="rounded-lg bg-[var(--color-busy)]/20 px-2.5 py-1 font-medium backdrop-blur-md transition-colors hover:bg-[var(--color-busy)]/30"
            >
              Abrir caja
            </Link>
          </p>
        ) : null}

        {tabs.length > 1 ? (
          <div className="mb-3 flex flex-wrap items-center gap-1">
            {tabs.map((tab) => {
              const cuantas = delTurno.filter(
                (t) => t.table.sector_id === tab.id,
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

        {delTurno.length === 0 ? (
          <p className="rounded-2xl bg-white/5 px-4 py-12 text-center text-sm text-[var(--color-muted)] backdrop-blur-xl">
            {scope === "mias"
              ? "Todavía no tomaste ninguna mesa. Tomalas desde el salón."
              : "No hay mesas libres en este momento."}
          </p>
        ) : vista === "grilla" ? (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {visibles.map((detail) => (
              <li key={detail.table.id}>
                <GridTableCard
                  detail={detail}
                  waiterName={
                    detail.table.assigned_waiter
                      ? waiters[detail.table.assigned_waiter]
                      : undefined
                  }
                  alerts={pendingAlerts[detail.table.id] ?? []}
                  isPool={poolSet.has(detail.table.id)}
                  onSelect={() => {
                    setError(null);
                    setSelectedId(detail.table.id);
                  }}
                />
              </li>
            ))}
          </ul>
        ) : (
          <div
            ref={wrapRef}
            // El escalado es una transformación y no encoge la caja: sin fijarle
            // la altura, el plano deja un hueco enorme debajo.
            //
            // overflow-x-auto, no overflow-hidden: por debajo de MIN_SCALE el
            // plano ya no achica más (ver fitScale) y queda más ancho que la
            // pantalla. Con overflow-hidden esa parte se recorta sin avisar —el
            // celular ve tres mesas y listo—; con scroll lateral, como en el
            // editor del plano, sigue estando, solo hay que desplazarse.
            style={{ height: CANVAS_H * scale }}
            className="overflow-x-auto rounded-2xl bg-white/5 backdrop-blur-xl"
          >
            {/* La escala es una transformación: no cambia el tamaño que el div
              ocupa en el layout. Sin esta caja intermedia con la medida ya
              escalada, en el celular queda medio ancho de plano vacío para
              desplazar al costado. */}
            <div style={{ width: CANVAS_W * scale, height: CANVAS_H * scale }}>
              <div
                className="relative origin-top-left"
                style={{
                  width: CANVAS_W,
                  height: CANVAS_H,
                  transform: `scale(${scale})`,
                }}
              >
                {visibles.map((detail) => (
                  <FloorTableCard
                    key={detail.table.id}
                    detail={detail}
                    waiterName={
                      detail.table.assigned_waiter
                        ? waiters[detail.table.assigned_waiter]
                        : undefined
                    }
                    alerts={pendingAlerts[detail.table.id] ?? []}
                    isPool={poolSet.has(detail.table.id)}
                    onSelect={() => {
                      setError(null);
                      setSelectedId(detail.table.id);
                    }}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
      </main>

      {selected ? (
        <TablePanel
          key={selected.table.id}
          detail={selected}
          products={products}
          isMine={selected.table.assigned_waiter === currentUserId}
          isManager={esEncargado}
          isPool={poolSet.has(selected.table.id)}
          staff={staff.filter((p) => p.id !== selected.table.assigned_waiter)}
          waiterName={
            selected.table.assigned_waiter
              ? waiters[selected.table.assigned_waiter]
              : undefined
          }
          hasOpenShift={hasOpenShift}
          onClose={() => setSelectedId(null)}
          onError={setError}
        />
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------

/**
 * La mesa como tarjeta, para la vista de lista.
 *
 * Es la que ve el mozo por defecto: en un celular, una grilla de tarjetas
 * grandes se lee y se toca mejor que un plano al que hay que hacerle zoom.
 */
function GridTableCard({
  detail,
  waiterName,
  alerts,
  isPool,
  onSelect,
}: {
  detail: TableDetail;
  waiterName?: string;
  alerts: AlertType[];
  isPool: boolean;
  onSelect: () => void;
}) {
  const { table, order, items } = detail;
  const ocupada = table.status === "ocupada";
  const unidades = items.reduce((n, i) => n + i.quantity, 0);
  const comanda = comandaDe(items);
  const estado = estadoDeMesa(detail);

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`relative flex h-full w-full flex-col items-start gap-1 rounded-2xl border p-4 text-left transition-all hover:-translate-y-0.5 ${TONO_TARJETA[estado]}`}
    >
      {alerts.length > 0 ? (
        <span
          aria-label="Mesa con llamado pendiente"
          className="absolute -top-1.5 -right-1.5 flex size-6 items-center justify-center rounded-full bg-[var(--color-danger)] text-xs font-bold text-white"
        >
          <span className="absolute inset-0 animate-ping rounded-full bg-[var(--color-danger)]/60" />
          <span className="relative">{alerts.length}</span>
        </span>
      ) : null}

      <div className="flex w-full items-center justify-between">
        <span className="flex items-baseline gap-1.5">
          <span className="text-2xl font-semibold tabular-nums">
            {table.number}
          </span>
          {table.name ? (
            <span className="truncate text-xs text-[var(--color-muted)]">
              {table.name}
            </span>
          ) : null}
          {isPool ? (
            <span
              title="Mesa de pool: el tiempo se vende desde Pool"
              className="shrink-0 rounded-full bg-[var(--color-accent)]/15 px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-accent)]"
            >
              🎱 Pool
            </span>
          ) : null}
        </span>
        <span className={`size-2.5 rounded-full ${PUNTO[estado]}`} />
      </div>

      {ocupada && order ? (
        <>
          <span className="text-lg font-medium tabular-nums">
            {formatMoney(order.total)}
          </span>
          <span className="text-xs text-[var(--color-muted)]">
            {unidades} {unidades === 1 ? "ítem" : "ítems"}
            {waiterName ? ` · ${waiterName}` : ""}
          </span>
          {estado === "pronto" ? (
            <span className="text-xs font-semibold text-[var(--color-free)]">
              Pedido completo
            </span>
          ) : comanda.enEstacion > 0 ? (
            <span className="text-xs font-medium text-[var(--color-accent)]">
              {comanda.enEstacion} en preparación
            </span>
          ) : null}
        </>
      ) : waiterName ? (
        // Tomada pero sin pedido todavía: sin esto, el encargado la ve
        // "libre" hasta que el mozo carga el primer producto.
        <span className="text-sm font-medium text-[var(--color-accent)]">
          Tomada · {waiterName}
        </span>
      ) : (
        <span className="text-sm text-[var(--color-muted)]">
          Libre · {table.seats} 🪑
        </span>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------

function FloorTableCard({
  detail,
  waiterName,
  alerts,
  isPool,
  onSelect,
}: {
  detail: TableDetail;
  waiterName?: string;
  alerts: AlertType[];
  isPool: boolean;
  onSelect: () => void;
}) {
  const { table, order, items } = detail;
  const ocupada = table.status === "ocupada";
  const comanda = comandaDe(items);
  const estado = estadoDeMesa(detail);
  const tono = TONO_PLANO[estado];

  return (
    <FloorTable
      table={table}
      label={`Mesa ${table.number}${isPool ? " (pool)" : ""}`}
      title={
        (isPool ? `Mesa de pool — el tiempo se vende desde Pool. ` : "") +
        (waiterName ? `Mesa ${table.number} · atiende ${waiterName}` : "")
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

      <span className="flex items-center gap-1 text-xl leading-none font-bold tabular-nums">
        {table.number}
        {isPool ? <span className="text-xs">🎱</span> : null}
      </span>
      {table.name ? (
        <span className="max-w-full truncate text-[10px] opacity-80">
          {table.name}
        </span>
      ) : null}

      {ocupada && order ? (
        <span className="mt-0.5 text-xs font-medium tabular-nums">
          {formatMoney(order.total)}
        </span>
      ) : waiterName ? (
        // Sin este texto fijo, solo se sabía quién la tomó pasando el mouse
        // por el tooltip — inútil en una pantalla táctil.
        <span className="mt-0.5 max-w-full truncate text-[10px] font-semibold">
          {waiterName}
        </span>
      ) : (
        <span className="mt-0.5 text-[10px] opacity-70">{table.seats} 🪑</span>
      )}

      {estado === "pronto" ? (
        <span className="mt-0.5 text-[10px] font-bold text-[var(--color-free)]">
          COMPLETO
        </span>
      ) : comanda.enEstacion > 0 ? (
        <span className="mt-0.5 text-[10px] font-medium text-[var(--color-accent)]">
          {comanda.enEstacion} en prep.
        </span>
      ) : null}
    </FloorTable>
  );
}

// ---------------------------------------------------------------------------

type ItemAction =
  | { type: "add"; product: Product }
  | { type: "quantity"; itemId: string; delta: number }
  | { type: "remove"; itemId: string };

/**
 * Adelanta en la pantalla lo que el RPC va a terminar dejando en la base, para
 * que tocar un producto (o el +/-, o la ✕) se sienta instantáneo en vez de
 * esperar la ida y vuelta a Supabase. Espeja a propósito las mismas reglas de
 * add_product_to_table / change_order_item_quantity (migraciones 032 y 033):
 * sumar sobre una línea ya en camino a la estación la haría invisible para
 * ella, así que esa unidad nueva abre su propia línea en vez de sumarse.
 *
 * Las líneas que crea acá son temporales (id "optimista-…") y se descartan
 * solas apenas la pantalla recibe la respuesta real del servidor.
 */
function itemsOptimistas(
  state: OrderItemWithProduct[],
  action: ItemAction,
): OrderItemWithProduct[] {
  switch (action.type) {
    case "add": {
      const { product } = action;
      const idx = state.findIndex(
        (i) => i.product_id === product.id && i.status === "pedido",
      );
      if (idx !== -1) {
        const item = state[idx];
        const quantity = item.quantity + 1;
        const actualizado = {
          ...item,
          quantity,
          subtotal: quantity * item.unit_price,
        };
        return state.map((i, n) => (n === idx ? actualizado : i));
      }

      const nuevo: OrderItemWithProduct = {
        id: `optimista-${product.id}-${Date.now()}`,
        order_id: "",
        product_id: product.id,
        quantity: 1,
        unit_price: product.price,
        unit_cost: product.cost,
        subtotal: product.price,
        station: product.station,
        status: "pedido",
        started_at: null,
        ready_at: null,
        delivered_at: null,
        started_by: null,
        ready_by: null,
        delivered_by: null,
        created_by: null,
        created_at: new Date().toISOString(),
        product: {
          id: product.id,
          name: product.name,
          category: product.category,
        },
      };
      return [...state, nuevo];
    }

    case "quantity": {
      const idx = state.findIndex((i) => i.id === action.itemId);
      if (idx === -1) return state;
      const item = state[idx];

      if (action.delta > 0 && item.status !== "pedido") {
        const nuevo: OrderItemWithProduct = {
          ...item,
          id: `optimista-${item.product_id}-${Date.now()}`,
          quantity: action.delta,
          subtotal: action.delta * item.unit_price,
          status: "pedido",
          started_at: null,
          ready_at: null,
          delivered_at: null,
        };
        return [...state, nuevo];
      }

      const next = item.quantity + action.delta;
      if (next <= 0) return state.filter((_, n) => n !== idx);
      const actualizado = {
        ...item,
        quantity: next,
        subtotal: next * item.unit_price,
      };
      return state.map((i, n) => (n === idx ? actualizado : i));
    }

    case "remove":
      return state.filter((i) => i.id !== action.itemId);

    default:
      return state;
  }
}

function TablePanel({
  detail,
  products,
  waiterName,
  isMine,
  isManager,
  isPool,
  staff,
  hasOpenShift,
  onClose,
  onError,
}: {
  detail: TableDetail;
  products: Product[];
  waiterName?: string;
  isMine: boolean;
  isManager: boolean;
  isPool: boolean;
  staff: { id: string; full_name: string }[];
  hasOpenShift: boolean;
  onClose: () => void;
  onError: (msg: string | null) => void;
}) {
  const { table, order, items } = detail;
  const [isPending, startTransition] = useTransition();
  const [optimisticItems, applyOptimistic] = useOptimistic(
    items,
    itemsOptimistas,
  );
  const [category, setCategory] = useState<ProductCategory | "todos">("todos");
  const [search, setSearch] = useState("");
  const [confirmingClose, setConfirmingClose] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [transfiriendo, setTransfiriendo] = useState(false);
  const router = useRouter();

  useEffect(() => {
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [onClose]);

  /**
   * `optimistic`, si se pasa, corre antes de mandar la acción al servidor:
   * es lo que hace sentir instantáneo el toque. El `router.refresh()` de acá
   * no espera al aviso en tiempo real (que puede tardar) para que quien tocó
   * el botón vea su propio cambio confirmado; las demás pantallas conectadas
   * lo siguen recibiendo por la suscripción de siempre.
   */
  function run(
    fn: () => Promise<{ error: string | null }>,
    optimistic?: () => void,
  ) {
    onError(null);
    startTransition(async () => {
      optimistic?.();
      const result = await fn();
      if (result.error) onError(result.error);
      router.refresh();
    });
  }

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return products.filter(
      (p) =>
        (category === "todos" || p.category === category) &&
        (term === "" || p.name.toLowerCase().includes(term)),
    );
  }, [products, category, search]);

  // Se suma desde los ítems (optimistas incluidos) en vez de leer order.total:
  // así el total refleja el toque al instante, sin esperar a que el trigger
  // de la base lo recalcule y la pantalla se entere por la vuelta del server.
  const total = optimisticItems.reduce((sum, i) => sum + i.subtotal, 0);
  const unidades = optimisticItems.reduce((n, i) => n + i.quantity, 0);
  const comanda = comandaDe(optimisticItems);

  function cobrar(method: PaymentMethod) {
    if (!order) return;
    run(async () => {
      const result = await closeOrder(order.id, method);
      if (!result.error) onClose();
      return result;
    });
  }

  function cancelar() {
    if (!order) return;
    run(async () => {
      const result = await cancelOrder(order.id, cancelReason);
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
        className="relative flex h-full w-full flex-col border-l border-white/10 bg-[var(--color-bg)]/80 shadow-2xl backdrop-blur-2xl sm:max-w-xl"
      >
        {/* Encabezado */}
        <header className="flex items-center gap-3 border-b border-white/10 px-5 py-4">
          <div>
            <h2 className="text-xl font-semibold">
              Mesa {table.number}
              {table.name ? (
                <span className="ml-1.5 text-sm font-normal text-[var(--color-muted)]">
                  {table.name}
                </span>
              ) : null}
            </h2>
            <p className="text-xs text-[var(--color-muted)]">
              {table.status === "ocupada" ? "Ocupada" : "Libre"}
              {waiterName ? ` · atiende ${waiterName}` : ""}
              {isPool ? (
                <>
                  {" · "}
                  <Link
                    href="/admin/pool"
                    className="text-[var(--color-accent)] underline-offset-2 hover:underline"
                  >
                    mesa de pool 🎱
                  </Link>
                </>
              ) : null}
            </p>
          </div>

          <div className="ml-auto flex items-center gap-2">
            {table.assigned_waiter === null ? (
              <button
                type="button"
                onClick={() =>
                  run(async () => {
                    const result = await takeTable(table.id);
                    // Tomarla la saca del salón de los demás: quien la tomó
                    // sigue en «Mis mesas», que es donde va a vivir de ahora
                    // en más.
                    if (!result.error) router.push("/admin/mis-mesas");
                    return result;
                  })
                }
                disabled={isPending}
                className="rounded-lg bg-white/5 px-3 py-1.5 text-sm text-[var(--color-muted)] backdrop-blur-md transition-colors hover:bg-white/10 hover:text-[var(--color-accent)] disabled:opacity-50"
              >
                Tomar mesa
              </button>
            ) : isMine || isManager ? (
              <button
                type="button"
                onClick={() => setTransfiriendo((t) => !t)}
                disabled={isPending || staff.length === 0}
                className={`rounded-lg px-3 py-1.5 text-sm backdrop-blur-md transition-colors disabled:opacity-50 ${
                  transfiriendo
                    ? "bg-[var(--color-accent)]/15 text-[var(--color-accent)]"
                    : "bg-white/5 text-[var(--color-muted)] hover:bg-white/10 hover:text-[var(--color-ink)]"
                }`}
              >
                Transferir
              </button>
            ) : null}
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar panel"
            className="rounded-lg px-2.5 py-1.5 text-[var(--color-muted)] transition-colors hover:text-[var(--color-ink)]"
          >
            ✕
          </button>
        </header>

        {transfiriendo ? (
          <div className="border-b border-white/10 bg-white/5 px-5 py-3 backdrop-blur-xl">
            <p className="mb-2 text-sm text-[var(--color-muted)]">
              ¿A quién le pasás la mesa {table.number}?
            </p>
            <div className="flex flex-wrap gap-2">
              {staff.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  disabled={isPending}
                  onClick={() =>
                    run(async () => {
                      const result = await transferTable(table.id, p.id);
                      if (!result.error) {
                        setTransfiriendo(false);
                        onClose();
                      }
                      return result;
                    })
                  }
                  className="rounded-lg bg-white/5 px-3 py-2 text-sm backdrop-blur-md transition-colors hover:bg-white/10 hover:text-[var(--color-accent)] disabled:opacity-50"
                >
                  {p.full_name}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {comanda.porEntregar > 0 ? (
          <div
            className={`flex flex-wrap items-center gap-3 border-b px-5 py-3 backdrop-blur-xl ${
              comanda.completo
                ? "border-[var(--color-free)]/40 bg-[var(--color-free)]/15"
                : "border-white/10 bg-white/5"
            }`}
          >
            <div>
              <p
                className={`font-semibold ${
                  comanda.completo ? "text-[var(--color-free)]" : ""
                }`}
              >
                {comanda.completo
                  ? "Pedido completo"
                  : `${comanda.porEntregar} pronto${comanda.porEntregar === 1 ? "" : "s"} para llevar`}
              </p>
              <p className="text-xs text-[var(--color-muted)]">
                {comanda.completo
                  ? "Salió todo: barra y cocina terminaron."
                  : `Falta${comanda.enEstacion === 1 ? "" : "n"} ${comanda.enEstacion} en preparación.`}
              </p>
            </div>

            <button
              type="button"
              disabled={isPending}
              onClick={() => run(() => deliverTable(table.id))}
              className="ml-auto rounded-lg bg-[var(--color-free)] px-4 py-2 text-sm font-semibold text-[#04140a] disabled:opacity-50"
            >
              Entregar {comanda.porEntregar === 1 ? "" : "todo"}
            </button>
          </div>
        ) : null}

        {/* Cuenta */}
        <div className="max-h-[38%] overflow-y-auto border-b border-white/10 px-5 py-3">
          {optimisticItems.length === 0 ? (
            <p className="py-6 text-center text-sm text-[var(--color-muted)]">
              La mesa todavía no tiene consumos.
            </p>
          ) : (
            <ul className="grid gap-1.5">
              {optimisticItems.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-[var(--color-surface)]"
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 truncate text-sm">
                      {item.product?.name ?? "Producto eliminado"}
                      {item.status === "listo" ? (
                        <button
                          type="button"
                          disabled={isPending}
                          onClick={() => run(() => deliverItem(item.id))}
                          className="shrink-0 rounded-full bg-[var(--color-free)]/20 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-[var(--color-free)] uppercase transition-colors hover:bg-[var(--color-free)]/30 disabled:opacity-50"
                        >
                          entregar
                        </button>
                      ) : item.status !== "entregado" ? (
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
                      onClick={() =>
                        run(
                          () => changeItemQuantity(item.id, -1),
                          () =>
                            applyOptimistic({
                              type: "quantity",
                              itemId: item.id,
                              delta: -1,
                            }),
                        )
                      }
                      className="size-8 rounded-lg bg-white/5 text-[var(--color-muted)] backdrop-blur-md transition-colors hover:bg-white/10 hover:text-[var(--color-ink)] disabled:opacity-50"
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
                      onClick={() =>
                        run(
                          () => changeItemQuantity(item.id, 1),
                          () =>
                            applyOptimistic({
                              type: "quantity",
                              itemId: item.id,
                              delta: 1,
                            }),
                        )
                      }
                      className="size-8 rounded-lg bg-white/5 text-[var(--color-muted)] backdrop-blur-md transition-colors hover:bg-white/10 hover:text-[var(--color-ink)] disabled:opacity-50"
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
                    onClick={() =>
                      run(
                        () => removeItem(item.id),
                        () => applyOptimistic({ type: "remove", itemId: item.id }),
                      )
                    }
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
              className="ml-auto w-32 rounded-lg bg-white/5 px-3 py-1.5 text-sm shadow-inner shadow-black/20 backdrop-blur-md outline-none focus:bg-white/10"
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
                        run(
                          () => addProductToTable(table.id, product.id),
                          () => applyOptimistic({ type: "add", product }),
                        )
                      }
                      className="flex h-full w-full flex-col items-start gap-1 rounded-xl bg-white/5 p-3 text-left backdrop-blur-md transition-colors hover:bg-white/10 active:bg-white/15 disabled:opacity-50"
                    >
                      <span className="text-sm leading-tight">
                        {product.name}
                      </span>
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
        <footer className="border-t border-white/10 px-5 py-4">
          <div className="mb-3 flex items-end justify-between">
            <span className="text-sm text-[var(--color-muted)]">
              Total {unidades > 0 ? `· ${unidades} ítems` : ""}
            </span>
            <span className="text-2xl font-semibold tabular-nums">
              {formatMoney(total)}
            </span>
          </div>

          {!order || optimisticItems.length === 0 ? (
            table.status === "ocupada" ? (
              // Mesa abierta sin consumos: no se puede cobrar, pero tampoco
              // puede quedar ocupada para siempre. Soltarla es del encargado.
              <div className="grid gap-2">
                <p className="text-center text-sm text-[var(--color-muted)]">
                  Cargá productos para poder cobrar.
                </p>
                {isManager ? (
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() =>
                      run(async () => {
                        const result = await releaseTable(table.id);
                        if (!result.error) onClose();
                        return result;
                      })
                    }
                    className="w-full rounded-xl bg-white/5 px-4 py-3 text-sm text-[var(--color-muted)] backdrop-blur-md transition-colors hover:bg-[var(--color-danger)]/15 hover:text-[var(--color-danger)] disabled:opacity-50"
                  >
                    Liberar mesa sin cobrar
                  </button>
                ) : (
                  <p className="text-center text-xs text-[var(--color-muted)]">
                    Si la abriste por error, avisale al encargado: soltar una
                    mesa sin cobrar es de él.
                  </p>
                )}
              </div>
            ) : (
              <button
                type="button"
                disabled={isPending}
                onClick={() => run(() => openTable(table.id))}
                className="w-full rounded-xl bg-white/5 px-4 py-3 text-sm text-[var(--color-muted)] backdrop-blur-md transition-colors hover:bg-white/10 disabled:opacity-40"
              >
                Abrir mesa
              </button>
            )
          ) : confirmingCancel ? (
            <div className="grid gap-2">
              <p className="text-center text-sm text-[var(--color-muted)]">
                {isPending
                  ? "Cancelando…"
                  : "Se cancela sin cobrar. Los consumos quedan igual en el histórico."}
              </p>
              <select
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                disabled={isPending}
                className="w-full rounded-lg bg-white/5 px-3 py-2 text-sm shadow-inner shadow-black/20 backdrop-blur-md outline-none focus:bg-white/10 disabled:opacity-50"
              >
                <option value="">Motivo (opcional)</option>
                <option value="Error al tomar el pedido">
                  Error al tomar el pedido
                </option>
                <option value="Error al tomar la mesa">
                  Error al tomar la mesa
                </option>
              </select>
              <button
                type="button"
                disabled={isPending}
                onClick={cancelar}
                className="w-full rounded-xl bg-[var(--color-danger)] px-4 py-3.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                Confirmar cancelación
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmingCancel(false);
                  setCancelReason("");
                }}
                disabled={isPending}
                className="rounded-xl px-4 py-2.5 text-sm text-[var(--color-muted)] transition-colors hover:text-[var(--color-ink)] disabled:opacity-50"
              >
                Volver
              </button>
            </div>
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
                    className={`rounded-xl px-4 py-3.5 text-sm font-semibold backdrop-blur-md disabled:opacity-50 ${
                      method === "efectivo"
                        ? "bg-[var(--color-free)] text-[#04140a]"
                        : "bg-white/5 transition-colors hover:bg-white/10"
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
          ) : (
            <div className="grid gap-2">
              {hasOpenShift ? (
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => setConfirmingClose(true)}
                  className="w-full rounded-xl bg-[var(--color-accent)] px-4 py-3.5 font-semibold text-[#04121c] disabled:opacity-50"
                >
                  Cobrar y cerrar mesa
                </button>
              ) : (
                <>
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
                </>
              )}

              <button
                type="button"
                disabled={isPending}
                onClick={() => setConfirmingCancel(true)}
                className="w-full rounded-xl bg-white/5 px-4 py-2.5 text-sm text-[var(--color-muted)] backdrop-blur-md transition-colors hover:bg-[var(--color-danger)]/15 hover:text-[var(--color-danger)] disabled:opacity-50"
              >
                Cancelar pedido
              </button>
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
