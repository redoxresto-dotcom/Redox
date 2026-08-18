"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/auth";
import type { ItemStatus } from "@/lib/types";

export type ActionResult = { error: string | null };

const STATUSES: ItemStatus[] = ["pedido", "preparando", "listo"];

/**
 * Avanza (o retrocede) una línea de la cuenta desde la pantalla de su estación.
 *
 * Corre con la sesión del usuario, así que la RLS de order_items sigue
 * decidiendo: si no es personal activo, Postgres lo frena.
 *
 * El estado anterior no se valida contra el nuevo a propósito. Un trago que se
 * sirve al toque va de 'pedido' a 'listo' sin pasar por 'preparando', y una
 * línea marcada por error tiene que poder volver atrás.
 */
export async function setItemStatus(
  itemId: string,
  next: ItemStatus
): Promise<ActionResult> {
  await requireStaff();

  if (!STATUSES.includes(next)) return { error: "Estado desconocido." };

  const supabase = await getSupabaseServerClient();

  const { error } = await supabase
    .from("order_items")
    .update({ status: next })
    .eq("id", itemId);

  if (error) return { error: "No se pudo actualizar la comanda: " + error.message };

  revalidatePath("/estacion", "layout");
  revalidatePath("/admin");
  return { error: null };
}

/** Marca de una todas las líneas pendientes de una mesa en esta estación. */
export async function markTableReady(
  tableId: string,
  station: string
): Promise<ActionResult> {
  await requireStaff();
  const supabase = await getSupabaseServerClient();

  const { data: orders } = await supabase
    .from("orders")
    .select("id")
    .eq("table_id", tableId)
    .eq("status", "abierta");

  const orderIds = (orders ?? []).map((o: { id: string }) => o.id);
  if (orderIds.length === 0) return { error: null };

  const { error } = await supabase
    .from("order_items")
    .update({ status: "listo" })
    .in("order_id", orderIds)
    .eq("station", station)
    .neq("status", "listo");

  if (error) return { error: "No se pudo cerrar la comanda: " + error.message };

  revalidatePath("/estacion", "layout");
  revalidatePath("/admin");
  return { error: null };
}
