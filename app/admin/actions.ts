"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { requireAdmin, requireStaff } from "@/lib/auth";
import { isPaymentMethod, type PaymentMethod } from "@/lib/types";

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
  productId: string,
): Promise<ActionResult> {
  const profile = await requireStaff();
  const supabase = await getSupabaseServerClient();

  const { data: orderId, error: rpcError } = await supabase.rpc(
    "open_table_order",
    { p_table_id: tableId },
  );

  if (rpcError || !orderId) {
    return {
      error: "No se pudo abrir la cuenta: " + (rpcError?.message ?? ""),
    };
  }

  const { data: product, error: prodError } = await supabase
    .from("products")
    .select("id, price, cost")
    .eq("id", productId)
    .single();

  if (prodError || !product) return { error: "Producto no encontrado." };

  // Se suma sobre una línea existente solo si la estación todavía no la tomó.
  // Si el trago ya está en preparación o servido, la unidad nueva va en una
  // línea aparte: sumando sobre la vieja, la barra nunca se entera de que le
  // pidieron otro.
  const { data: existing } = await supabase
    .from("order_items")
    .select("id, quantity")
    .eq("order_id", orderId)
    .eq("product_id", productId)
    .eq("status", "pedido")
    .order("created_at")
    .limit(1)
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

  if (error)
    return { error: "No se pudo cargar el producto: " + error.message };

  revalidatePath("/admin");
  revalidatePath("/estacion", "layout");
  return OK;
}

/** Suma o resta unidades. Al llegar a cero, borra la línea. */
export async function changeItemQuantity(
  itemId: string,
  delta: number,
): Promise<ActionResult> {
  const profile = await requireStaff();
  const supabase = await getSupabaseServerClient();

  const { data: item, error: readError } = await supabase
    .from("order_items")
    .select("id, quantity, status, order_id, product_id, unit_price, unit_cost")
    .eq("id", itemId)
    .single();

  if (readError || !item) return { error: "La línea ya no existe." };

  // Sumar sobre una línea que la estación ya preparó la dejaría invisible para
  // la pantalla: la unidad nueva abre su propia comanda, al mismo precio que
  // el resto de la vuelta.
  if (delta > 0 && item.status !== "pedido") {
    const { error } = await supabase.from("order_items").insert({
      order_id: item.order_id,
      product_id: item.product_id,
      quantity: delta,
      unit_price: item.unit_price,
      unit_cost: item.unit_cost,
      subtotal: 0, // lo calcula el trigger
      created_by: profile.id,
    });

    if (error)
      return { error: "No se pudo cargar el producto: " + error.message };

    revalidatePath("/admin");
    revalidatePath("/estacion", "layout");
    return OK;
  }

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
  revalidatePath("/estacion", "layout");
  return OK;
}

/** Quita una línea completa de la cuenta. */
export async function removeItem(itemId: string): Promise<ActionResult> {
  await requireStaff();
  const supabase = await getSupabaseServerClient();

  const { error } = await supabase
    .from("order_items")
    .delete()
    .eq("id", itemId);
  if (error) return { error: "No se pudo quitar: " + error.message };

  revalidatePath("/admin");
  revalidatePath("/estacion", "layout");
  return OK;
}

/**
 * Cobra la cuenta: cierra, libera la mesa y resuelve sus alertas.
 *
 * La venta queda pegada al turno de caja abierto. Sin turno no se cobra: una
 * venta sin caja abierta no cae en ningún arqueo y el cierre del día deja de
 * cerrar. El tablero del salón avisa antes de que alguien llegue hasta acá.
 */
export async function closeOrder(
  orderId: string,
  paymentMethod: PaymentMethod,
): Promise<ActionResult> {
  await requireStaff();

  if (!isPaymentMethod(paymentMethod)) {
    return { error: "Medio de pago desconocido." };
  }

  const supabase = await getSupabaseServerClient();

  const { error } = await supabase.rpc("close_table_order", {
    p_order_id: orderId,
    p_payment_method: paymentMethod,
  });

  if (error) {
    if (error.message.includes("turno de caja")) {
      return {
        error: "No hay un turno de caja abierto. Abrí la caja antes de cobrar.",
      };
    }
    return { error: "No se pudo cerrar la cuenta: " + error.message };
  }

  revalidatePath("/admin");
  revalidatePath("/estacion", "layout");
  return OK;
}

/**
 * Suelta una mesa sin cobrar: la abrieron por error.
 *
 * Es del encargado. Un mozo que se equivoca de mesa avisa; si pudiera soltarla
 * él, también podría sacarse de encima una mesa que no quiere atender.
 * La regla vive en el RPC, así que tampoco alcanza con saltear la pantalla.
 */
export async function releaseTable(tableId: string): Promise<ActionResult> {
  await requireAdmin();
  const supabase = await getSupabaseServerClient();

  const { error } = await supabase.rpc("release_table", {
    p_table_id: tableId,
  });

  if (error) {
    if (error.message.includes("consumos")) {
      return {
        error: "La mesa tiene consumos: hay que cobrarla, no liberarla.",
      };
    }
    if (error.message.includes("encargado")) {
      return { error: "Soltar una mesa sin cobrar es del encargado." };
    }
    return { error: "No se pudo liberar la mesa: " + error.message };
  }

  revalidatePath("/admin");
  revalidatePath("/admin/mis-mesas");
  return OK;
}

/**
 * El mozo toma una mesa libre.
 *
 * Desde que la toma, la mesa desaparece del salón de los demás mozos y le
 * aparece en «Mis mesas». La base no deja tomar una mesa para otro ni sacarle
 * la mesa a un compañero.
 */
export async function takeTable(tableId: string): Promise<ActionResult> {
  const profile = await requireStaff();
  const supabase = await getSupabaseServerClient();

  const { error } = await supabase
    .from("tables")
    .update({ assigned_waiter: profile.id })
    .eq("id", tableId);

  if (error) return { error: traducirMesa(error.message) };

  revalidatePath("/admin");
  revalidatePath("/admin/mis-mesas");
  return OK;
}

/**
 * Pasa la mesa a otro mozo. Es lo que hace quien termina el turno con mesas
 * abiertas: no las suelta, las entrega, y la cuenta sigue viva sin dueño
 * intermedio.
 */
export async function transferTable(
  tableId: string,
  toWaiterId: string,
): Promise<ActionResult> {
  await requireStaff();

  if (!toWaiterId) return { error: "Elegí a quién le pasás la mesa." };

  const supabase = await getSupabaseServerClient();

  const { error } = await supabase
    .from("tables")
    .update({ assigned_waiter: toWaiterId })
    .eq("id", tableId);

  if (error) return { error: traducirMesa(error.message) };

  revalidatePath("/admin");
  revalidatePath("/admin/mis-mesas");
  return OK;
}

/** Los mensajes del trigger ya están escritos para que los lea un mozo. */
function traducirMesa(mensaje: string): string {
  const conocidos = [
    "Soltar una mesa es del encargado",
    "Una mesa libre solo la podés tomar para vos",
    "La mesa está tomada por otro mozo",
    "La mesa solo se puede asignar a alguien del personal activo",
  ];

  const encontrado = conocidos.find((c) => mensaje.includes(c));
  if (encontrado) return mensaje.slice(mensaje.indexOf(encontrado));

  if (mensaje.includes("row-level security")) {
    return "No tenés permiso para hacer ese cambio.";
  }

  return "No se pudo cambiar la mesa: " + mensaje;
}

/**
 * El mozo levantó la línea de la barra y la puso en la mesa.
 *
 * Es el corte que hace que el aviso de pedido completo se apague: sin él, la
 * mesa queda pronta para siempre y el cartel deja de querer decir algo.
 */
export async function deliverItem(itemId: string): Promise<ActionResult> {
  await requireStaff();
  const supabase = await getSupabaseServerClient();

  const { error } = await supabase
    .from("order_items")
    .update({ status: "entregado" })
    .eq("id", itemId)
    .eq("status", "listo");

  if (error) return { error: "No se pudo marcar la entrega: " + error.message };

  revalidatePath("/admin");
  revalidatePath("/admin/mis-mesas");
  revalidatePath("/estacion", "layout");
  return OK;
}

/** Todo lo que estaba pronto en esa mesa se fue junto en una bandeja. */
export async function deliverTable(tableId: string): Promise<ActionResult> {
  await requireStaff();
  const supabase = await getSupabaseServerClient();

  const { data: order } = await supabase
    .from("orders")
    .select("id")
    .eq("table_id", tableId)
    .eq("status", "abierta")
    .maybeSingle<{ id: string }>();

  if (!order) return { error: "La mesa no tiene una cuenta abierta." };

  const { error } = await supabase
    .from("order_items")
    .update({ status: "entregado" })
    .eq("order_id", order.id)
    .eq("status", "listo");

  if (error) return { error: "No se pudo marcar la entrega: " + error.message };

  revalidatePath("/admin");
  revalidatePath("/admin/mis-mesas");
  revalidatePath("/estacion", "layout");
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

  if (error)
    return { error: "No se pudo resolver la alerta: " + error.message };

  revalidatePath("/admin");
  return OK;
}
