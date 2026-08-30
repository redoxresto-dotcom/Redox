import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import {
  formatCelularUy,
  nombreMesa,
  poolMinutosATexto,
  type PoolReservation,
  type PoolReservationStatus,
} from "@/lib/types";

export const dynamic = "force-dynamic";

const ESTADO_LABEL: Record<PoolReservationStatus, string> = {
  reservada: "Reservada",
  activada: "Activada",
  liberada: "Liberada",
  no_show: "No vino",
  vencida: "Vencida",
};

const ESTADO_TINTA: Record<PoolReservationStatus, string> = {
  reservada: "bg-[var(--color-brand-soft)]/15 text-[var(--color-brand-soft)]",
  activada: "bg-[var(--color-free)]/15 text-[var(--color-free)]",
  liberada: "bg-[var(--color-surface-2)] text-[var(--color-muted)]",
  no_show: "bg-[var(--color-danger)]/15 text-[var(--color-danger)]",
  vencida: "bg-[var(--color-busy)]/15 text-[var(--color-busy)]",
};

/** Fecha de hoy en hora de Montevideo, en formato YYYY-MM-DD. */
function hoyMontevideo(): string {
  return new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Montevideo",
  });
}

function hora(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-UY", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function ReservasPoolPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  await requireAdmin();

  const params = await searchParams;
  const dia =
    params.d && /^\d{4}-\d{2}-\d{2}$/.test(params.d)
      ? params.d
      : hoyMontevideo();

  const supabase = await getSupabaseServerClient();
  await supabase.rpc("pool_reservations_expire_due");
  const { data } = await supabase.rpc("pool_day_reservations", { p_date: dia });
  const reservas = (data ?? []) as PoolReservation[];

  const cuenta = (estado: PoolReservationStatus) =>
    reservas.filter((r) => r.status === estado).length;

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Reservas de pool</h1>
          <p className="text-sm text-[var(--color-muted)]">
            {reservas.length === 0
              ? "Sin reservas para el día elegido."
              : `${reservas.length} en total · ${cuenta("reservada")} pendientes · ${cuenta(
                  "activada",
                )} activadas · ${cuenta("liberada")} liberadas · ${cuenta(
                  "no_show",
                )} no vinieron · ${cuenta("vencida")} vencidas`}
          </p>
        </div>

        <div className="flex items-end gap-2">
          <form method="get" className="flex items-end gap-2">
            <label className="grid gap-1">
              <span className="text-xs text-[var(--color-muted)]">Día</span>
              <input
                type="date"
                name="d"
                defaultValue={dia}
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
              />
            </label>
            <button
              type="submit"
              className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-[#04121c]"
            >
              Ver
            </button>
          </form>
          <Link
            href="/admin/pool"
            className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-muted)] transition-colors hover:text-[var(--color-ink)]"
          >
            ← Panel
          </Link>
        </div>
      </header>

      {reservas.length === 0 ? (
        <p className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-12 text-center text-sm text-[var(--color-muted)]">
          No hay reservas registradas para ese día.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="text-left text-xs tracking-wide text-[var(--color-muted)] uppercase">
                <th className="px-4 py-3 font-normal">Hora</th>
                <th className="px-4 py-3 font-normal">Mesa</th>
                <th className="px-4 py-3 font-normal">Cliente</th>
                <th className="px-4 py-3 font-normal">Celular</th>
                <th className="px-4 py-3 font-normal">Juego</th>
                <th className="px-4 py-3 font-normal">Estado</th>
                <th className="px-4 py-3 font-normal">Detalle</th>
              </tr>
            </thead>
            <tbody>
              {reservas.map((r) => (
                <tr
                  key={r.id}
                  className="border-t border-[var(--color-border)]"
                >
                  <td className="px-4 py-2.5 tabular-nums">
                    {hora(r.scheduled_at)}
                  </td>
                  <td className="px-4 py-2.5">
                    {nombreMesa(r.table_number, r.table_name)}
                  </td>
                  <td className="px-4 py-2.5 font-medium">{r.customer_name}</td>
                  <td className="px-4 py-2.5 tabular-nums text-[var(--color-muted)]">
                    {formatCelularUy(r.phone)}
                  </td>
                  <td className="px-4 py-2.5 text-[var(--color-muted)]">
                    {poolMinutosATexto(r.play_minutes)}
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${ESTADO_TINTA[r.status]}`}
                    >
                      {ESTADO_LABEL[r.status]}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-[var(--color-muted)]">
                    {r.status === "activada" && r.activated_at
                      ? `Activó ${r.activated_by_name ?? "—"} · ${hora(r.activated_at)}`
                      : (r.status === "liberada" || r.status === "no_show") &&
                          r.released_at
                        ? `${r.status === "no_show" ? "Marcó" : "Liberó"} ${
                            r.released_by_name ?? "—"
                          } · ${hora(r.released_at)}`
                        : `Cargó ${r.created_by_name ?? "—"} · ${hora(r.created_at)}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 text-xs text-[var(--color-muted)]">
        Una reserva no enciende la mesa. Cuando llega el cliente, se activa desde
        su mesa en el panel de pool y recién ahí arranca el tiempo.
      </p>
    </main>
  );
}
