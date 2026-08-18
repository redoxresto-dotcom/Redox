"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { playBeep } from "@/lib/beep";
import { resolveAlert } from "../actions";
import { ALERT_LABELS, type Alert } from "@/lib/types";

type Props = {
  /** Alertas pendientes al momento de renderizar en el servidor. */
  initialAlerts: Alert[];
  /** id de mesa → número, para no tener que consultar la base en el cliente. */
  tableNumbers: Record<string, number>;
};

/** "hace 2 min" a partir de un timestamp. */
function elapsed(from: string, now: number): string {
  const secs = Math.max(0, Math.floor((now - new Date(from).getTime()) / 1000));
  if (secs < 60) return `hace ${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `hace ${mins} min`;
  return `hace ${Math.floor(mins / 60)} h`;
}

export function AlertMonitor({ initialAlerts, tableNumbers }: Props) {
  const router = useRouter();
  const [alerts, setAlerts] = useState<Alert[]>(initialAlerts);
  const [muted, setMuted] = useState(false);
  const [connected, setConnected] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [isPending, startTransition] = useTransition();

  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  // El servidor manda la verdad en cada revalidación; el Realtime solo adelanta.
  useEffect(() => {
    setAlerts(initialAlerts);
  }, [initialAlerts]);

  // Refresca los "hace X min" sin volver al servidor.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  const beep = useCallback(() => {
    if (mutedRef.current) return;
    playBeep();
  }, []);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();

    const channel = supabase
      .channel("monitor-alertas")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "alerts" },
        (payload) => {
          const row = (payload.new ?? payload.old) as Alert | undefined;
          if (!row) return;

          setAlerts((prev) => {
            const rest = prev.filter((a) => a.id !== row.id);
            if (payload.eventType === "DELETE") return rest;
            if (row.status !== "pendiente") return rest;
            if (prev.some((a) => a.id === row.id)) return prev;
            beep();
            return [row, ...rest];
          });

          // Trae el estado real del servidor (mesas, cuentas, etc.).
          router.refresh();
        }
      )
      .subscribe((status) => setConnected(status === "SUBSCRIBED"));

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [beep, router]);

  function handleResolve(id: string) {
    setAlerts((prev) => prev.filter((a) => a.id !== id)); // respuesta inmediata
    startTransition(async () => {
      const result = await resolveAlert(id);
      if (result.error) router.refresh(); // falló: que vuelva a aparecer
    });
  }

  const hasAlerts = alerts.length > 0;

  return (
    <section
      aria-label="Alertas de las mesas"
      aria-live="polite"
      className={`border-b transition-colors ${
        hasAlerts
          ? "border-[var(--color-busy)]/40 bg-[var(--color-busy)]/10"
          : "border-[var(--color-border)] bg-[var(--color-surface)]/40"
      }`}
    >
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-2 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span
            title={connected ? "Conectado en tiempo real" : "Reconectando…"}
            className={`inline-block size-2 rounded-full ${
              connected
                ? "bg-[var(--color-free)]"
                : "animate-pulse bg-[var(--color-muted)]"
            }`}
          />
          <span className="text-xs font-medium tracking-wide text-[var(--color-muted)] uppercase">
            {hasAlerts ? `${alerts.length} pendiente${alerts.length > 1 ? "s" : ""}` : "Sin alertas"}
          </span>
        </div>

        {hasAlerts ? (
          <ul className="flex flex-1 flex-wrap items-center gap-2">
            {alerts.map((alert) => (
              <li key={alert.id}>
                <button
                  type="button"
                  onClick={() => handleResolve(alert.id)}
                  disabled={isPending}
                  title="Marcar como atendida"
                  className={`group flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors disabled:opacity-50 ${
                    alert.type === "pedir_cuenta"
                      ? "border-[var(--color-accent)]/50 bg-[var(--color-accent)]/15 hover:bg-[var(--color-accent)]/25"
                      : "border-[var(--color-busy)]/50 bg-[var(--color-busy)]/15 hover:bg-[var(--color-busy)]/25"
                  }`}
                >
                  <span className="font-semibold">
                    Mesa {tableNumbers[alert.table_id] ?? "?"}
                  </span>
                  <span>{ALERT_LABELS[alert.type]}</span>
                  <span className="text-xs text-[var(--color-muted)]">
                    {elapsed(alert.created_at, now)}
                  </span>
                  <span className="text-xs opacity-0 transition-opacity group-hover:opacity-100">
                    ✓ atender
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="flex-1 text-sm text-[var(--color-muted)]">
            Los llamados de las mesas aparecen acá al instante.
          </p>
        )}

        <button
          type="button"
          onClick={() => setMuted((m) => !m)}
          title={muted ? "Activar sonido" : "Silenciar"}
          className="rounded-lg px-2 py-1 text-sm text-[var(--color-muted)] transition-colors hover:text-[var(--color-ink)]"
        >
          {muted ? "🔇" : "🔊"}
        </button>
      </div>
    </section>
  );
}
