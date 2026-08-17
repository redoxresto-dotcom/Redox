"use client";

import { useEffect, useState, useTransition } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { callStaff } from "./actions";
import type { AlertType } from "@/lib/types";

type Props = {
  tableId: string;
  tableNumber: number;
  /** Llamados ya pendientes al abrir la página. */
  initialPending: AlertType[];
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

export function TableClient({ tableId, tableNumber, initialPending }: Props) {
  const [pending, setPending] = useState<AlertType[]>(initialPending);
  const [error, setError] = useState<string | null>(null);
  const [isSending, startTransition] = useTransition();
  const [sendingType, setSendingType] = useState<AlertType | null>(null);

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
            | { type: AlertType; status: string }
            | undefined;
          if (!row) return;

          setPending((prev) => {
            const rest = prev.filter((t) => t !== row.type);
            if (payload.eventType === "DELETE") return rest;
            return row.status === "pendiente" ? [...rest, row.type] : rest;
          });
        }
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
    <main className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col px-5 py-8">
      <header className="text-center">
        <p className="text-xs font-medium tracking-[0.2em] text-[var(--color-accent)] uppercase">
          Punta Carretas
        </p>
        <h1 className="mt-4 text-6xl font-bold tabular-nums">{tableNumber}</h1>
        <p className="mt-1 text-lg text-[var(--color-muted)]">Tu mesa</p>
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

      <footer className="pt-8 text-center text-xs text-[var(--color-muted)]">
        {pending.length > 0
          ? "Podés guardar el teléfono, ya estamos en camino."
          : "Tocá un botón y un mozo se acerca a tu mesa."}
      </footer>
    </main>
  );
}
