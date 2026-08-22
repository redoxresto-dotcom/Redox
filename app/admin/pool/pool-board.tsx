"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { playBeep } from "@/lib/beep";
import {
  addPoolTable,
  endPoolSession,
  expireDuePoolSessions,
  logPoolMaintenance,
  removePoolTable,
  sellPoolTime,
  setPoolPlayers,
  updatePoolTable,
} from "./actions";
import {
  formatMoney,
  POOL_BLOQUES,
  POOL_LECTOR_TIMEOUT_MS,
  poolMinutosATexto,
  type PoolStatus,
} from "@/lib/types";

type Props = {
  estado: PoolStatus[];
  tarifa: { id: string; name: string; price: number } | null;
  candidatas: { id: string; number: number }[];
  isManager: boolean;
};

type Fase = "libre" | "jugando" | "por-terminar" | "vencida";

/** "45:12" — lo que falta, que es lo único que mira quien atiende. */
function faltan(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const dosDigitos = (n: number) => String(n).padStart(2, "0");
  return h > 0
    ? `${h}:${dosDigitos(m)}:${dosDigitos(s)}`
    : `${dosDigitos(m)}:${dosDigitos(s)}`;
}

function faseDe(mesa: PoolStatus, ahora: number): Fase {
  if (!mesa.ends_at) return "libre";
  const restante = new Date(mesa.ends_at).getTime() - ahora;
  if (restante <= 0) return "vencida";
  if (restante <= mesa.warning_minutes * 60_000) return "por-terminar";
  return "jugando";
}

const TONO: Record<Fase, string> = {
  libre: "border-[var(--color-border)] bg-[var(--color-surface)]",
  jugando: "border-[var(--color-free)]/60 bg-[var(--color-free)]/10",
  "por-terminar":
    "border-[var(--color-busy)] bg-[var(--color-busy)]/15 animate-pulse",
  vencida: "border-[var(--color-danger)] bg-[var(--color-danger)]/15",
};

export function PoolBoard({ estado, tarifa, candidatas, isManager }: Props) {
  const router = useRouter();
  const [ahora, setAhora] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState(false);
  const [isPending, startTransition] = useTransition();

  // El reloj corre acá: el servidor manda la hora de corte y cada pantalla
  // calcula. Así dos pantallas nunca muestran números distintos.
  useEffect(() => {
    const id = setInterval(() => setAhora(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Una partida que vence tiene que cerrarse aunque el aparato esté
  // desconectado: al detectarlo, se le pide al servidor que lo haga.
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

  // Aviso sonoro cuando una mesa entra en los últimos minutos.
  const avisadas = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const mesa of estado) {
      if (!mesa.session_id) continue;
      const fase = faseDe(mesa, ahora);
      if (fase === "por-terminar" && !avisadas.current.has(mesa.session_id)) {
        avisadas.current.add(mesa.session_id);
        playBeep(880, 1320);
      }
      if (fase === "jugando") avisadas.current.delete(mesa.session_id);
    }
  }, [estado, ahora]);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    const channel = supabase
      .channel("pool")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pool_sessions" },
        () => router.refresh(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pool_tables" },
        () => router.refresh(),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [router]);

  function run(fn: () => Promise<{ error: string | null }>) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (result.error) setError(result.error);
      else router.refresh();
    });
  }

  const jugando = estado.filter((m) => m.session_id).length;

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Pool</h1>
          <p className="text-sm text-[var(--color-muted)]">
            {estado.length === 0
              ? "Todavía no hay mesas de pool configuradas."
              : `${jugando} de ${estado.length} en juego`}
            {tarifa ? ` · ${formatMoney(tarifa.price)} la hora` : null}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/pool"
            target="_blank"
            className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-muted)] transition-colors hover:text-[var(--color-ink)]"
          >
            Pantalla del salón ↗
          </Link>
          {isManager ? (
            <button
              type="button"
              onClick={() => setConfig((c) => !c)}
              className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-muted)] transition-colors hover:text-[var(--color-ink)]"
            >
              {config ? "Cerrar ajustes" : "Ajustes"}
            </button>
          ) : null}
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

      {!tarifa ? (
        <p className="mb-4 rounded-lg border border-[var(--color-busy)]/40 bg-[var(--color-busy)]/10 px-3 py-2 text-sm text-[var(--color-busy)]">
          No hay ningún producto marcado como tarifa de pool en el catálogo. Sin
          eso no se puede vender tiempo: marcá uno en{" "}
          <Link href="/admin/catalogo" className="underline">
            Catálogo
          </Link>
          .
        </p>
      ) : null}

      {estado.length === 0 ? (
        <p className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-12 text-center text-sm text-[var(--color-muted)]">
          {isManager
            ? "Agregá las mesas de pool desde Ajustes."
            : "Pedile a un encargado que configure las mesas de pool."}
        </p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {estado.map((mesa) => (
            <li key={mesa.table_id}>
              <MesaPool
                key={mesa.session_id ?? "libre"}
                mesa={mesa}
                ahora={ahora}
                isPending={isPending}
                onRun={run}
              />
            </li>
          ))}
        </ul>
      )}

      {config && isManager ? (
        <Ajustes
          estado={estado}
          candidatas={candidatas}
          isPending={isPending}
          onRun={run}
        />
      ) : null}
    </main>
  );
}

// ---------------------------------------------------------------------------

function MesaPool({
  mesa,
  ahora,
  isPending,
  onRun,
}: {
  mesa: PoolStatus;
  ahora: number;
  isPending: boolean;
  onRun: (fn: () => Promise<{ error: string | null }>) => void;
}) {
  const [otro, setOtro] = useState(false);
  const fase = faseDe(mesa, ahora);
  const restante = mesa.ends_at ? new Date(mesa.ends_at).getTime() - ahora : 0;

  // Un aparato que no saluda hace más de un minuto está caído. Preguntar cada
  // quince segundos y no aparecer en sesenta no es demora, es un problema.
  const lectorVivo =
    mesa.last_seen_at !== null &&
    ahora - new Date(mesa.last_seen_at).getTime() < POOL_LECTOR_TIMEOUT_MS;

  const pañoVencido = mesa.hours_played >= mesa.felt_threshold_hours;

  return (
    <article
      className={`flex h-full flex-col rounded-2xl border-2 p-4 transition-colors ${TONO[fase]}`}
    >
      <header className="flex items-baseline gap-2">
        <h2 className="text-xl font-bold">Mesa {mesa.table_number}</h2>
        <span
          title={
            lectorVivo
              ? "El aparato respondió recién"
              : "El aparato no responde: la mesa puede no estar habilitada"
          }
          className={`ml-auto flex items-center gap-1.5 text-xs ${
            lectorVivo
              ? "text-[var(--color-muted)]"
              : "font-medium text-[var(--color-danger)]"
          }`}
        >
          <span
            className={`inline-block size-2 rounded-full ${
              lectorVivo
                ? "bg-[var(--color-free)]"
                : "animate-pulse bg-[var(--color-danger)]"
            }`}
          />
          {lectorVivo ? mesa.device_id : "sin señal"}
        </span>
      </header>

      <div className="my-4 text-center">
        {fase === "libre" ? (
          <>
            <p className="text-4xl font-bold text-[var(--color-muted)]">—</p>
            <p className="mt-1 text-sm text-[var(--color-muted)]">Libre</p>
          </>
        ) : (
          <>
            <p
              className={`text-5xl leading-none font-bold tabular-nums ${
                fase === "vencida"
                  ? "text-[var(--color-danger)]"
                  : fase === "por-terminar"
                    ? "text-[var(--color-busy)]"
                    : ""
              }`}
            >
              {faltan(restante)}
            </p>
            <p className="mt-1.5 text-sm">
              {fase === "vencida" ? (
                <span className="font-semibold text-[var(--color-danger)]">
                  Tiempo cumplido
                </span>
              ) : fase === "por-terminar" ? (
                <span className="font-semibold text-[var(--color-busy)]">
                  Últimos minutos
                </span>
              ) : (
                <span className="text-[var(--color-muted)]">
                  {poolMinutosATexto(mesa.purchased_minutes)} vendidos
                </span>
              )}
            </p>
          </>
        )}
      </div>

      {mesa.order_total !== null && Number(mesa.order_total) > 0 ? (
        <p className="mb-3 text-center text-sm text-[var(--color-muted)]">
          En la cuenta:{" "}
          <span className="font-medium text-[var(--color-ink)] tabular-nums">
            {formatMoney(Number(mesa.order_total))}
          </span>
        </p>
      ) : null}

      {mesa.session_id ? (
        <div className="mb-3 grid grid-cols-2 gap-1.5">
          {(["player_one", "player_two"] as const).map((campo, i) => (
            <input
              key={campo}
              // La clave incluye la partida: al entrar un grupo nuevo, el campo
              // se vuelve a montar en blanco en vez de arrastrar el nombre
              // anterior.
              defaultValue={mesa[campo] ?? ""}
              placeholder={`Jugador ${i + 1}`}
              disabled={isPending}
              onBlur={(e) => {
                const valor = e.target.value.trim();
                if (valor === (mesa[campo] ?? "")) return;
                onRun(() =>
                  setPoolPlayers(
                    mesa.session_id!,
                    campo === "player_one" ? valor : (mesa.player_one ?? ""),
                    campo === "player_two" ? valor : (mesa.player_two ?? ""),
                  ),
                );
              }}
              className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1.5 text-sm outline-none focus:border-[var(--color-accent)] disabled:opacity-50"
            />
          ))}
        </div>
      ) : null}

      <div className="mt-auto grid gap-2">
        <div className="grid grid-cols-3 gap-1.5">
          {POOL_BLOQUES.map((min) => (
            <button
              key={min}
              type="button"
              disabled={isPending}
              onClick={() => onRun(() => sellPoolTime(mesa.table_id, min))}
              className="rounded-lg bg-[var(--color-accent)] px-2 py-2.5 text-sm font-semibold text-[#04121c] disabled:opacity-50"
            >
              {poolMinutosATexto(min)}
            </button>
          ))}
        </div>

        {otro ? (
          <form
            action={(fd) => {
              const min = Number(fd.get("minutes"));
              onRun(() => sellPoolTime(mesa.table_id, min));
              setOtro(false);
            }}
            className="flex gap-1.5"
          >
            <input
              name="minutes"
              type="number"
              min={1}
              max={mesa.max_block_minutes}
              required
              autoFocus
              placeholder="Minutos"
              className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
            />
            <button
              type="submit"
              disabled={isPending}
              className="rounded-lg bg-[var(--color-accent)] px-3 py-2 text-sm font-semibold text-[#04121c] disabled:opacity-50"
            >
              Vender
            </button>
            <button
              type="button"
              onClick={() => setOtro(false)}
              className="px-2 text-[var(--color-muted)]"
            >
              ✕
            </button>
          </form>
        ) : (
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => setOtro(true)}
              className="flex-1 rounded-lg border border-[var(--color-border)] px-2 py-2 text-sm text-[var(--color-muted)] transition-colors hover:text-[var(--color-ink)]"
            >
              Otro tiempo
            </button>

            {mesa.session_id ? (
              <button
                type="button"
                disabled={isPending}
                onClick={() => onRun(() => endPoolSession(mesa.session_id!))}
                className="flex-1 rounded-lg border border-[var(--color-border)] px-2 py-2 text-sm text-[var(--color-muted)] transition-colors hover:border-[var(--color-danger)] hover:text-[var(--color-danger)] disabled:opacity-50"
              >
                Terminar
              </button>
            ) : null}
          </div>
        )}

        {mesa.order_id ? (
          <Link
            href="/admin"
            className="rounded-lg border border-[var(--color-border)] px-2 py-2 text-center text-sm text-[var(--color-muted)] transition-colors hover:text-[var(--color-ink)]"
          >
            Ver la cuenta y cobrar
          </Link>
        ) : null}
      </div>

      <footer
        className={`mt-3 border-t border-[var(--color-border)] pt-2 text-xs ${
          pañoVencido
            ? "font-medium text-[var(--color-busy)]"
            : "text-[var(--color-muted)]"
        }`}
      >
        Paño: {mesa.hours_played} de {mesa.felt_threshold_hours} h
        {pañoVencido ? " · toca cambiarlo" : null}
      </footer>
    </article>
  );
}

// ---------------------------------------------------------------------------

function Ajustes({
  estado,
  candidatas,
  isPending,
  onRun,
}: {
  estado: PoolStatus[];
  candidatas: { id: string; number: number }[];
  isPending: boolean;
  onRun: (fn: () => Promise<{ error: string | null }>) => void;
}) {
  const mesasOrdenadas = useMemo(
    () => [...estado].sort((a, b) => a.table_number - b.table_number),
    [estado],
  );

  return (
    <section className="mt-8 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
      <h2 className="text-lg font-medium">Ajustes de las mesas de pool</h2>
      <p className="mt-1 mb-4 text-sm text-[var(--color-muted)]">
        Una mesa de pool es una mesa del salón con un aparato asignado. El
        identificador tiene que ser el mismo que trae grabado el ESP32.
      </p>

      {candidatas.length > 0 ? (
        <form
          action={(fd) =>
            onRun(() =>
              addPoolTable(
                String(fd.get("table_id")),
                String(fd.get("device_id")),
              ),
            )
          }
          className="mb-5 flex flex-wrap items-end gap-2"
        >
          <label className="grid gap-1">
            <span className="text-xs text-[var(--color-muted)]">Mesa</span>
            <select
              name="table_id"
              className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
            >
              {candidatas.map((t) => (
                <option key={t.id} value={t.id}>
                  Mesa {t.number}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1">
            <span className="text-xs text-[var(--color-muted)]">
              Identificador del aparato
            </span>
            <input
              name="device_id"
              required
              placeholder="pool-1"
              className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
            />
          </label>

          <button
            type="submit"
            disabled={isPending}
            className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-[#04121c] disabled:opacity-50"
          >
            Agregar
          </button>
        </form>
      ) : null}

      <ul className="grid gap-3">
        {mesasOrdenadas.map((mesa) => (
          <li
            key={mesa.table_id}
            className="flex flex-wrap items-end gap-3 border-t border-[var(--color-border)] pt-3"
          >
            <span className="min-w-20 font-medium">
              Mesa {mesa.table_number}
            </span>

            <label className="grid gap-1">
              <span className="text-xs text-[var(--color-muted)]">
                Aviso (min)
              </span>
              <input
                type="number"
                min={0}
                max={60}
                defaultValue={mesa.warning_minutes}
                onBlur={(e) => {
                  const v = Number(e.target.value);
                  if (v !== mesa.warning_minutes) {
                    onRun(() =>
                      updatePoolTable(mesa.table_id, { warning_minutes: v }),
                    );
                  }
                }}
                className="w-24 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1.5 text-sm tabular-nums outline-none focus:border-[var(--color-accent)]"
              />
            </label>

            <label className="grid gap-1">
              <span className="text-xs text-[var(--color-muted)]">
                Paño cada (h)
              </span>
              <input
                type="number"
                min={1}
                defaultValue={mesa.felt_threshold_hours}
                onBlur={(e) => {
                  const v = Number(e.target.value);
                  if (v !== mesa.felt_threshold_hours) {
                    onRun(() =>
                      updatePoolTable(mesa.table_id, {
                        felt_threshold_hours: v,
                      }),
                    );
                  }
                }}
                className="w-24 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1.5 text-sm tabular-nums outline-none focus:border-[var(--color-accent)]"
              />
            </label>

            <button
              type="button"
              disabled={isPending}
              onClick={() =>
                onRun(() =>
                  logPoolMaintenance(
                    mesa.table_id,
                    "paño",
                    mesa.hours_played,
                    "",
                  ),
                )
              }
              className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-muted)] transition-colors hover:border-[var(--color-free)] hover:text-[var(--color-free)] disabled:opacity-50"
            >
              Registrar cambio de paño
            </button>

            <button
              type="button"
              disabled={isPending}
              onClick={() => onRun(() => removePoolTable(mesa.table_id))}
              className="ml-auto rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-muted)] transition-colors hover:border-[var(--color-danger)] hover:text-[var(--color-danger)] disabled:opacity-50"
            >
              Quitar
            </button>
          </li>
        ))}
      </ul>

      <p className="mt-4 text-xs text-[var(--color-muted)]">
        Registrar el cambio de paño guarda las horas que tenía la mesa y
        reinicia el contador. Quitar una mesa de pool no la borra del salón: le
        saca el aparato y su configuración, y conserva su historia.
      </p>
    </section>
  );
}
