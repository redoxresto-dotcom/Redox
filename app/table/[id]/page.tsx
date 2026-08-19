import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { TableClient } from "./table-client";
import type { Alert, BarTable, MenuItem } from "@/lib/types";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const metadata: Metadata = {
  title: "Tu mesa — Redox",
  robots: { index: false, follow: false },
};

/**
 * Página a la que llega el cliente al escanear el QR de su mesa.
 *
 * El id es el UUID de la mesa, no su número: así nadie puede escribir
 * /table/7 desde la vereda y hacer sonar la barra por una mesa ajena.
 */
export default async function TablePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const supabase = await getSupabaseServerClient();

  const [tableRes, alertsRes, menuRes] = await Promise.all([
    supabase.from("tables").select("id, number").eq("id", id).maybeSingle(),
    supabase
      .from("alerts")
      .select("type")
      .eq("table_id", id)
      .eq("status", "pendiente"),
    // De la vista `menu`, no de `products`: es la proyección sin costos, que es
    // lo único que puede ver alguien sin sesión.
    supabase
      .from("menu")
      .select("id, name, price, description, category")
      .order("category")
      .order("name"),
  ]);

  const table = tableRes.data as Pick<BarTable, "id" | "number"> | null;
  if (!table) notFound();

  return (
    <TableClient
      tableId={table.id}
      tableNumber={table.number}
      initialPending={((alertsRes.data ?? []) as Pick<Alert, "type">[]).map(
        (a) => a.type
      )}
      menu={(menuRes.data ?? []) as MenuItem[]}
    />
  );
}
