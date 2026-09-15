import Link from "next/link";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import {
  PREP_STATIONS,
  STATION_LABELS,
  stationOf,
  type Station,
} from "@/lib/types";

export const dynamic = "force-dynamic";

/** Elegir pantalla. Se abre una vez por monitor y no se toca más. */
export default async function EstacionesPage() {
  const profile = await requireStaff();

  // Barra y cocina tienen una sola estación: no eligen, van directo a la suya.
  const propia = stationOf(profile.role);
  if (propia) redirect(`/estacion/${propia}`);

  const supabase = await getSupabaseServerClient();
  const { data } = await supabase
    .from("order_items")
    .select("station, orders!inner(status)")
    .eq("orders.status", "abierta")
    .neq("status", "listo");

  const pendientes = ((data ?? []) as { station: Station }[]).reduce<
    Record<string, number>
  >((acc, row) => {
    acc[row.station] = (acc[row.station] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-semibold">Pantallas de estación</h1>
      <p className="mt-1 text-sm text-[var(--color-muted)]">
        Abrí una en el monitor de la barra y la otra en el de la cocina. Cada una
        muestra solo lo suyo.
      </p>

      <ul className="mt-6 grid gap-3 sm:grid-cols-2">
        {PREP_STATIONS.map((station) => (
          <li key={station}>
            <Link
              href={`/estacion/${station}`}
              className="flex flex-col gap-1 rounded-2xl bg-white/5 p-6 shadow-lg shadow-black/10 backdrop-blur-xl transition-colors hover:bg-white/10"
            >
              <span className="text-xl font-semibold">
                {STATION_LABELS[station]}
              </span>
              <span className="text-sm text-[var(--color-muted)]">
                {pendientes[station]
                  ? `${pendientes[station]} pendiente${pendientes[station] > 1 ? "s" : ""}`
                  : "Sin pendientes"}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
