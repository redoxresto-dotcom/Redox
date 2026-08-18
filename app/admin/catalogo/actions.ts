"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import type { ProductCategory, Station } from "@/lib/types";

export type CatalogResult = { error: string | null };

const CATEGORIES: ProductCategory[] = ["bebida", "comida", "otro"];
const STATIONS: Station[] = ["barra", "cocina", "ninguna"];

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
      };
    }
  | { ok: false; error: string } {
  const name = String(formData.get("name") ?? "").trim();
  const price = Number(formData.get("price"));
  const cost = Number(formData.get("cost") ?? 0);
  const category = String(formData.get("category") ?? "bebida") as ProductCategory;
  const station = String(formData.get("station") ?? "barra") as Station;

  if (!name) return { ok: false, error: "El nombre no puede estar vacío." };
  if (!Number.isFinite(price) || price < 0)
    return { ok: false, error: "El precio de venta no es válido." };
  if (!Number.isFinite(cost) || cost < 0)
    return { ok: false, error: "El costo no es válido." };
  if (!CATEGORIES.includes(category))
    return { ok: false, error: "Categoría desconocida." };
  if (!STATIONS.includes(station))
    return { ok: false, error: "Estación desconocida." };

  return { ok: true, values: { name, price, cost, category, station } };
}

function friendlyError(message: string): string {
  // 23505 = violación de índice único (products_name_unique).
  if (message.includes("products_name_unique") || message.includes("duplicate key")) {
    return "Ya existe un producto con ese nombre.";
  }
  return message;
}

export async function createProduct(formData: FormData): Promise<CatalogResult> {
  await requireAdmin();
  const parsed = parseForm(formData);
  if (!parsed.ok) return { error: parsed.error };

  const supabase = await getSupabaseServerClient();
  const { error } = await supabase.from("products").insert(parsed.values);

  if (error) return { error: friendlyError(error.message) };

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
