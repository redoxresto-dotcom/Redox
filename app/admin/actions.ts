"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/auth";

export type ActionResult = { error: string | null };

const OK: ActionResult = { error: null };

/**
 * Todas las acciones del salón corren con la sesión del mozo, así que la RLS
 * sigue vigente: la UI puede equivocarse, la base no deja pasar nada indebido.
 */

/** Abre (o recupera) la cuenta de una mesa y la marca como ocupada. */
export async function openTable(tableId: string): Promise<ActionResult> {
  await requireStaff();
  const supabase = await getSupabaseServerClient();

  const { error } = await supabase.rpc("open_table_order", {
    p_table_id: tableId,
  });

  if (error) return { error: "No se pudo abrir la mesa: " + error.message };

  revalidatePath("/admin");
  return OK;
}

/**
 * Carga un producto a la mesa. Si ya estaba en la cuenta, suma una unidad en
 * lugar de duplicar la línea.
 *
 * El precio y el costo se copian del catálogo en este momento y quedan
 * congelados: si mañana cambia el precio, esta venta no se altera.
 */
export async function addProductToTable(
  tableId: string,
  productId: string
): Promise<ActionResult> {
  const profile = await requireStaff();
  const supabase = await getSupabaseServerClient();

  const { data: orderId, error: rpcError } = await supabase.rpc(
    "open_table_order",
    { p_table_id: tableId }
  );

  if (rpcError || !orderId) {
    return { error: "No se pudo abrir la cuenta: " + (rpcError?.message ?? "") };
  }

  const { data: product, error: prodError } = await supabase
    .from("products")
    .select("id, price, cost")
    .eq("id", productId)
    .single();

  if (prodError || !product) return { error: "Producto no encontrado." };

  const { data: existing } = await supabase
    .from("order_items")
    .select("id, quantity")
    .eq("order_id", orderId)
    .eq("product_id", productId)
    .maybeSingle();

  const { error } = existing
    ? await supabase
        .from("order_items")
        .update({ quantity: existing.quantity + 1 })
        .eq("id", existing.id)
    : await supabase.from("order_items").insert({
        order_id: orderId,
        product_id: product.id,
        quantity: 1,
        unit_price: product.price,
        unit_cost: product.cost,
        subtotal: 0, // lo calcula el trigger
        created_by: profile.id,
      });

  if (error) return { error: "No se pudo cargar el producto: " + error.message };

  revalidatePath("/admin");
  return OK;
}

/** Suma o resta unidades. Al llegar a cero, borra la línea. */
export async function changeItemQuantity(
  itemId: string,
  delta: number
): Promise<ActionResult> {
  await requireStaff();
  const supabase = await getSupabaseServerClient();

  const { data: item, error: readError } = await supabase
    .from("order_items")
    .select("id, quantity")
    .eq("id", itemId)
    .single();

  if (readError || !item) return { error: "La línea ya no existe." };

  const next = item.quantity + delta;

  const { error } =
    next <= 0
      ? await supabase.from("order_items").delete().eq("id", itemId)
      : await supabase
          .from("order_items")
          .update({ quantity: next })
          .eq("id", itemId);

  if (error) return { error: "No se pudo actualizar: " + error.message };

  revalidatePath("/admin");
  return OK;
}

/** Quita una línea completa de la cuenta. */
export async function removeItem(itemId: string): Promise<ActionResult> {
  await requireStaff();
  const supabase = await getSupabaseServerClient();

  const { error } = await supabase.from("order_items").delete().eq("id", itemId);
  if (error) return { error: "No se pudo quitar: " + error.message };

  revalidatePath("/admin");
  return OK;
}

/** Cobra la cuenta: cierra, libera la mesa y resuelve sus alertas. */
export async function closeOrder(orderId: string): Promise<ActionResult> {
  await requireStaff();
  const supabase = await getSupabaseServerClient();

  const { error } = await supabase.rpc("close_table_order", {
    p_order_id: orderId,
  });

  if (error) return { error: "No se pudo cerrar la cuenta: " + error.message };

  revalidatePath("/admin");
  return OK;
}

/**
 * Libera una mesa abierta por error.
 *
 * Solo procede si la cuenta no tiene ningún consumo: sin esto, una mesa que se
 * abre de más queda ocupada para siempre, porque cobrar exige al menos un ítem.
 * Se borra la cuenta vacía en lugar de cobrarla en $0, para no ensuciar el
 * histórico de ventas con tickets fantasma.
 */
export async function releaseEmptyTable(tableId: string): Promise<ActionResult> {
  await requireStaff();
  const supabase = await getSupabaseServerClient();

  const { data: order } = await supabase
    .from("orders")
    .select("id, order_items(id)")
    .eq("table_id", tableId)
    .eq("status", "abierta")
    .maybeSingle();

  if (order) {
    if ((order.order_items as { id: string }[]).length > 0) {
      return { error: "La mesa tiene consumos: hay que cobrarla, no liberarla." };
    }

    const { error } = await supabase.from("orders").delete().eq("id", order.id);
    if (error) return { error: "No se pudo liberar la mesa: " + error.message };
  }

  const { error } = await supabase
    .from("tables")
    .update({ status: "libre", assigned_waiter: null })
    .eq("id", tableId);

  if (error) return { error: "No se pudo liberar la mesa: " + error.message };

  revalidatePath("/admin");
  return OK;
}

/** El mozo se asigna la mesa, o la suelta si ya era suya. */
export async function toggleTableAssignment(
  tableId: string
): Promise<ActionResult> {
  const profile = await requireStaff();
  const supabase = await getSupabaseServerClient();

  const { data: table } = await supabase
    .from("tables")
    .select("assigned_waiter")
    .eq("id", tableId)
    .single();

  const { error } = await supabase
    .from("tables")
    .update({
      assigned_waiter: table?.assigned_waiter === profile.id ? null : profile.id,
    })
    .eq("id", tableId);

  if (error) return { error: "No se pudo asignar la mesa: " + error.message };

  revalidatePath("/admin");
  return OK;
}

/** Marca una alerta del cliente como atendida. */
export async function resolveAlert(alertId: string): Promise<ActionResult> {
  await requireStaff();
  const supabase = await getSupabaseServerClient();

  const { error } = await supabase
    .from("alerts")
    .update({ status: "resuelta" })
    .eq("id", alertId);

  if (error) return { error: "No se pudo resolver la alerta: " + error.message };

  revalidatePath("/admin");
  return OK;
}
