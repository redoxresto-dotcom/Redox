"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { playBeep } from "@/lib/beep";
import {
  activatePoolReservation,
  addPoolTable,
  createPoolReservation,
  endPoolSession,
  expireDuePoolSessions,
  logPoolMaintenance,
  releasePoolReservation,
  removePoolTable,
  sellPoolTime,
  setPoolPlayers,
  updatePoolTable,
} from "./actions";
import {
  formatMoney,
  normalizarCelularUy,
  POOL_BLOQUES,
  POOL_LECTOR_TIMEOUT_MS,
  nombreMesa,
  POOL_RESERVA_BLOQUES,
  POOL_RESERVA_DEMORA_MINUTES,
  POOL_RESERVA_TARDE_MINUTES,
  poolMinutosATexto,
  type PoolReservation,
  type PoolStatus,
} from "@/lib/types";

type MesaCandidata = { id: string; number: number; name: string | null };

type Props = {
  estado: PoolStatus[];
  tarifa: { id: string; name: string; price: number } | null;
  candidatas: MesaCandidata[];
  reservas: PoolReservation[];
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

// El borde de color acá es la señal de estado, igual que en el resto de las
// pantallas de monitor: se mantiene aunque el resto pase a vidrio.
const TONO: Record<Fase, string> = {
  libre: "border-transparent bg-white/5 backdrop-blur-xl",
  jugando: "border-[var(--color-free)]/60 bg-[var(--color-free)]/10 backdrop-blur-xl",
  "por-terminar":
    "border-[var(--color-busy)] bg-[var(--color-busy)]/15 backdrop-blur-xl animate-pulse",
  vencida: "border-[var(--color-danger)] bg-[var(--color-danger)]/15 backdrop-blur-xl",
};

/** "14:30" — la hora del turno, que es lo que se lee de un vistazo. */
function horaCorta(iso: string): string {
  // Siempre en hora de Montevideo y 24 h: el timestamp viene en UTC y no puede
  // depender del reloj del dispositivo ni de dónde corra el render.
  return new Date(iso).toLocaleTimeString("es-UY", {
    timeZone: "America/Montevideo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

type Demora = "en-hora" | "demorado" | "tarde";

/** Un turno cuya hora ya pasó y sigue sin activarse: cliente demorado. */
function demoraDe(iso: string, ahora: number): Demora {
  const atraso = ahora - new Date(iso).getTime();
  if (atraso < POOL_RESERVA_DEMORA_MINUTES * 60_000) return "en-hora";
  if (atraso < POOL_RESERVA_TARDE_MINUTES * 60_000) return "demorado";
  return "tarde";
}

const DEMORA_TINTA: Record<Demora, string> = {
  "en-hora": "text-[var(--color-muted)]",
  demorado: "text-[var(--color-busy)]",
  tarde: "font-semibold text-[var(--color-danger)]",
};

export function PoolBoard({
  estado,
  tarifa,
  candidatas,
  reservas,
  isManager,
}: Props) {
  const router = useRouter();
  const [ahora, setAhora] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState(false);
  const [reservaAbierta, setReservaAbierta] = useState(false);
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

  function run(fn: () => Promise<{ error: string | null }>) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (result.error) setError(result.error);
      else router.refresh();
    });
  }

  const jugando = estado.filter((m) => m.session_id).length;

  // Sólo los turnos pendientes, agrupados por mesa y en orden de hora. Los ya
  // activados o liberados no son cola: se ven en el listado del día.
  const reservasPorMesa = new Map<string, PoolReservation[]>();
  for (const r of reservas) {
    if (r.status !== "reservada") continue;
    const lista = reservasPorMesa.get(r.table_id) ?? [];
    lista.push(r);
    reservasPorMesa.set(r.table_id, lista);
  }
  for (const lista of reservasPorMesa.values()) {
    lista.sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
  }
  const pendientes = reservas.filter((r) => r.status === "reservada").length;

  const mesasPool = estado.map((m) => ({
    id: m.table_id,
    label: nombreMesa(m.table_number, m.table_name),
  }));

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

        <div className="flex flex-wrap items-center justify-end gap-2">
          {isManager ? (
            <button
              type="button"
              onClick={() => setReservaAbierta((v) => !v)}
              className="rounded-lg bg-white/5 px-3 py-2 text-sm whitespace-nowrap text-[var(--color-muted)] backdrop-blur-md transition-colors hover:bg-white/10 hover:text-[var(--color-ink)]"
            >
              {reservaAbierta ? "Cerrar reserva" : "Reserva Pool"}
              {pendientes > 0 && !reservaAbierta ? (
                <span className="ml-1.5 rounded-full bg-[var(--color-accent)]/20 px-1.5 py-0.5 text-xs font-semibold text-[var(--color-accent)] tabular-nums">
                  {pendientes}
                </span>
              ) : null}
            </button>
          ) : null}
          <Link
            href="/pool"
            target="_blank"
            className="rounded-lg bg-white/5 px-3 py-2 text-sm whitespace-nowrap text-[var(--color-muted)] backdrop-blur-md transition-colors hover:bg-white/10 hover:text-[var(--color-ink)]"
          >
            Pantalla del salón ↗
          </Link>
          {isManager ? (
            <>
              <Link
                href="/admin/pool/reservas"
                className="rounded-lg bg-white/5 px-3 py-2 text-sm whitespace-nowrap text-[var(--color-muted)] backdrop-blur-md transition-colors hover:bg-white/10 hover:text-[var(--color-ink)]"
              >
                Reservas del día
              </Link>
              <button
                type="button"
                onClick={() => setConfig((c) => !c)}
                className="rounded-lg bg-white/5 px-3 py-2 text-sm whitespace-nowrap text-[var(--color-muted)] backdrop-blur-md transition-colors hover:bg-white/10 hover:text-[var(--color-ink)]"
              >
                {config ? "Cerrar ajustes" : "Ajustes"}
              </button>
            </>
          ) : null}
        </div>
      </header>

      {reservaAbierta && isManager ? (
        <PanelReserva
          mesasPool={mesasPool}
          reservas={reservas}
          isPending={isPending}
          onRun={run}
          onListo={() => setReservaAbierta(false)}
        />
      ) : null}

      {error ? (
        <p
          role="alert"
          className="mb-4 rounded-lg bg-[var(--color-danger)]/15 px-3 py-2 text-sm text-[var(--color-danger)] backdrop-blur-md"
        >
          {error}
        </p>
      ) : null}

      {!tarifa ? (
        <p className="mb-4 rounded-lg bg-[var(--color-busy)]/15 px-3 py-2 text-sm text-[var(--color-busy)] backdrop-blur-md">
          No hay ningún producto marcado como tarifa de pool en el catálogo. Sin
          eso no se puede vender tiempo: marcá uno en{" "}
          <Link href="/admin/catalogo" className="underline">
            Catálogo
          </Link>
          .
        </p>
      ) : null}

      {estado.length === 0 ? (
        <p className="rounded-2xl bg-white/5 px-4 py-12 text-center text-sm text-[var(--color-muted)] backdrop-blur-xl">
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

      {pendientes > 0 ? (
        <ReservasPendientes
          estado={estado}
          reservasPorMesa={reservasPorMesa}
          total={pendientes}
          ahora={ahora}
          isManager={isManager}
          isPending={isPending}
          onRun={run}
        />
      ) : null}

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
        <h2 className="min-w-0 truncate text-xl font-bold">
          {nombreMesa(mesa.table_number, mesa.table_name)}
        </h2>
        <span
          title={
            lectorVivo
              ? "El aparato respondió recién"
              : "El aparato no responde: la mesa puede no estar habilitada"
          }
          className={`ml-auto flex shrink-0 items-center gap-1.5 text-xs ${
            lectorVivo
              ? "text-[var(--color-muted)]"
              : "font-medium text-[var(--color-danger)]"
          }`}
        >
          <span
            className={`inline-block size-2 shrink-0 rounded-full ${
              lectorVivo
                ? "bg-[var(--color-free)]"
                : "animate-pulse bg-[var(--color-danger)]"
            }`}
          />
          <span className="max-w-[9rem] truncate">
            {lectorVivo ? mesa.device_id : "sin señal"}
          </span>
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
              className="w-full rounded-lg bg-white/5 px-2 py-1.5 text-sm shadow-inner shadow-black/20 backdrop-blur-md outline-none focus:bg-white/10 disabled:opacity-50"
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
              className="w-full rounded-lg bg-white/5 px-2 py-2 text-sm shadow-inner shadow-black/20 backdrop-blur-md outline-none focus:bg-white/10"
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
              className="flex-1 rounded-lg bg-white/5 px-2 py-2 text-sm text-[var(--color-muted)] backdrop-blur-md transition-colors hover:bg-white/10 hover:text-[var(--color-ink)]"
            >
              Otro tiempo
            </button>

            {mesa.session_id ? (
              <button
                type="button"
                disabled={isPending}
                onClick={() => onRun(() => endPoolSession(mesa.session_id!))}
                className="flex-1 rounded-lg bg-white/5 px-2 py-2 text-sm text-[var(--color-muted)] backdrop-blur-md transition-colors hover:bg-[var(--color-danger)]/15 hover:text-[var(--color-danger)] disabled:opacity-50"
              >
                Terminar
              </button>
            ) : null}
          </div>
        )}

        {mesa.order_id ? (
          <Link
            href="/admin"
            className="rounded-lg bg-white/5 px-2 py-2 text-center text-sm text-[var(--color-muted)] backdrop-blur-md transition-colors hover:bg-white/10 hover:text-[var(--color-ink)]"
          >
            Ver la cuenta y cobrar
          </Link>
        ) : null}
      </div>

      <footer
        className={`mt-3 border-t border-white/10 pt-2 text-xs ${
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

/**
 * La cola de reservas, junta y debajo de las mesas. Antes iba dentro de cada
 * tarjeta, pero con varias reservas la estiraba y descuadraba la grilla; acá
 * crece para abajo sin tocar el alto de las mesas.
 */
function ReservasPendientes({
  estado,
  reservasPorMesa,
  total,
  ahora,
  isManager,
  isPending,
  onRun,
}: {
  estado: PoolStatus[];
  reservasPorMesa: Map<string, PoolReservation[]>;
  total: number;
  ahora: number;
  isManager: boolean;
  isPending: boolean;
  onRun: (fn: () => Promise<{ error: string | null }>) => void;
}) {
  return (
    <section className="mt-6 rounded-2xl bg-white/5 p-4 shadow-lg shadow-black/10 backdrop-blur-xl sm:p-5">
      <h2 className="mb-3 text-sm font-medium tracking-wide text-[var(--color-muted)] uppercase">
        Reservas pendientes
        <span className="ml-2 rounded-full bg-[var(--color-accent)]/20 px-1.5 py-0.5 text-xs font-semibold text-[var(--color-accent)] tabular-nums">
          {total}
        </span>
      </h2>

      <div className="grid gap-4">
        {estado.map((mesa) => {
          const lista = reservasPorMesa.get(mesa.table_id) ?? [];
          if (lista.length === 0) return null;
          const libre = !mesa.session_id;

          return (
            <div key={mesa.table_id} className="grid gap-1.5">
              <p className="text-xs font-semibold text-[var(--color-muted)]">
                {nombreMesa(mesa.table_number, mesa.table_name)}
                {libre ? (
                  <span className="ml-1.5 font-medium text-[var(--color-free)]">
                    · libre, se puede activar
                  </span>
                ) : (
                  <span className="ml-1.5 font-normal">· en partida</span>
                )}
              </p>

              <ul className="grid gap-1.5">
                {lista.map((r) => {
                  const demora = demoraDe(r.scheduled_at, ahora);
                  return (
                    <li
                      key={r.id}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg bg-white/5 px-3 py-2 text-sm backdrop-blur-md"
                    >
                      <span
                        className={`tabular-nums ${DEMORA_TINTA[demora]}`}
                        title={
                          demora === "en-hora"
                            ? "Turno reservado"
                            : "El cliente ya debería haber llegado"
                        }
                      >
                        {horaCorta(r.scheduled_at)}
                      </span>
                      <span className="min-w-0 flex-1 basis-32 truncate">
                        {r.customer_name}
                        <span className="ml-1.5 text-xs text-[var(--color-muted)]">
                          {poolMinutosATexto(r.play_minutes)}
                        </span>
                      </span>
                      {isManager ? (
                        <div className="flex w-full shrink-0 flex-wrap justify-end gap-1.5 sm:w-auto">
                          <button
                            type="button"
                            disabled={isPending || !libre}
                            title={
                              libre
                                ? "Arranca la partida con esta reserva"
                                : "La mesa está ocupada"
                            }
                            onClick={() =>
                              onRun(() => activatePoolReservation(r.id))
                            }
                            className="rounded-md bg-[var(--color-accent)] px-2.5 py-1 text-xs font-semibold text-[#04121c] disabled:opacity-40"
                          >
                            Activar
                          </button>
                          <button
                            type="button"
                            disabled={isPending}
                            title="Avisó que no viene o se canceló"
                            onClick={() =>
                              onRun(() => releasePoolReservation(r.id))
                            }
                            className="rounded-md bg-white/5 px-2.5 py-1 text-xs text-[var(--color-muted)] backdrop-blur-md transition-colors hover:bg-[var(--color-danger)]/15 hover:text-[var(--color-danger)] disabled:opacity-40"
                          >
                            Liberar
                          </button>
                          <button
                            type="button"
                            disabled={isPending}
                            title="No vino ni avisó"
                            onClick={() =>
                              onRun(() => releasePoolReservation(r.id, true))
                            }
                            className="rounded-md bg-white/5 px-2.5 py-1 text-xs text-[var(--color-muted)] backdrop-blur-md transition-colors hover:bg-[var(--color-danger)]/15 hover:text-[var(--color-danger)] disabled:opacity-40"
                          >
                            No vino
                          </button>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
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
  candidatas: MesaCandidata[];
  isPending: boolean;
  onRun: (fn: () => Promise<{ error: string | null }>) => void;
}) {
  const mesasOrdenadas = useMemo(
    () => [...estado].sort((a, b) => a.table_number - b.table_number),
    [estado],
  );

  return (
    <section className="mt-8 rounded-2xl bg-white/5 p-5 shadow-lg shadow-black/10 backdrop-blur-xl">
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
              className="rounded-lg bg-white/5 px-3 py-2 text-sm shadow-inner shadow-black/20 backdrop-blur-md outline-none focus:bg-white/10"
            >
              {candidatas.map((t) => (
                <option key={t.id} value={t.id}>
                  {nombreMesa(t.number, t.name)}
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
              className="rounded-lg bg-white/5 px-3 py-2 text-sm shadow-inner shadow-black/20 backdrop-blur-md outline-none focus:bg-white/10"
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
            className="flex flex-wrap items-end gap-3 border-t border-white/10 pt-3"
          >
            <span className="min-w-20 font-medium">
              {nombreMesa(mesa.table_number, mesa.table_name)}
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
                className="w-24 rounded-lg bg-white/5 px-2 py-1.5 text-sm tabular-nums shadow-inner shadow-black/20 backdrop-blur-md outline-none focus:bg-white/10"
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
                className="w-24 rounded-lg bg-white/5 px-2 py-1.5 text-sm tabular-nums shadow-inner shadow-black/20 backdrop-blur-md outline-none focus:bg-white/10"
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
              className="w-full rounded-lg bg-white/5 px-3 py-2 text-sm text-[var(--color-muted)] backdrop-blur-md transition-colors hover:bg-[var(--color-free)]/15 hover:text-[var(--color-free)] disabled:opacity-50 sm:w-auto"
            >
              Registrar cambio de paño
            </button>

            <button
              type="button"
              disabled={isPending}
              onClick={() => onRun(() => removePoolTable(mesa.table_id))}
              className="w-full rounded-lg bg-white/5 px-3 py-2 text-sm text-[var(--color-muted)] backdrop-blur-md transition-colors hover:bg-[var(--color-danger)]/15 hover:text-[var(--color-danger)] disabled:opacity-50 sm:ml-auto sm:w-auto"
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

// ---------------------------------------------------------------------------

/** Fecha y hora local en el formato que espera un input datetime-local. */
function ahoraLocalInput(): string {
  const d = new Date();
  d.setSeconds(0, 0);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(
    d.getHours(),
  )}:${p(d.getMinutes())}`;
}

function PanelReserva({
  mesasPool,
  reservas,
  isPending,
  onRun,
  onListo,
}: {
  mesasPool: { id: string; label: string }[];
  reservas: PoolReservation[];
  isPending: boolean;
  onRun: (fn: () => Promise<{ error: string | null }>) => void;
  onListo: () => void;
}) {
  const [tableId, setTableId] = useState(mesasPool[0]?.id ?? "");
  const [minutes, setMinutes] = useState<number>(60);
  const [cuando, setCuando] = useState(ahoraLocalInput);
  const [tel, setTel] = useState("");
  const telNorm = normalizarCelularUy(tel);
  const telMal = tel.trim() !== "" && !telNorm;

  // Aviso, no bloqueo: los clientes se atrasan y adelantan. Se marca si el
  // turno nuevo pisa a otro vigente de la misma mesa.
  const choque = useMemo(() => {
    const ini = new Date(cuando).getTime();
    if (Number.isNaN(ini)) return null;
    const fin = ini + minutes * 60_000;
    return (
      reservas.find((r) => {
        if (r.table_id !== tableId) return false;
        if (r.status !== "reservada" && r.status !== "activada") return false;
        const rIni = new Date(r.scheduled_at).getTime();
        const rFin = rIni + r.play_minutes * 60_000;
        return ini < rFin && rIni < fin;
      }) ?? null
    );
  }, [reservas, tableId, cuando, minutes]);

  if (mesasPool.length === 0) {
    return (
      <section className="mb-5 rounded-2xl bg-white/5 p-5 text-sm text-[var(--color-muted)] backdrop-blur-xl">
        Primero configurá al menos una mesa de pool desde Ajustes.
      </section>
    );
  }

  return (
    <section className="mb-5 rounded-2xl bg-white/5 p-5 shadow-lg shadow-black/10 backdrop-blur-xl">
      <h2 className="text-lg font-medium">Reservar mesa de pool</h2>
      <p className="mt-1 mb-4 text-sm text-[var(--color-muted)]">
        Guarda el turno. No enciende la mesa: cuando llegue el cliente, activá la
        reserva desde su mesa.
      </p>

      <form
        action={(fd) => {
          onRun(() =>
            createPoolReservation({
              tableId,
              customerName: String(fd.get("customer") ?? ""),
              phone: tel,
              scheduledAt: cuando,
              minutes,
            }),
          );
          onListo();
        }}
        className="grid gap-3 sm:grid-cols-2"
      >
        <label className="grid gap-1">
          <span className="text-xs text-[var(--color-muted)]">
            Nombre del cliente
          </span>
          <input
            name="customer"
            required
            autoFocus
            className="rounded-lg bg-white/5 px-3 py-2 text-sm shadow-inner shadow-black/20 backdrop-blur-md outline-none focus:bg-white/10"
          />
        </label>

        <label className="grid gap-1">
          <span className="text-xs text-[var(--color-muted)]">Celular</span>
          <input
            name="phone"
            type="tel"
            required
            inputMode="tel"
            placeholder="09X XXX XXX"
            value={tel}
            onChange={(e) => setTel(e.target.value)}
            aria-invalid={telMal}
            className={`rounded-lg px-3 py-2 text-sm shadow-inner shadow-black/20 backdrop-blur-md outline-none ${
              telMal
                ? "bg-[var(--color-danger)]/10 ring-1 ring-[var(--color-danger)]/50"
                : "bg-white/5 focus:bg-white/10"
            }`}
          />
          {telMal ? (
            <span className="text-xs text-[var(--color-danger)]">
              Celular uruguayo: 09 y siete dígitos más.
            </span>
          ) : null}
        </label>

        <label className="grid gap-1">
          <span className="text-xs text-[var(--color-muted)]">
            Hora del turno
          </span>
          <input
            type="datetime-local"
            required
            value={cuando}
            onChange={(e) => setCuando(e.target.value)}
            className="rounded-lg bg-white/5 px-3 py-2 text-sm shadow-inner shadow-black/20 backdrop-blur-md outline-none focus:bg-white/10"
          />
        </label>

        <label className="grid gap-1">
          <span className="text-xs text-[var(--color-muted)]">
            Horas de juego
          </span>
          <select
            value={minutes}
            onChange={(e) => setMinutes(Number(e.target.value))}
            className="rounded-lg bg-white/5 px-3 py-2 text-sm shadow-inner shadow-black/20 backdrop-blur-md outline-none focus:bg-white/10"
          >
            {POOL_RESERVA_BLOQUES.map((min) => (
              <option key={min} value={min}>
                {poolMinutosATexto(min)}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-1">
          <span className="text-xs text-[var(--color-muted)]">Mesa de pool</span>
          <select
            value={tableId}
            onChange={(e) => setTableId(e.target.value)}
            className="rounded-lg bg-white/5 px-3 py-2 text-sm shadow-inner shadow-black/20 backdrop-blur-md outline-none focus:bg-white/10"
          >
            {mesasPool.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-end">
          <button
            type="submit"
            disabled={isPending || !tableId || !telNorm}
            className="w-full rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-[#04121c] disabled:opacity-50 sm:w-auto"
          >
            Guardar reserva
          </button>
        </div>
      </form>

      {choque ? (
        <p className="mt-3 rounded-lg bg-[var(--color-busy)]/15 px-3 py-2 text-sm text-[var(--color-busy)] backdrop-blur-md">
          Ojo: se pisa con la reserva de {choque.customer_name} a las{" "}
          {horaCorta(choque.scheduled_at)} en esa mesa. Se puede guardar igual.
        </p>
      ) : null}
    </section>
  );
}
