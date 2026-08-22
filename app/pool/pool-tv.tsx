"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { playBeep } from "@/lib/beep";
import { expireDuePoolSessions } from "../admin/pool/actions";
import { RedoxFlask } from "../_components/brand";
import type { PoolStatus } from "@/lib/types";

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

export function PoolTv({ estado }: { estado: PoolStatus[] }) {
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
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [router]);

  return (
    <main className="flex min-h-screen flex-col p-6">
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
          className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-muted)]"
        >
          ⛶
        </button>
      </header>

      {estado.length === 0 ? (
        <p className="mt-32 text-center text-xl text-[var(--color-muted)]">
          No hay mesas de pool configuradas.
        </p>
      ) : (
        <ul className="grid flex-1 grid-cols-[repeat(auto-fit,minmax(20rem,1fr))] content-center gap-6">
          {estado.map((mesa) => {
            const fase = faseDe(mesa, ahora);
            const restante = mesa.ends_at
              ? new Date(mesa.ends_at).getTime() - ahora
              : 0;

            const borde =
              fase === "vencida"
                ? "border-[var(--color-danger)] bg-[var(--color-danger)]/15 animate-pulse"
                : fase === "por-terminar"
                  ? "border-[var(--color-busy)] bg-[var(--color-busy)]/10 animate-pulse"
                  : fase === "jugando"
                    ? "border-[var(--color-free)]/60 bg-[var(--color-free)]/5"
                    : "border-[var(--color-border)] bg-[var(--color-surface)]";

            const tinta =
              fase === "vencida"
                ? "text-[var(--color-danger)]"
                : fase === "por-terminar"
                  ? "text-[var(--color-busy)]"
                  : fase === "jugando"
                    ? "text-[var(--color-ink)]"
                    : "text-[var(--color-muted)]";

            return (
              <li key={mesa.table_id}>
                <article
                  className={`flex min-h-64 flex-col items-center justify-center rounded-3xl border-4 p-8 text-center transition-colors ${borde}`}
                >
                  <p className="text-xl font-bold tracking-[0.15em] text-[var(--color-muted)] uppercase">
                    Mesa {mesa.table_number}
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
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
