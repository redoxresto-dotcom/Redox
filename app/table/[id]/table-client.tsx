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

        {menu.length > 0 ? (
          <button
            type="button"
            onClick={() => setVerCarta(true)}
            className="mt-4 flex w-full items-center gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-4 text-left transition-colors active:bg-[var(--color-surface-2)]"
          >
            <span
              aria-hidden
              className="grid size-11 shrink-0 place-items-center rounded-xl bg-[var(--color-accent)]/15 text-2xl"
            >
              📖
            </span>
            <span className="flex-1">
              <span className="block text-lg font-semibold">Ver la carta</span>
              <span className="block text-sm text-[var(--color-muted)]">
                Bebidas, comida y promos
              </span>
            </span>
            <span aria-hidden className="text-xl text-[var(--color-muted)]">
              →
            </span>
          </button>
        ) : null}

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

/**
 * La carta a pantalla completa.
 *
 * Se abre encima de los botones de llamado: quien abrió el QR para pedir la
 * cuenta tiene que seguir teniendo ese botón a un toque al cerrar.
 *
 * Estructura de menú digital: las promos arriba, después cada categoría con su
 * ancla, y una barra de secciones pegada que salta y sigue el scroll.
 */
function Carta({ menu, onClose }: { menu: MenuItem[]; onClose: () => void }) {
  const promos = menu.filter((i) => i.is_combo);
  const secciones = ORDEN_CATEGORIAS.map((categoria) => ({
    categoria,
    items: menu.filter((i) => i.category === categoria && !i.is_combo),
  })).filter((s) => s.items.length > 0);

  const nav: { id: string; label: string }[] = [
    ...(promos.length > 0 ? [{ id: "promos", label: "Promos" }] : []),
    ...secciones.map((s) => ({
      id: s.categoria,
      label: CATEGORY_LABELS[s.categoria],
    })),
  ];

  const [activo, setActivo] = useState(nav[0]?.id ?? "");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onEsc);

    // Sin esto, el fondo se sigue desplazando detrás de la carta en el celular.
    const previo = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", onEsc);
      document.body.style.overflow = previo;
    };
  }, [onClose]);

  // La barra de secciones sigue lo que se está mirando.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;

    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort(
            (a, b) => a.boundingClientRect.top - b.boundingClientRect.top,
          )[0];
        const id = visible?.target.getAttribute("data-sec");
        if (id) setActivo(id);
      },
      { root, rootMargin: "-15% 0px -75% 0px", threshold: 0 },
    );

    root.querySelectorAll("[data-sec]").forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, [nav.length]);

  function irA(id: string) {
    const el = scrollRef.current?.querySelector<HTMLElement>(`#sec-${id}`);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Carta"
      className="fixed inset-0 z-50 flex flex-col bg-[var(--color-bg)]"
    >
      <header className="flex items-center gap-3 border-b border-[var(--color-border)] px-5 py-4">
        <RedoxFlask size={24} />
        <h2 className="text-xl font-semibold">Carta</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar la carta"
          className="ml-auto grid size-9 place-items-center rounded-full border border-[var(--color-border)] text-sm text-[var(--color-muted)] active:bg-[var(--color-surface)]"
        >
          ✕
        </button>
      </header>

      {nav.length > 1 ? (
        <nav className="flex gap-2 overflow-x-auto border-b border-[var(--color-border)] px-5 py-2.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {nav.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => irA(n.id)}
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
                activo === n.id
                  ? "bg-[var(--color-accent)] text-[#04121c]"
                  : "bg-[var(--color-surface)] text-[var(--color-muted)] active:bg-[var(--color-surface-2)]"
              }`}
            >
              {n.label}
            </button>
          ))}
        </nav>
      ) : null}

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-md px-5 py-5">
          {promos.length > 0 ? (
            <section
              id="sec-promos"
              data-sec="promos"
              className="mb-9 scroll-mt-4"
            >
              <TituloSeccion>Promos</TituloSeccion>
              <div className="grid gap-3">
                {promos.map((item) => (
                  <PromoCard key={item.id} item={item} />
                ))}
              </div>
            </section>
          ) : null}

          {secciones.map((seccion) => (
            <section
              key={seccion.categoria}
              id={`sec-${seccion.categoria}`}
              data-sec={seccion.categoria}
              className="mb-9 scroll-mt-4"
            >
              <TituloSeccion>{CATEGORY_LABELS[seccion.categoria]}</TituloSeccion>
              <ul className="divide-y divide-[var(--color-border)]">
                {seccion.items.map((item) => (
                  <li key={item.id}>
                    {item.image_url ? (
                      <PlatoConFoto item={item} />
                    ) : (
                      <PlatoTexto item={item} />
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}

          <p className="pt-2 pb-8 text-center text-xs text-[var(--color-muted)]">
            Los precios pueden cambiar. Consultá con el mozo por el pool.
          </p>
        </div>
      </div>
    </div>
  );
}

function TituloSeccion({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center gap-3">
      <h3 className="text-xs font-semibold tracking-[0.2em] text-[var(--color-accent)] uppercase">
        {children}
      </h3>
      <span className="h-px flex-1 bg-[var(--color-border)]" />
    </div>
  );
}

/** Combo: tarjeta destacada, con foto de ancho completo si la tiene. */
function PromoCard({ item }: { item: MenuItem }) {
  return (
    <article className="overflow-hidden rounded-2xl border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/[0.06]">
      {item.image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.image_url}
          alt=""
          loading="lazy"
          className="h-36 w-full object-cover"
        />
      ) : null}
      <div className="flex items-start gap-3 p-4">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 leading-tight font-semibold">
            {item.name}
            <span className="rounded bg-[var(--color-accent)]/20 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-[var(--color-accent)] uppercase">
              combo
            </span>
          </p>
          {item.description ? (
            <p className="mt-1 text-sm leading-snug text-[var(--color-muted)]">
              {item.description}
            </p>
          ) : null}
        </div>
        <span className="shrink-0 text-lg font-bold tabular-nums text-[var(--color-accent)]">
          {formatMoney(item.price)}
        </span>
      </div>
    </article>
  );
}

/** Plato con foto: miniatura al costado. */
function PlatoConFoto({ item }: { item: MenuItem }) {
  return (
    <div className="flex items-start gap-3 py-3.5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={item.image_url ?? ""}
        alt=""
        loading="lazy"
        className="size-20 shrink-0 rounded-xl border border-[var(--color-border)] object-cover"
      />
      <div className="min-w-0 flex-1">
        <p className="leading-tight font-medium">{item.name}</p>
        {item.description ? (
          <p className="mt-0.5 line-clamp-2 text-sm leading-snug text-[var(--color-muted)]">
            {item.description}
          </p>
        ) : null}
      </div>
      <span className="shrink-0 font-semibold tabular-nums">
        {formatMoney(item.price)}
      </span>
    </div>
  );
}

/** Plato sin foto: renglón de carta clásico, con guía de puntos hasta el precio. */
function PlatoTexto({ item }: { item: MenuItem }) {
  return (
    <div className="py-3.5">
      <div className="flex items-baseline gap-2">
        <span className="font-medium">{item.name}</span>
        <span className="mx-1 flex-1 -translate-y-0.5 border-b border-dotted border-[var(--color-border)]" />
        <span className="shrink-0 font-semibold tabular-nums">
          {formatMoney(item.price)}
        </span>
      </div>
      {item.description ? (
        <p className="mt-0.5 text-sm leading-snug text-[var(--color-muted)]">
          {item.description}
        </p>
      ) : null}
    </div>
  );
}
