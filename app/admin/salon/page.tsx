import { requireAdmin } from "@/lib/auth";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { FloorEditor } from "./floor-editor";
import type { BarTable, Sector } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function SalonEditorPage() {
  // El plano lo edita el encargado; el RPC vuelve a exigirlo del lado de la base.
  await requireAdmin();

  const supabase = await getSupabaseServerClient();

  const [sectoresRes, mesasRes, abiertasRes] = await Promise.all([
    supabase.from("sectors").select("*").order("sort_order").order("name"),
    supabase.from("tables").select("*").order("number"),
    supabase.from("orders").select("table_id").eq("status", "abierta"),
  ]);

  const ocupadas = ((abiertasRes.data ?? []) as { table_id: string }[]).map(
    (o) => o.table_id
  );

  return (
    <FloorEditor
      sectors={(sectoresRes.data ?? []) as Sector[]}
      tables={(mesasRes.data ?? []) as BarTable[]}
      ocupadas={ocupadas}
    />
  );
}
