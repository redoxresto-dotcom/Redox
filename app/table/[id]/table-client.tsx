"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { callStaff } from "./actions";
import { RedoxFlask, RedoxMascotaFondo } from "../../_components/brand";
import {
  CATEGORY_LABELS,
  formatMoney,
  type AlertType,
  type MenuItem,
  type ProductCategory,
} from "@/lib/types";

type Props = {
  tableId: string;
  tableNumber: number;
  tableName: string | null;
  /** Llamados ya pendientes al abrir la página. */
  initialPending: AlertType[];
  /** La carta, ya filtrada por la vista pública. */
  menu: MenuItem[];
};

const BUTTONS: {
  type: AlertType;
  label: string;
  hint: string;
  icon: string;
  done: string;
}[] = [
  {
    type: "llamar_mozo",
    label: "Llamar al mozo",
    hint: "Para pedir algo o consultar",
    icon: "🔔",
    done: "El mozo ya viene",
  },
  {
    type: "pedir_cuenta",
    label: "Solicitar la cuenta",
    hint: "Te la llevamos a la mesa",
    icon: "🧾",
    done: "Preparando tu cuenta",
  },
];

export function TableClient({
  tableId,
  tableNumber,
  tableName,
  initialPending,
  menu,
}: Props) {
  const [pending, setPending] = useState<AlertType[]>(initialPending);
  const [error, setError] = useState<string | null>(null);
  const [isSending, startTransition] = useTransition();
  const [sendingType, setSendingType] = useState<AlertType | null>(null);
  const [verCarta, setVerCarta] = useState(false);

  // Cuando el mozo marca el llamado como atendido, el botón vuelve a habilitarse
  // solo: el cliente ve que lo atendieron sin tener que recargar.
  useEffect(() => {
    const supabase = getSupabaseBrowserClient();

    const channel = supabase
      .channel(`mesa-${tableId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "alerts",
          filter: `table_id=eq.${tableId}`,
        },
        (payload) => {
          const row = (payload.new ?? payload.old) as
            { type: AlertType; status: string } | undefined;
          if (!row) return;

          setPending((prev) => {
            const rest = prev.filter((t) => t !== row.type);
            if (payload.eventType === "DELETE") return rest;
            return row.status === "pendiente" ? [...rest, row.type] : rest;
          });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [tableId]);

  function send(type: AlertType) {
    if (pending.includes(type) || isSending) return;

    setError(null);
    setSendingType(type);
    setPending((prev) => [...prev, type]); // respuesta inmediata al toque

    startTransition(async () => {
      const result = await callStaff(tableId, type);
      setSendingType(null);

      if (!result.ok) {
        setPending((prev) => prev.filter((t) => t !== type));
        setError(result.error);
      }
    });
  }

  return (
    <>
      <RedoxMascotaFondo />

      <main className="relative z-10 mx-auto flex min-h-[100dvh] w-full max-w-md flex-col px-5 py-8">
        <header className="flex flex-col items-center text-center">
          <p
            className="text-4xl font-semibold tracking-tight text-[var(--color-brand-soft)] italic"
            style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}
          >
            Redox
          </p>

          {tableName ? (
            <div className="mt-5 flex flex-col items-center gap-1">
              <span className="text-sm tracking-[0.2em] text-[var(--color-muted)] uppercase">
                Mesa
              </span>
              <span className="text-4xl leading-none font-bold">
                {tableName}
              </span>
            </div>
          ) : (
            <div className="mt-5 flex items-baseline gap-3">
              <span className="text-sm tracking-[0.2em] text-[var(--color-muted)] uppercase">
                Mesa
              </span>
              <span className="text-6xl leading-none font-bold tabular-nums">
                {tableNumber}
              </span>
            </div>
          )}
        </header>

        {error ? (
          <p
            role="alert"
            className="mt-6 rounded-xl border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-4 py-3 text-center text-sm text-[var(--color-danger)]"
          >
            {error}
          </p>
        ) : null}

        <div className="mt-8 grid flex-1 content-center gap-4">
          {menu.length > 0 ? (
            <button
              type="button"
              onClick={() => setVerCarta(true)}
              className="flex min-h-36 w-full flex-col items-center justify-center gap-2 rounded-3xl border-2 border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-8 transition-colors active:bg-[var(--color-surface-2)]"
            >
              <span aria-hidden className="text-4xl">
                📖
              </span>
              <span className="text-xl font-semibold">Ver la carta</span>
              <span className="text-sm text-[var(--color-muted)]">
                Bebidas, comida y promos
              </span>
            </button>
          ) : null}

          {BUTTONS.map((button) => {
            const active = pending.includes(button.type);
            const busy = sendingType === button.type;

            return (
              <button
                key={button.type}
                type="button"
                onClick={() => send(button.type)}
                disabled={active || isSending}
                aria-live="polite"
                className={`flex min-h-36 w-full flex-col items-center justify-center gap-2 rounded-3xl border-2 px-6 py-8 transition-colors ${
                  active
                    ? "border-[var(--color-free)] bg-[var(--color-free)]/15"
                    : "border-[var(--color-border)] bg-[var(--color-surface)] active:bg-[var(--color-surface-2)]"
                } disabled:cursor-default`}
              >
                <span aria-hidden className="text-4xl">
                  {active ? "✓" : button.icon}
                </span>

                <span
                  className={`text-xl font-semibold ${
                    active ? "text-[var(--color-free)]" : ""
                  }`}
                >
                  {busy ? "Avisando…" : active ? button.done : button.label}
                </span>

                <span className="text-sm text-[var(--color-muted)]">
                  {active ? "Ya avisamos, aguardá un momento" : button.hint}
                </span>
              </button>
            );
          })}
        </div>

        {verCarta ? (
          <Carta menu={menu} onClose={() => setVerCarta(false)} />
        ) : null}

        <footer className="pt-8 text-center text-xs text-[var(--color-muted)]">
          {pending.length > 0
            ? "Podés guardar el teléfono, ya estamos en camino."
            : "Tocá un botón y un mozo se acerca a tu mesa."}
        </footer>
      </main>
    </>
  );
}

// ---------------------------------------------------------------------------

const ORDEN_CATEGORIAS: ProductCategory[] = ["bebida", "comida", "otro"];

/** Bajada de cada categoría en el selector. */
const SUBTITULO_CATEGORIA: Record<ProductCategory, string> = {
  bebida: "Opciones con y sin alcohol",
  comida: "Sabores para compartir",
  otro: "Más de la casa",
};

/** Ícono de cada categoría en el selector. */
const EMOJI_CATEGORIA: Record<ProductCategory, string> = {
  bebida: "🍸",
  comida: "🍽️",
  otro: "✦",
};

type Vista = ProductCategory | "promos";

/** Sin tildes ni mayúsculas, para que "maracuya" encuentre "maracuyá". */
function normalizar(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/**
 * La carta a pantalla completa.
 *
 * Se abre encima de los botones de llamado: quien abrió el QR para pedir la
 * cuenta tiene que seguir teniendo ese botón a un toque al cerrar.
 *
 * Dos pasos: primero se elige una categoría, después se ve su lista de
 * productos. Volver o cerrar con la ✕ o con Escape. El buscador, siempre a
 * la vista, se salta los dos pasos: mientras hay texto, se ve un resultado
 * plano de toda la carta sin importar la categoría.
 */
function Carta({ menu, onClose }: { menu: MenuItem[]; onClose: () => void }) {
  const [vista, setVista] = useState<Vista | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [detalle, setDetalle] = useState<MenuItem | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const promos = menu.filter((i) => i.is_combo);
  const grupos = ORDEN_CATEGORIAS.map((categoria) => ({
    categoria,
    items: menu.filter((i) => i.category === categoria && !i.is_combo),
  })).filter((g) => g.items.length > 0);

  const termino = normalizar(busqueda.trim());
  const buscando = termino.length > 0;
  const resultados = buscando
    ? menu.filter(
        (i) =>
          normalizar(i.name).includes(termino) ||
          (i.description && normalizar(i.description).includes(termino)),
      )
    : [];

  const categorias: {
    id: Vista;
    titulo: string;
    sub: string;
    emoji: string;
    cuenta: number;
  }[] = [
    ...(promos.length > 0
      ? [
          {
            id: "promos" as Vista,
            titulo: "Promos",
            sub: "Lo destacado de la casa",
            emoji: "★",
            cuenta: promos.length,
          },
        ]
      : []),
    ...grupos.map((g) => ({
      id: g.categoria as Vista,
      titulo: CATEGORY_LABELS[g.categoria],
      sub: SUBTITULO_CATEGORIA[g.categoria],
      emoji: EMOJI_CATEGORIA[g.categoria],
      cuenta: g.items.length,
    })),
  ];

  const items =
    vista === "promos"
      ? promos
      : vista
        ? (grupos.find((g) => g.categoria === vista)?.items ?? [])
        : [];
  const tituloVista = categorias.find((c) => c.id === vista)?.titulo ?? "";

  // Escape: primero cierra el detalle, después borra la búsqueda, después
  // vuelve al selector, después cierra la carta.
  useEffect(() => {
    function onEsc(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (detalle) setDetalle(null);
      else if (buscando) setBusqueda("");
      else if (vista) setVista(null);
      else onClose();
    }
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [detalle, buscando, vista, onClose]);

  // El fondo no se desplaza detrás de la carta mientras está abierta.
  useEffect(() => {
    const previo = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previo;
    };
  }, []);

  // Al entrar o salir de una categoría, o al buscar, la lista arranca desde arriba.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [vista, buscando]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Carta"
      className="fixed inset-0 z-50 flex flex-col bg-[var(--color-bg)]"
    >
      {/* La mascota, muy tenue, detrás de todo el menú. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0 flex items-start justify-center overflow-hidden select-none"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/redox-mascota.png"
          alt=""
          className="mt-12 h-[72vh] w-auto opacity-[0.06]"
        />
      </div>

      <header className="relative z-10 flex items-center gap-3 border-b border-[var(--color-border)] px-5 py-4">
        <RedoxFlask size={24} />
        {vista && !buscando ? (
          <button
            type="button"
            onClick={() => setVista(null)}
            className="flex items-center gap-1 text-sm font-medium text-[var(--color-brand-soft)]"
          >
            ‹ Categorías
          </button>
        ) : (
          <h2 className="text-lg font-semibold">Carta</h2>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar la carta"
          className="ml-auto grid size-9 place-items-center rounded-full border border-[var(--color-border)] text-sm text-[var(--color-muted)] active:bg-[var(--color-surface)]"
        >
          ✕
        </button>
      </header>

      <div className="relative z-10 border-b border-[var(--color-border)] bg-[var(--color-bg)] px-5 py-3">
        <div className="relative mx-auto w-full max-w-md">
          <span
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-[var(--color-muted)]"
          >
            🔍
          </span>
          <input
            type="search"
            inputMode="search"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar en la carta…"
            aria-label="Buscar en la carta"
            className="w-full rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] py-2.5 pr-4 pl-10 text-sm outline-none focus:border-[var(--color-brand)]"
          />
        </div>
      </div>

      <div ref={scrollRef} className="relative z-10 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-md px-5 py-6">
          {buscando ? (
            <>
              <p className="text-xs font-semibold tracking-[0.22em] text-[var(--color-brand-soft)] uppercase">
                Resultados
              </p>
              <h3 className="mt-1 mb-4 text-2xl font-bold tracking-wide uppercase">
                {resultados.length > 0
                  ? `${resultados.length} coincidencia${resultados.length === 1 ? "" : "s"}`
                  : "Buscar en la carta"}
              </h3>

              {resultados.length === 0 ? (
                <p className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]/80 px-4 py-10 text-center text-sm text-[var(--color-muted)]">
                  No encontramos nada con "{busqueda.trim()}".
                </p>
              ) : (
                <div className="grid gap-3">
                  {resultados.map((item) => (
                    <ProductoCard
                      key={item.id}
                      item={item}
                      categoriaLabel={CATEGORY_LABELS[item.category]}
                      onAbrir={setDetalle}
                    />
                  ))}
                </div>
              )}
            </>
          ) : vista === null ? (
            <>
              <p className="text-xs font-semibold tracking-[0.22em] text-[var(--color-brand-soft)] uppercase">
                Elegí una categoría
              </p>
              <p className="mt-1 mb-5 text-sm text-[var(--color-muted)]">
                Descubrí la experiencia Redox
              </p>

              <PromosCarousel promos={promos} onAbrir={setDetalle} />

              {categorias.length === 0 ? (
                <p className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]/80 px-4 py-10 text-center text-sm text-[var(--color-muted)]">
                  La carta todavía no tiene productos cargados.
                </p>
              ) : (
                <div className="grid gap-3">
                  {categorias.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setVista(c.id)}
                      className="flex items-center gap-4 rounded-2xl border border-[var(--color-brand)]/45 bg-[var(--color-surface)]/80 p-4 text-left backdrop-blur transition-colors active:bg-[var(--color-surface-2)]/80"
                    >
                      <span className="grid size-14 shrink-0 place-items-center rounded-full bg-[var(--color-free)] text-2xl">
                        {c.emoji}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-xl font-bold tracking-wide uppercase">
                          {c.titulo}
                        </span>
                        <span className="block text-sm text-[var(--color-muted)]">
                          {c.sub}
                        </span>
                        <span className="mt-1 block text-xs font-semibold tracking-wide text-[var(--color-brand-soft)]">
                          VER MENÚ ›
                        </span>
                      </span>
                      <span
                        aria-hidden
                        className="text-2xl text-[var(--color-brand-soft)]"
                      >
                        ›
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              <p className="text-xs font-semibold tracking-[0.22em] text-[var(--color-brand-soft)] uppercase">
                Menú
              </p>
              <h3 className="mt-1 mb-4 text-2xl font-bold tracking-wide uppercase">
                {tituloVista}
              </h3>

              <div className="grid gap-3">
                {items.map((item) => (
                  <ProductoCard key={item.id} item={item} onAbrir={setDetalle} />
                ))}
              </div>
            </>
          )}

          <div className="mt-8 rounded-2xl border border-[var(--color-brand)]/40 px-5 py-4 text-center">
            <p className="text-sm font-bold tracking-wide">
              REDOX · SABOR CON ACTITUD
            </p>
            <p className="mt-0.5 text-xs text-[var(--color-brand-soft)]">
              {!buscando && vista === null
                ? "Seleccioná una categoría para continuar"
                : "Los precios pueden cambiar · consultá con el mozo por el pool"}
            </p>
          </div>
        </div>
      </div>

      {detalle ? (
        <DetalleProducto item={detalle} onClose={() => setDetalle(null)} />
      ) : null}
    </div>
  );
}

/**
 * Franja horizontal con los combos y promociones vigentes, arriba del
 * selector de categorías: es lo primero que ve el cliente al abrir la carta.
 */
function PromosCarousel({
  promos,
  onAbrir,
}: {
  promos: MenuItem[];
  onAbrir: (item: MenuItem) => void;
}) {
  if (promos.length === 0) return null;

  return (
    <div className="mb-6">
      <p className="mb-3 flex items-center gap-1.5 text-xs font-semibold tracking-[0.22em] text-[var(--color-brand-soft)] uppercase">
        <span aria-hidden>★</span> Promos del día
      </p>
      <div className="-mx-5 flex snap-x snap-mandatory gap-3 overflow-x-auto px-5 pb-1">
        {promos.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onAbrir(item)}
            className="flex w-40 shrink-0 snap-start flex-col overflow-hidden rounded-2xl border border-[var(--color-brand)]/45 bg-[var(--color-surface)]/80 text-left backdrop-blur transition-transform active:scale-[0.97]"
          >
            {item.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.image_url}
                alt=""
                loading="lazy"
                className="h-28 w-full object-cover"
              />
            ) : (
              <span
                aria-hidden
                className="grid h-28 w-full place-items-center bg-[var(--color-surface-2)] text-2xl"
              >
                🧪
              </span>
            )}
            <span className="flex flex-1 flex-col gap-1.5 px-3 py-2.5">
              <span className="line-clamp-2 text-xs leading-tight font-bold tracking-wide uppercase">
                {item.name}
              </span>
              <span className="mt-auto self-start rounded-full bg-[var(--color-brand)] px-2.5 py-1 text-[11px] font-bold text-[var(--color-bg)] tabular-nums">
                {formatMoney(item.price)}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Detalle a pantalla completa de un producto: foto grande, ingredientes y
 * preparación. Se abre encima de la carta; la ✕ arriba a la derecha, sobre
 * la foto, la cierra.
 */
function DetalleProducto({
  item,
  onClose,
}: {
  item: MenuItem;
  onClose: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={item.name}
      className="fixed inset-0 z-[60] flex flex-col bg-[var(--color-bg)]"
    >
      <div className="flex-1 overflow-y-auto">
        <div className="relative">
          {item.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.image_url}
              alt=""
              className="h-72 w-full object-cover"
            />
          ) : (
            <div className="grid h-72 w-full place-items-center bg-[var(--color-surface)] text-5xl">
              🧪
            </div>
          )}
          <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-[var(--color-bg)] to-transparent" />
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar detalle"
            className="absolute top-4 right-4 grid size-10 place-items-center rounded-full bg-[var(--color-bg)]/70 text-lg text-[var(--color-ink)] backdrop-blur active:bg-[var(--color-bg)]"
          >
            ✕
          </button>
        </div>

        <div className="mx-auto w-full max-w-md px-5 py-6">
          <span className="text-xs font-semibold tracking-[0.22em] text-[var(--color-brand-soft)] uppercase">
            {item.is_combo ? "Promo" : CATEGORY_LABELS[item.category]}
          </span>
          <h3 className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-2xl leading-tight font-bold tracking-wide uppercase">
            {item.name}
            {item.is_combo ? (
              <span className="rounded bg-[var(--color-brand)]/25 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-[var(--color-brand-soft)] uppercase">
                combo
              </span>
            ) : null}
          </h3>

          <span className="mt-3 inline-block rounded-full bg-[var(--color-brand)] px-4 py-1.5 text-sm font-bold text-[var(--color-bg)] tabular-nums">
            {formatMoney(item.price)}
          </span>

          <div className="mt-6 border-t border-[var(--color-border)] pt-5">
            <p className="text-xs font-semibold tracking-[0.22em] text-[var(--color-brand-soft)] uppercase">
              Ingredientes y preparación
            </p>
            <p className="mt-2 text-sm leading-relaxed text-[var(--color-muted)]">
              {item.description ??
                "Consultá con el mozo por los detalles de este producto."}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Tarjeta de producto: foto (o marco vacío), nombre, descripción y precio.
 * Se toca para expandirla a pantalla completa con más detalle.
 *
 * `categoriaLabel` solo se pasa en los resultados de búsqueda, donde los
 * ítems vienen mezclados de varias categorías y hace falta aclarar de dónde
 * es cada uno.
 */
function ProductoCard({
  item,
  categoriaLabel,
  onAbrir,
}: {
  item: MenuItem;
  categoriaLabel?: string;
  onAbrir: (item: MenuItem) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onAbrir(item)}
      className="flex gap-3 rounded-2xl border border-[var(--color-brand)]/40 bg-[var(--color-surface)]/80 p-3 text-left backdrop-blur transition-transform active:scale-[0.98]"
    >
      {item.image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.image_url}
          alt=""
          loading="lazy"
          className="size-24 shrink-0 rounded-xl border border-[var(--color-border)] object-cover"
        />
      ) : (
        <span
          aria-hidden
          className="grid size-24 shrink-0 place-items-center rounded-xl border border-dashed border-[var(--color-brand)]/40 text-2xl"
        >
          🧪
        </span>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {categoriaLabel ? (
          <span className="mb-1 text-[10px] font-semibold tracking-wide text-[var(--color-brand-soft)] uppercase">
            {categoriaLabel}
          </span>
        ) : null}
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 leading-tight font-bold tracking-wide uppercase">
          {item.name}
          {item.is_combo ? (
            <span className="rounded bg-[var(--color-brand)]/25 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-[var(--color-brand-soft)] uppercase">
              combo
            </span>
          ) : null}
        </span>

        {item.description ? (
          <span className="mt-1 line-clamp-2 text-sm leading-snug text-[var(--color-muted)]">
            {item.description}
          </span>
        ) : null}

        <span className="mt-3 self-end rounded-full bg-[var(--color-brand)] px-4 py-1.5 text-sm font-bold text-[var(--color-bg)] tabular-nums">
          {formatMoney(item.price)}
        </span>
      </div>
    </button>
  );
}
