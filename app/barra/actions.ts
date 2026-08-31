"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/auth";
import {
  atiendeBarra,
  comboVigente,
  isPaymentMethod,
  type PaymentMethod,
} from "@/lib/types";

export type BarraResult = { error: string | null };

const OK: BarraResult = { error: null };

function revalidar() {
  revalidatePath("/barra");
  revalidatePath("/admin");
  revalidatePath("/estacion", "layout");
}

/** Igual que requireStaff, pero además el rol tiene que atender la barra. */
async function requireBarra() {
  const profile = await requireStaff();
  if (!atiendeBarra(profile.role)) {
    throw new Error("Esta pantalla es de la barra.");
  }
  return profile;
}

async function esMesaDeBarra(
  supabase: Awaited<ReturnType<typeof getSupabaseServerClient>>,
  tableId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("tables")
    .select("is_bar")
    .eq("id", tableId)
    .maybeSingle<{ is_bar: boolean }>();
  return Boolean(data?.is_bar);
}

/** Abre (o recupera) la cuenta de una mesa de barra. */
export async function openBarTab(tableId: string): Promise<BarraResult> {
  await requireBarra();
  const supabase = await getSupabaseServerClient();

  if (!(await esMesaDeBarra(supabase, tableId))) {
    return { error: "Esa mesa no es de la barra." };
  }

  const { error } = await supabase.rpc("open_table_order", {
    p_table_id: tableId,
  });
  if (error) return { error: "No se pudo abrir la mesa: " + error.message };

  revalidar();
  return OK;
}

/**
 * Carga una bebida a la mesa de barra. Solo productos de categoría bebida, y si
 * es un combo tiene que estar vigente. Si ya hay una línea de ese producto sin
 * tomar por la estación, suma una unidad ahí.
 */
export async function addDrink(
  tableId: string,
  productId: string,
): Promise<BarraResult> {
  const profile = await requireBarra();
  const supabase = await getSupabaseServerClient();

  if (!(await esMesaDeBarra(supabase, tableId))) {
    return { error: "Esa mesa no es de la barra." };
  }

  const { data: product, error: prodError } = await supabase
    .from("products")
    .select(
      "id, price, cost, category, is_combo, combo_valid_from, combo_valid_until",
    )
    .eq("id", productId)
    .eq("active", true)
    .single();

  if (prodError || !product) return { error: "Producto no encontrado." };
  if (product.category !== "bebida") {
    return { error: "La barra solo carga bebidas." };
  }
  if (product.is_combo && !comboVigente(product)) {
    return { error: "Ese combo está fuera de vigencia." };
  }

  const { data: orderId, error: rpcError } = await supabase.rpc(
    "open_table_order",
    { p_table_id: tableId },
  );
  if (rpcError || !orderId) {
    return { error: "No se pudo abrir la cuenta: " + (rpcError?.message ?? "") };
  }

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

  if (error) return { error: "No se pudo cargar la bebida: " + error.message };

  revalidar();
  return OK;
}

/** Suma o resta unidades de una línea. Al llegar a cero, la borra. */
export async function changeDrinkQty(
  itemId: string,
  delta: number,
): Promise<BarraResult> {
  const profile = await requireBarra();
  const supabase = await getSupabaseServerClient();

  const { data: item, error: readError } = await supabase
    .from("order_items")
    .select("id, quantity, status, order_id, product_id, unit_price, unit_cost")
    .eq("id", itemId)
    .single();

  if (readError || !item) return { error: "La línea ya no existe." };

  // Si la estación ya la tomó, la unidad nueva abre su propia línea.
  if (delta > 0 && item.status !== "pedido") {
    const { error } = await supabase.from("order_items").insert({
      order_id: item.order_id,
      product_id: item.product_id,
      quantity: delta,
      unit_price: item.unit_price,
      unit_cost: item.unit_cost,
      subtotal: 0,
      created_by: profile.id,
    });
    if (error) return { error: "No se pudo cargar la bebida: " + error.message };
    revalidar();
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

  revalidar();
  return OK;
}

/** Quita una línea completa de la cuenta. */
export async function removeDrinkLine(itemId: string): Promise<BarraResult> {
  await requireBarra();
  const supabase = await getSupabaseServerClient();

  const { error } = await supabase.from("order_items").delete().eq("id", itemId);
  if (error) return { error: "No se pudo quitar: " + error.message };

  revalidar();
  return OK;
}

/**
 * Cobra la cuenta de la barra: la cierra, libera la mesa y la pega al turno de
 * caja abierto. Sin turno abierto no cobra (igual que el salón).
 */
export async function chargeTab(
  orderId: string,
  paymentMethod: PaymentMethod,
): Promise<BarraResult> {
  await requireBarra();

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

  revalidar();
  return OK;
}
