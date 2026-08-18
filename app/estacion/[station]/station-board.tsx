"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { playBeep } from "@/lib/beep";
import { markTableReady, setItemStatus } from "../actions";
import {
  ITEM_LATE_MINUTES,
  ITEM_WARN_MINUTES,
  type ItemStatus,
} from "@/lib/types";

export type StationItem = {
  id: string;
  name: string;
  quantity: number;
  status: ItemStatus;
  created_at: string;
  started_at: string | null;
  ready_at: string | null;
};

export type StationTicket = {
  tableId: string;
  tableNumber: number;
  items: StationItem[];
};

type Props = {
  station: "barra" | "cocina";
  label: string;
  tickets: StationTicket[];
};

type Urgency = "ok" | "warn" | "late";

/** "4:32" — minutos y segundos de espera, que es como se lee una comanda. */
function elapsed(from: string, now: number): string {
  const secs = Math.max(0, Math.floor((now - new Date(from).getTime()) / 1000));
  const mins = Math.floor(secs / 60);
  if (mins >= 60) return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  return `${mins}:${String(secs % 60).padStart(2, "0")}`;
}

/** normal → ámbar → rojo, según cuánto lleva esperando la línea. */
function urgency(item: StationItem, now: number): Urgency {
  if (item.status === "listo") return "ok";
  const mins = (now - new Date(item.created_at).getTime()) / 60_000;
  if (mins >= ITEM_LATE_MINUTES) return "late";
  if (mins >= ITEM_WARN_MINUTES) return "warn";
  return "ok";
}

type RunFn = (
  ids: string[],
  next: ItemStatus,
  fn: () => Promise<{ error: string | null }>
) => void;

export function StationBoard({ station, label, tickets }: Props) {
  const router = useRouter();
  const [now, setNow] = useState(() => Date.now());
  const [muted, setMuted] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Respuesta inmediata al toque: el estado real llega con la revalidación,
  // pero en una pantalla táctil no se puede esperar el ida y vuelta.
  const [overrides, setOverrides] = useState<Record<string, ItemStatus>>({});
  useEffect(() => {
    setOverrides({});
  }, [tickets]);

  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  // Los relojes de espera corren en el cliente: nada de volver al servidor una
  // vez por segundo solo para mostrar que pasó un minuto.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Suena solo cuando entra una comanda que esta pantalla todavía no tenía.
  const knownIds = useRef<Set<string> | null>(null);
  useEffect(() => {
    const pendientes = new Set(
      tickets.flatMap((t) =>
        t.items.filter((i) => i.status !== "listo").map((i) => i.id)
      )
    );

    const previas = knownIds.current;
    knownIds.current = pendientes;

    // El primer render no suena: son las comandas que ya estaban en pantalla.
    if (previas === null) return;

    const hayNuevas = [...pendientes].some((id) => !previas.has(id));
    if (hayNuevas && !mutedRef.current) {
      // Más grave que la campanita de las alertas del salón: en la barra hay
      // que poder distinguir un pedido nuevo de un llamado de mesa.
      playBeep(660, 990);
    }
  }, [tickets]);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();

    const channel = supabase
      .channel(`estacion-${station}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "order_items" },
        () => router.refresh()
      )
      .on(
        // Cobrar una mesa saca sus comandas de la pantalla.
        "postgres_changes",
        { event: "*", schema: "public", table: "orders" },
        () => router.refresh()
      )
      .subscribe((status) => setConnected(status === "SUBSCRIBED"));

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [router, station]);

  const run: RunFn = (ids, next, fn) => {
    setError(null);
    setOverrides((prev) => {
      const copy = { ...prev };
      for (const id of ids) copy[id] = next;
      return copy;
    });

    startTransition(async () => {
      const result = await fn();
      if (result.error) {
        setError(result.error);
        setOverrides({});
        router.refresh();
      }
    });
  };

  const view = useMemo(
    () =>
      tickets.map((ticket) => ({
        ...ticket,
        items: ticket.items.map((item) => ({
          ...item,
          status: overrides[item.id] ?? item.status,
        })),
      })),
    [tickets, overrides]
  );

  const pendientes = view.reduce(
    (n, t) => n + t.items.filter((i) => i.status !== "listo").length,
    0
  );

  return (
    <>
      <header className="flex flex-wrap items-center gap-3 border-b border-[var(--color-border)] px-4 py-3">
        <h1 className="text-2xl font-semibold">{label}</h1>
        <span
          className={`rounded-full px-3 py-1 text-sm font-medium ${
            pendientes > 0
              ? "bg-[var(--color-busy)]/20 text-[var(--color-busy)]"
              : "text-[var(--color-muted)]"
          }`}
        >
          {pendientes > 0
            ? `${pendientes} pendiente${pendientes > 1 ? "s" : ""}`
            : "Todo al día"}
        </span>

        <div className="ml-auto flex items-center gap-2">
          <span
            title={connected ? "Conectado en tiempo real" : "Reconectando…"}
            className={`inline-block size-2.5 rounded-full ${
              connected
                ? "bg-[var(--color-free)]"
                : "animate-pulse bg-[var(--color-muted)]"
            }`}
          />
          <button
            type="button"
            onClick={() => setMuted((m) => !m)}
            title={muted ? "Activar sonido" : "Silenciar"}
            className="rounded-lg px-2 py-1 text-lg transition-colors hover:bg-[var(--color-surface)]"
          >
            {muted ? "🔇" : "🔊"}
          </button>
          <button
            type="button"
            onClick={() => {
              if (document.fullscreenElement) void document.exitFullscreen();
              else void document.documentElement.requestFullscreen();
            }}
            title="Pantalla completa"
            aria-label="Pantalla completa"
            className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm text-[var(--color-muted)] transition-colors hover:text-[var(--color-ink)]"
          >
            ⛶
          </button>
        </div>
      </header>

      {error ? (
        <p
          role="alert"
          className="mx-4 mt-3 rounded-lg border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-3 py-2 text-sm text-[var(--color-danger)]"
        >
          {error}
        </p>
      ) : null}

      <main className="min-h-0 flex-1 overflow-y-auto p-4">
        {view.length === 0 ? (
          <p className="mt-24 text-center text-lg text-[var(--color-muted)]">
            No hay comandas para {label.toLowerCase()}.
          </p>
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(19rem,1fr))] gap-4">
            {view.map((ticket) => (
              <li key={ticket.tableId}>
                <TicketCard
                  ticket={ticket}
                  station={station}
                  now={now}
                  isPending={isPending}
                  onRun={run}
                />
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}

// ---------------------------------------------------------------------------

function TicketCard({
  ticket,
  station,
  now,
  isPending,
  onRun,
}: {
  ticket: StationTicket;
  station: string;
  now: number;
  isPending: boolean;
  onRun: RunFn;
}) {
  const pendientes = ticket.items.filter((i) => i.status !== "listo");

  const peor = pendientes.reduce<Urgency>((acc, item) => {
    const u = urgency(item, now);
    if (u === "late" || acc === "late") return "late";
    if (u === "warn" || acc === "warn") return "warn";
    return "ok";
  }, "ok");

  const masVieja = pendientes.reduce<string | null>(
    (min, i) => (min === null || i.created_at < min ? i.created_at : min),
    null
  );

  const borde =
    pendientes.length === 0
      ? "border-[var(--color-border)] opacity-60"
      : peor === "late"
        ? "border-[var(--color-danger)] animate-pulse"
        : peor === "warn"
          ? "border-[var(--color-busy)]"
          : "border-[var(--color-accent)]/60";

  return (
    <article
      className={`flex h-full flex-col rounded-2xl border-2 bg-[var(--color-surface)] transition-colors ${borde}`}
    >
      <header className="flex items-baseline gap-2 border-b border-[var(--color-border)] px-4 py-3">
        <h2 className="text-2xl font-bold">Mesa {ticket.tableNumber}</h2>
        {masVieja ? (
          <span
            className={`ml-auto text-xl font-semibold tabular-nums ${
              peor === "late"
                ? "text-[var(--color-danger)]"
                : peor === "warn"
                  ? "text-[var(--color-busy)]"
                  : "text-[var(--color-muted)]"
            }`}
          >
            {elapsed(masVieja, now)}
          </span>
        ) : (
          <span className="ml-auto text-sm text-[var(--color-muted)]">
            Entregado
          </span>
        )}
      </header>

      <ul className="flex-1 divide-y divide-[var(--color-border)]">
        {ticket.items.map((item) => (
          <ItemRow
            key={item.id}
            item={item}
            now={now}
            isPending={isPending}
            onRun={onRun}
          />
        ))}
      </ul>

      {pendientes.length > 1 ? (
        <footer className="border-t border-[var(--color-border)] p-3">
          <button
            type="button"
            disabled={isPending}
            onClick={() =>
              onRun(
                pendientes.map((i) => i.id),
                "listo",
                () => markTableReady(ticket.tableId, station)
              )
            }
            className="w-full rounded-xl bg-[var(--color-free)] px-4 py-3 font-semibold text-[#04140a] disabled:opacity-50"
          >
            Toda la mesa lista
          </button>
        </footer>
      ) : null}
    </article>
  );
}

// ---------------------------------------------------------------------------

function ItemRow({
  item,
  now,
  isPending,
  onRun,
}: {
  item: StationItem;
  now: number;
  isPending: boolean;
  onRun: RunFn;
}) {
  const u = urgency(item, now);
  const listo = item.status === "listo";

  function mover(next: ItemStatus) {
    onRun([item.id], next, () => setItemStatus(item.id, next));
  }

  return (
    <li className={`px-4 py-3 ${listo ? "opacity-45" : ""}`}>
      <div className="flex items-start gap-3">
        <span className="min-w-8 text-xl font-bold tabular-nums text-[var(--color-accent)]">
          {item.quantity}×
        </span>
        <span
          className={`flex-1 text-lg leading-tight ${listo ? "line-through" : ""}`}
        >
          {item.name}
        </span>
        {!listo && u !== "ok" ? (
          <span
            aria-label={u === "late" ? "Demora alta" : "Demorado"}
            className={
              u === "late"
                ? "text-lg text-[var(--color-danger)]"
                : "text-lg text-[var(--color-busy)]"
            }
          >
            ⏱
          </span>
        ) : null}
      </div>

      <div className="mt-2 flex items-center gap-2">
        {item.status === "pedido" ? (
          <>
            <button
              type="button"
              disabled={isPending}
              onClick={() => mover("preparando")}
              className="flex-1 rounded-lg border border-[var(--color-border)] px-3 py-2.5 text-sm font-medium transition-colors hover:border-[var(--color-busy)] hover:text-[var(--color-busy)] disabled:opacity-50"
            >
              Empezar
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => mover("listo")}
              className="flex-1 rounded-lg bg-[var(--color-free)]/90 px-3 py-2.5 text-sm font-semibold text-[#04140a] disabled:opacity-50"
            >
              Listo
            </button>
          </>
        ) : item.status === "preparando" ? (
          <>
            <span className="rounded-full bg-[var(--color-busy)]/20 px-2.5 py-1 text-xs font-medium tracking-wide text-[var(--color-busy)] uppercase">
              En preparación
            </span>
            <button
              type="button"
              disabled={isPending}
              onClick={() => mover("pedido")}
              aria-label="Volver a pedido"
              title="Volver a pedido"
              className="rounded-lg px-2 py-2 text-[var(--color-muted)] transition-colors hover:text-[var(--color-ink)] disabled:opacity-50"
            >
              ↩
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => mover("listo")}
              className="ml-auto flex-1 rounded-lg bg-[var(--color-free)] px-3 py-2.5 text-sm font-semibold text-[#04140a] disabled:opacity-50"
            >
              Listo
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={isPending}
            onClick={() => mover(item.started_at ? "preparando" : "pedido")}
            className="ml-auto rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-muted)] transition-colors hover:text-[var(--color-ink)] disabled:opacity-50"
          >
            ↩ Deshacer
          </button>
        )}
      </div>
    </li>
  );
}
