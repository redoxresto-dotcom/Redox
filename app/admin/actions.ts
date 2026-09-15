"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { isPaymentMethod, type PaymentMethod } from "@/lib/types";

export type ActionResult = { error: string | null };

const OK: ActionResult = { error: null };

/**
 * Todas las acciones del salón corren con la sesión del mozo, así que la RLS
 * sigue vigente: la UI puede equivocarse, la base no deja pasar nada indebido.
 *
 * A propósito, ninguna arranca con requireStaff()/requireAdmin(): ese chequeo
 * hace dos viajes de red (auth.getUser() + select a profiles) antes de tocar
 * un dato, y acá la barrera real ya es otra — la RLS de cada tabla, o el
 * propio RPC que valida con auth.uid()/is_admin() adentro de la base (ver
 * migraciones 020, 032 y 033). Repetir la validación del lado de la app solo
 * sumaba latencia sin sumar seguridad.
 */

/** Abre (o recupera) la cuenta de una mesa y la marca como ocupada. */
export async function openTable(tableId: string): Promise<ActionResult> {
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
  const supabase = await getSupabaseServerClient();

  // Un solo viaje a la base: abrir la cuenta, traer el producto, buscar la
  // línea existente e insertar o sumar, todo adentro del RPC. Antes eran 4
  // llamadas en serie desde acá, cada una pagando la ida y vuelta completa.
  const { error } = await supabase.rpc("add_product_to_table", {
    p_table_id: tableId,
    p_product_id: productId,
  });

  if (error)
    return { error: "No se pudo cargar el producto: " + error.message };

  revalidatePath("/admin");
  revalidatePath("/estacion", "layout");
  return OK;
}

/**
 * Suma o resta unidades. Al llegar a cero, borra la línea.
 *
 * Un solo viaje a la base: antes eran hasta cuatro (leer la línea, más el
 * insert/update/delete correspondiente), sobre el botón que más se toca de
 * toda la pantalla.
 */
export async function changeItemQuantity(
  itemId: string,
  delta: number,
): Promise<ActionResult> {
  const supabase = await getSupabaseServerClient();

  const { error } = await supabase.rpc("change_order_item_quantity", {
    p_item_id: itemId,
    p_delta: delta,
  });

  if (error) return { error: "No se pudo actualizar: " + error.message };

  revalidatePath("/admin");
  revalidatePath("/estacion", "layout");
  return OK;
}

/** Quita una línea completa de la cuenta. */
export async function removeItem(itemId: string): Promise<ActionResult> {
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
 * Cancela el pedido: hubo consumo cargado, pero no se cobra.
 *
 * Es el caso del medio entre cobrar y soltar una mesa vacía: el cliente pidió
 * y por lo que sea —se fue, se arrepintió, no llegó a consumir en el local—
 * no corresponde cobrarle. A diferencia de `releaseTable`, acá puede haber
 * productos ya cargados (incluso en camino a la cocina): no se borran, la
 * cuenta queda marcada como cancelada para el reporte de pedidos cancelados.
 *
 * Lo puede hacer cualquiera del personal, no solo el encargado: es el mozo
 * quien está con el cliente cuando se arrepiente o se va, y no siempre hay un
 * encargado a mano para pedírselo. Queda registrado quién canceló y el motivo,
 * así que el reporte de cancelados sigue siendo trazable.
 */
export async function cancelOrder(
  orderId: string,
  reason?: string,
): Promise<ActionResult> {
  const supabase = await getSupabaseServerClient();

  const { error } = await supabase.rpc("cancel_table_order", {
    p_order_id: orderId,
    p_reason: reason?.trim() || null,
  });

  if (error) {
    return { error: "No se pudo cancelar el pedido: " + error.message };
  }

  revalidatePath("/admin");
  revalidatePath("/admin/mis-mesas");
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
  const supabase = await getSupabaseServerClient();

  const { error } = await supabase.rpc("take_table", { p_table_id: tableId });

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
