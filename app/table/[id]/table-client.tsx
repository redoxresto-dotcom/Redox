"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
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

  // La carta llega ordenada por categoría; solo hay que agruparla para poder
  // ponerle un título a cada tramo.
  const secciones = useMemo(() => {
    const orden: ProductCategory[] = ["bebida", "comida", "otro"];
    return orden
      .map((categoria) => ({
        categoria,
        items: menu.filter((i) => i.category === categoria),
      }))
      .filter((s) => s.items.length > 0);
  }, [menu]);

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

          <div className="mt-5 flex items-baseline gap-3">
            <span className="text-sm tracking-[0.2em] text-[var(--color-muted)] uppercase">
              Mesa
            </span>
            <span className="text-6xl leading-none font-bold tabular-nums">
              {tableNumber}
            </span>
          </div>
          {tableName ? (
            <p className="mt-1 text-sm text-[var(--color-muted)]">
              {tableName}
            </p>
          ) : null}
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
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-4 text-lg font-medium active:bg-[var(--color-surface-2)]"
          >
            <span aria-hidden className="text-2xl">
              📖
            </span>
            Ver la carta
          </button>
        ) : null}

        {verCarta ? (
          <Carta secciones={secciones} onClose={() => setVerCarta(false)} />
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

/**
 * La carta a pantalla completa.
 *
 * Se abre encima de los botones de llamado en vez de empujarlos fuera de la
 * pantalla: quien abre el QR para pedir la cuenta tiene que seguir teniendo el
 * botón a un toque.
 */
function Carta({
  secciones,
  onClose,
}: {
  secciones: { categoria: ProductCategory; items: MenuItem[] }[];
  onClose: () => void;
}) {
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

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Carta"
      className="fixed inset-0 z-50 flex flex-col bg-[var(--color-bg)]"
    >
      <header className="sticky top-0 flex items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-bg)] px-5 py-4">
        <RedoxFlask size={26} />
        <h2 className="text-2xl font-semibold">Carta</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar la carta"
          className="ml-auto rounded-full border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-muted)] active:bg-[var(--color-surface)]"
        >
          ✕ Cerrar
        </button>
      </header>

      <div className="mx-auto w-full max-w-md flex-1 overflow-y-auto px-5 py-4">
        {secciones.map((seccion) => (
          <section key={seccion.categoria} className="mb-7">
            <h3 className="mb-3 text-xs font-medium tracking-[0.2em] text-[var(--color-accent)] uppercase">
              {CATEGORY_LABELS[seccion.categoria]}
            </h3>

            <ul className="grid gap-4">
              {seccion.items.map((item) => (
                <li key={item.id} className="flex items-baseline gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="leading-tight font-medium">{item.name}</p>
                    {item.description ? (
                      <p className="mt-0.5 text-sm leading-snug text-[var(--color-muted)]">
                        {item.description}
                      </p>
                    ) : null}
                  </div>
                  <span className="shrink-0 tabular-nums">
                    {formatMoney(item.price)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}

        <p className="pb-6 text-center text-xs text-[var(--color-muted)]">
          Los precios pueden cambiar. Consultá con el mozo por el pool.
        </p>
      </div>
    </div>
  );
}
