import type { Metadata } from "next";
import { requireStaff } from "@/lib/auth";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { PoolTv } from "./pool-tv";
import type { PoolStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Pool — Redox",
  robots: { index: false, follow: false },
};

/**
 * La pantalla del salón.
 *
 * Se abre una vez en el televisor y se deja puesta. La miran los clientes desde
 * el otro lado del salón, así que todo está pensado para leerse de lejos: un
 * número grande por mesa y nada más.
 *
 * Pide sesión igual que el resto: no es una pantalla pública de internet, es
 * una pantalla del local.
 */
export default async function PoolTvPage() {
  await requireStaff();

  const supabase = await getSupabaseServerClient();

  // Cierra lo vencido antes de dibujar. Si los aparatos están desconectados,
  // esta pantalla es la que hace avanzar el reloj.
  await supabase.rpc("pool_expire_due");

  const { data } = await supabase.rpc("pool_status");

  return <PoolTv estado={(data ?? []) as PoolStatus[]} />;
}
