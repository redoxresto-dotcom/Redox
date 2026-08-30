import { requireStaff } from "@/lib/auth";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { PoolBoard } from "./pool-board";
import {
  hasRank,
  type BarTable,
  type PoolReservation,
  type PoolStatus,
} from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function PoolPage() {
  const profile = await requireStaff();
  const supabase = await getSupabaseServerClient();

  // Cierra lo que ya venció antes de mostrar nada. Si los aparatos están
  // desconectados, esta es la única forma de que el reloj avance.
  await Promise.all([
    supabase.rpc("pool_expire_due"),
    supabase.rpc("pool_reservations_expire_due"),
  ]);

  const [estadoRes, tarifaRes, mesasRes, reservasRes] = await Promise.all([
    supabase.rpc("pool_status"),
    supabase
      .from("products")
      .select("id, name, price")
      .eq("is_pool_rate", true)
      .maybeSingle<{ id: string; name: string; price: number }>(),
    // Mesas del salón que todavía no son de pool: las candidatas a serlo.
    supabase.from("tables").select("id, number").order("number"),
    supabase.rpc("pool_day_reservations"),
  ]);

  const estado = (estadoRes.data ?? []) as PoolStatus[];
  const yaSonPool = new Set(estado.map((e) => e.table_id));

  const candidatas = (
    (mesasRes.data ?? []) as Pick<BarTable, "id" | "number">[]
  )
    .filter((t) => !yaSonPool.has(t.id))
    .map((t) => ({ id: t.id, number: t.number }));

  return (
    <PoolBoard
      estado={estado}
      tarifa={tarifaRes.data ?? null}
      candidatas={candidatas}
      reservas={(reservasRes.data ?? []) as PoolReservation[]}
      isManager={hasRank(profile.role, "admin")}
    />
  );
}
