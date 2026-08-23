"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import type { ProductCategory, Station } from "@/lib/types";

export type CatalogResult = { error: string | null };

const CATEGORIES: ProductCategory[] = ["bebida", "comida", "otro"];
const STATIONS: Station[] = ["barra", "cocina", "ninguna"];

/** Un componente de combo tal como lo arma el formulario, antes de validar. */
type RawComboItem = { product_id?: unknown; quantity?: unknown };

/** Valida y normaliza lo que llega del formulario. */
function parseForm(formData: FormData):
  | {
      ok: true;
      values: {
        name: string;
        price: number;
        cost: number;
        category: ProductCategory;
        station: Station;
        description: string | null;
        in_menu: boolean;
        is_combo: boolean;
      };
      comboItems: { product_id: string; quantity: number }[];
    }
  | { ok: false; error: string } {
  const name = String(formData.get("name") ?? "").trim();
  const price = Number(formData.get("price"));
  const cost = Number(formData.get("cost") ?? 0);
  const category = String(formData.get("category") ?? "bebida") as ProductCategory;
  const station = String(formData.get("station") ?? "barra") as Station;
  const description = String(formData.get("description") ?? "").trim();
  // Checkbox sin marcar no viaja en el formulario.
  const in_menu = formData.get("in_menu") !== null;
  const is_combo = formData.get("is_combo") !== null;

  if (!name) return { ok: false, error: "El nombre no puede estar vacío." };
  if (!Number.isFinite(price) || price < 0)
    return { ok: false, error: "El precio de venta no es válido." };
  if (!Number.isFinite(cost) || cost < 0)
    return { ok: false, error: "El costo no es válido." };
  if (!CATEGORIES.includes(category))
    return { ok: false, error: "Categoría desconocida." };
  if (!STATIONS.includes(station))
    return { ok: false, error: "Estación desconocida." };

  // Va serializado en un solo campo: son pares producto/cantidad armados por
  // el picker, no algo que tenga sentido cargar como inputs sueltos.
  let comboItems: { product_id: string; quantity: number }[] = [];
  if (is_combo) {
    const raw = String(formData.get("combo_items") ?? "[]");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ok: false, error: "La lista de productos del combo no es válida." };
    }
    if (!Array.isArray(parsed))
      return { ok: false, error: "La lista de productos del combo no es válida." };

    comboItems = (parsed as RawComboItem[])
      .filter(
        (item): item is { product_id: string; quantity: unknown } =>
          typeof item.product_id === "string" && item.product_id.length > 0,
      )
      .map((item) => ({
        product_id: item.product_id,
        quantity: Math.max(1, Math.round(Number(item.quantity) || 1)),
      }));

    if (comboItems.length === 0)
      return {
        ok: false,
        error: "Un combo necesita al menos un producto adentro.",
      };
  }

  return {
    ok: true,
    values: {
      name,
      price,
      cost,
      category,
      station,
      description: description || null,
      in_menu,
      is_combo,
    },
    comboItems,
  };
}

function friendlyError(message: string): string {
  // 23505 = violación de índice único (products_name_unique).
  if (message.includes("products_name_unique") || message.includes("duplicate key")) {
    return "Ya existe un producto con ese nombre.";
  }
  return message;
}

/**
 * Guarda la lista de componentes de un combo. Va aparte del insert/update del
 * producto porque son dos tablas distintas; si esto falla después de crear el
 * producto, el combo queda creado pero vacío en vez de a medio armar.
 */
async function saveComboItems(
  supabase: Awaited<ReturnType<typeof getSupabaseServerClient>>,
  productId: string,
  isCombo: boolean,
  items: { product_id: string; quantity: number }[],
): Promise<string | null> {
  if (isCombo) {
    const { error } = await supabase.rpc("set_combo_items", {
      p_combo_id: productId,
      p_items: items,
    });
    if (error) return "No se pudo guardar el combo: " + error.message;
    return null;
  }

  // Dejó de ser combo (o nunca lo fue): sin esto, un producto que se
  // deja de marcar como combo conserva componentes fantasma en la base.
  const { error } = await supabase
    .from("combo_items")
    .delete()
    .eq("combo_id", productId);
  if (error) return "No se pudo limpiar el combo anterior: " + error.message;
  return null;
}

export async function createProduct(formData: FormData): Promise<CatalogResult> {
  await requireAdmin();
  const parsed = parseForm(formData);
  if (!parsed.ok) return { error: parsed.error };

  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase
    .from("products")
    .insert(parsed.values)
    .select("id")
    .single();

  if (error) return { error: friendlyError(error.message) };

  if (parsed.values.is_combo) {
    const comboError = await saveComboItems(
      supabase,
      data.id,
      true,
      parsed.comboItems,
    );
    if (comboError) return { error: comboError };
  }

  revalidatePath("/admin/catalogo");
  revalidatePath("/admin");
  revalidatePath("/estacion", "layout");
  return { error: null };
}

export async function updateProduct(
  id: string,
  formData: FormData
): Promise<CatalogResult> {
  await requireAdmin();
  const parsed = parseForm(formData);
  if (!parsed.ok) return { error: parsed.error };

  const supabase = await getSupabaseServerClient();
  const { error } = await supabase
    .from("products")
    .update(parsed.values)
    .eq("id", id);

  if (error) return { error: friendlyError(error.message) };

  const comboError = await saveComboItems(
    supabase,
    id,
    parsed.values.is_combo,
    parsed.comboItems,
  );
  if (comboError) return { error: comboError };

  revalidatePath("/admin/catalogo");
  revalidatePath("/admin");
  return { error: null };
}

/**
 * Baja de un producto.
 *
 * Se intenta el borrado real; si el producto ya se vendió alguna vez, la clave
 * foránea lo impide (borrarlo destruiría el histórico de ventas). En ese caso
 * se desactiva: desaparece del POS pero las cuentas viejas siguen intactas.
 */
export async function deleteProduct(id: string): Promise<CatalogResult> {
  await requireAdmin();
  const supabase = await getSupabaseServerClient();

  const { error } = await supabase.from("products").delete().eq("id", id);

  if (error) {
    const { error: deactivateError } = await supabase
      .from("products")
      .update({ active: false })
      .eq("id", id);

    if (deactivateError) return { error: deactivateError.message };
  }

  revalidatePath("/admin/catalogo");
  revalidatePath("/admin");
  return { error: null };
}

/** Vuelve a poner en venta un producto desactivado. */
export async function reactivateProduct(id: string): Promise<CatalogResult> {
  await requireAdmin();
  const supabase = await getSupabaseServerClient();

  const { error } = await supabase
    .from("products")
    .update({ active: true })
    .eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/admin/catalogo");
  revalidatePath("/admin");
  return { error: null };
}
