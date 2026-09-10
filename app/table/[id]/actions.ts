"use server";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { AlertType } from "@/lib/types";

export type CallResult = {
  ok: boolean;
  /** true si ya había un llamado igual sin atender. */
  alreadyPending: boolean;
  error: string | null;
};

const VALID_TYPES: AlertType[] = ["llamar_mozo", "pedir_cuenta"];

/**
 * Registra un llamado del cliente.
 *
 * Corre sin sesión: el cliente no se loguea. La RLS permite a `anon` insertar
 * en `alerts` únicamente en estado 'pendiente' y con un tipo válido, así que
 * este es todo el acceso que tiene la mesa a la base.
 */
export async function callStaff(
  tableId: string,
  type: AlertType
): Promise<CallResult> {
  if (!VALID_TYPES.includes(type)) {
    return { ok: false, alreadyPending: false, error: "Pedido no válido." };
  }

  const supabase = await getSupabaseServerClient();

  // La mesa tiene que existir; si el QR está mal, no creamos alertas huérfanas.
  const { data: table } = await supabase
    .from("tables")
    .select("id")
    .eq("id", tableId)
    .maybeSingle();

  if (!table) {
    return { ok: false, alreadyPending: false, error: "Mesa no encontrada." };
  }

  const { error } = await supabase
    .from("alerts")
    .insert({ table_id: tableId, type });

  if (error) {
    // 23505 = índice único parcial: ya hay un llamado igual sin atender.
    // Para el cliente no es un error: su pedido sigue en pie.
    if (error.code === "23505") {
      return { ok: true, alreadyPending: true, error: null };
    }
    return {
      ok: false,
      alreadyPending: false,
      error: "No pudimos avisar. Probá de nuevo en unos segundos.",
    };
  }

  return { ok: true, alreadyPending: false, error: null };
}
