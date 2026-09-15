"use client";

import { Fragment, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { playBeep } from "@/lib/beep";
import { expireDuePoolSessions } from "../admin/pool/actions";
import { RedoxFlask } from "../_components/brand";
import { nombreMesa, type PoolReservation, type PoolStatus } from "@/lib/types";

type Fase = "libre" | "jugando" | "por-terminar" | "vencida";

function faltan(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const dd = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${dd(m)}:${dd(s)}` : `${dd(m)}:${dd(s)}`;
}

function faseDe(mesa: PoolStatus, ahora: number): Fase {
  if (!mesa.ends_at) return "libre";
  const restante = new Date(mesa.ends_at).getTime() - ahora;
  if (restante <= 0) return "vencida";
  if (restante <= mesa.warning_minutes * 60_000) return "por-terminar";
  return "jugando";
}

const MENSAJE: Record<Fase, string> = {
  libre: "Mesa disponible",
  jugando: "En juego",
  "por-terminar": "Últimos minutos",
  vencida: "Tiempo cumplido",
};

/** "14:30" — la hora del turno, siempre en hora de Montevideo y 24 h. */
function horaCorta(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-UY", {
    timeZone: "America/Montevideo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** Cuántas reservas se muestran por mesa a la vez. */
const RESERVAS_VISIBLES = 2;

export function PoolTv({
  estado,
  reservas,
}: {
  estado: PoolStatus[];
  reservas: PoolReservation[];
}) {
  const router = useRouter();
  const [ahora, setAhora] = useState(() => Date.now());
  const [mudo, setMudo] = useState(false);
  const [, startTransition] = useTransition();

  const mudoRef = useRef(mudo);
  mudoRef.current = mudo;

  useEffect(() => {
    const id = setInterval(() => setAhora(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Una partida vencida se cierra sola, aunque el aparato esté desconectado.
  const vencidas = estado
    .filter((m) => m.ends_at && new Date(m.ends_at).getTime() <= ahora)
    .map((m) => m.session_id)
    .join(",");

  useEffect(() => {
    if (!vencidas) return;
    startTransition(async () => {
      await expireDuePoolSessions();
      router.refresh();
    });
  }, [vencidas, router]);

  // Suena una vez cuando una mesa entra en los últimos minutos, y otra cuando
  // se cumple el tiempo. En un salón con ruido, el cartel solo no alcanza.
  const avisadas = useRef<Record<string, Fase>>({});
  useEffect(() => {
    for (const mesa of estado) {
      if (!mesa.session_id) continue;
      const fase = faseDe(mesa, ahora);
      const previa = avisadas.current[mesa.session_id];

      if (fase !== previa) {
        avisadas.current[mesa.session_id] = fase;
        if (mudoRef.current) continue;
        if (fase === "por-terminar") playBeep(880, 1320);
        if (fase === "vencida") playBeep(500, 380, 0.7);
      }
    }
  }, [estado, ahora]);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    const channel = supabase
      .channel("pool-tv")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pool_sessions" },
        () => router.refresh(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pool_reservations" },
        () => router.refresh(),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [router]);

  // Cola de turnos pendientes por mesa, en orden de hora. Se muestran de a dos;
  // los demás entran a medida que estos se activan o se liberan.
  const colaPorMesa = new Map<string, PoolReservation[]>();
  for (const r of reservas) {
    if (r.status !== "reservada") continue;
    const lista = colaPorMesa.get(r.table_id) ?? [];
    lista.push(r);
    colaPorMesa.set(r.table_id, lista);
  }
  for (const lista of colaPorMesa.values()) {
    lista.sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
  }

  return (
    <main className="relative flex min-h-screen flex-col p-6">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
      >
        <div className="absolute -top-32 -left-32 size-[28rem] rounded-full bg-[var(--color-brand)]/15 blur-[110px]" />
        <div className="absolute right-0 bottom-0 size-[28rem] rounded-full bg-[var(--color-accent)]/10 blur-[110px]" />
      </div>

      <header className="mb-6 flex items-center gap-3">
        <RedoxFlask size={34} />
        <h1 className="text-2xl font-semibold tracking-tight">Mesas de pool</h1>

        <button
          type="button"
          onClick={() => setMudo((m) => !m)}
          title={mudo ? "Activar sonido" : "Silenciar"}
          className="ml-auto rounded-lg px-3 py-2 text-xl text-[var(--color-muted)]"
        >
          {mudo ? "🔇" : "🔊"}
        </button>
        <button
          type="button"
          onClick={() => {
            if (document.fullscreenElement) void document.exitFullscreen();
            else void document.documentElement.requestFullscreen();
          }}
          aria-label="Pantalla completa"
          className="rounded-lg bg-white/5 px-3 py-2 text-sm text-[var(--color-muted)] backdrop-blur-md"
        >
          ⛶
        </button>
      </header>

      {estado.length === 0 ? (
        <p className="mt-32 text-center text-xl text-[var(--color-muted)]">
          No hay mesas de pool configuradas.
        </p>
      ) : (
        <ul className="grid flex-1 grid-cols-[repeat(auto-fit,minmax(16rem,1fr))] content-center gap-6">
          {estado.map((mesa) => {
            const fase = faseDe(mesa, ahora);
            const restante = mesa.ends_at
              ? new Date(mesa.ends_at).getTime() - ahora
              : 0;

            // El borde grueso de color acá no es decoración: es la señal de
            // estado que se lee desde el otro lado del salón. Se mantiene
            // aunque el resto de la app pase a vidrio sin bordes.
            const borde =
              fase === "vencida"
                ? "border-[var(--color-danger)] bg-[var(--color-danger)]/15 backdrop-blur-xl animate-pulse"
                : fase === "por-terminar"
                  ? "border-[var(--color-busy)] bg-[var(--color-busy)]/10 backdrop-blur-xl animate-pulse"
                  : fase === "jugando"
                    ? "border-[var(--color-free)]/60 bg-[var(--color-free)]/5 backdrop-blur-xl"
                    : "border-transparent bg-white/5 backdrop-blur-xl";

            const tinta =
              fase === "vencida"
                ? "text-[var(--color-danger)]"
                : fase === "por-terminar"
                  ? "text-[var(--color-busy)]"
                  : fase === "jugando"
                    ? "text-[var(--color-ink)]"
                    : "text-[var(--color-muted)]";

            const cola = colaPorMesa.get(mesa.table_id) ?? [];
            const visibles = cola.slice(0, RESERVAS_VISIBLES);
            const restantes = cola.length - visibles.length;

            return (
              <li key={mesa.table_id} className="flex min-w-0 flex-col gap-3">
                <article
                  className={`flex min-h-64 flex-col items-center justify-center rounded-3xl border-4 p-8 text-center transition-colors ${borde}`}
                >
                  <p className="text-xl font-bold tracking-[0.15em] text-[var(--color-muted)] uppercase">
                    {nombreMesa(mesa.table_number, mesa.table_name)}
                  </p>

                  {mesa.player_one || mesa.player_two ? (
                    <p className="mt-1 text-lg text-[var(--color-brand-soft)]">
                      {[mesa.player_one, mesa.player_two]
                        .filter(Boolean)
                        .join("  ·  ")}
                    </p>
                  ) : null}

                  <p
                    className={`my-3 text-7xl leading-none font-bold tabular-nums ${tinta}`}
                  >
                    {fase === "libre" ? "—" : faltan(restante)}
                  </p>

                  <p className={`text-lg font-semibold ${tinta}`}>
                    {MENSAJE[fase]}
                  </p>

                  {fase === "vencida" ? (
                    <p className="mt-1 text-sm text-[var(--color-muted)]">
                      Acercate a la barra para seguir jugando
                    </p>
                  ) : null}
                </article>

                {visibles.length > 0 ? (
                  <div className="rounded-2xl bg-white/5 p-3 backdrop-blur-xl">
                    <div className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-2 text-sm">
                      <span className="text-xs font-semibold tracking-[0.12em] text-[var(--color-muted)] uppercase">
                        Reservada
                      </span>
                      <span className="text-xs font-semibold tracking-[0.12em] text-[var(--color-muted)] uppercase">
                        Usuario
                      </span>
                      <span className="text-xs font-semibold tracking-[0.12em] text-[var(--color-muted)] uppercase">
                        Hora
                      </span>
                      {visibles.map((r) => (
                        <Fragment key={r.id}>
                          <span className="inline-flex items-center rounded-full bg-[var(--color-brand-soft)]/15 px-2 py-0.5 text-xs font-medium text-[var(--color-brand-soft)]">
                            Reservada
                          </span>
                          <span className="min-w-0 truncate font-medium">
                            {r.customer_name}
                          </span>
                          <span className="tabular-nums text-[var(--color-muted)]">
                            {horaCorta(r.scheduled_at)}
                          </span>
                        </Fragment>
                      ))}
                    </div>
                    {restantes > 0 ? (
                      <p className="mt-2 text-center text-xs text-[var(--color-muted)]">
                        +{restantes} en espera
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
