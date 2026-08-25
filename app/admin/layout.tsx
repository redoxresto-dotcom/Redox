import { requireStaff } from "@/lib/auth";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { AlertMonitor } from "./_components/alert-monitor";
import { Sidebar } from "./_components/sidebar";
import { redirect } from "next/navigation";
import { stationOf, type Alert, type BarTable } from "@/lib/types";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Guard real: aunque el proxy ya filtró, cada render vuelve a validar
  // el usuario y su perfil contra la base.
  const profile = await requireStaff();

  // La barra y la cocina no tienen nada que hacer en el panel: su trabajo son
  // las comandas de todas las mesas. Vale para todo /admin, no solo el salón.
  const station = stationOf(profile.role);
  if (station) redirect(`/estacion/${station}`);

  const supabase = await getSupabaseServerClient();
  const [alertsRes, tablesRes] = await Promise.all([
    supabase
      .from("alerts")
      .select("*")
      .eq("status", "pendiente")
      .order("created_at", { ascending: false }),
    supabase.from("tables").select("id, number"),
  ]);

  const tableNumbers = Object.fromEntries(
    ((tablesRes.data ?? []) as Pick<BarTable, "id" | "number">[]).map((t) => [
      t.id,
      t.number,
    ]),
  );

  return (
    <Sidebar role={profile.role} fullName={profile.full_name}>
      {/* Siempre visible, en cualquier pantalla del panel. */}
      <AlertMonitor
        initialAlerts={(alertsRes.data ?? []) as Alert[]}
        tableNumbers={tableNumbers}
      />

      {children}
    </Sidebar>
  );
}
