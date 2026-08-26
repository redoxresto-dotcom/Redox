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

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

/**
 * Sube la foto del producto al bucket público y devuelve su URL.
 *
 * El nombre del archivo es un id random y no el del producto: así una foto
 * nueva no pisa a la vieja mientras se sube (el registro solo apunta a la URL
 * nueva una vez que el insert/update de `products` confirma), y no hay que
 * lidiar con nombres repetidos entre productos con el mismo nombre.
 */
async function uploadProductImage(
  supabase: Awaited<ReturnType<typeof getSupabaseServerClient>>,
  file: File,
): Promise<{ url: string; path: string } | { error: string }> {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    return { error: "La imagen debe ser JPG, PNG, WEBP o GIF." };
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return { error: "La imagen no puede pesar más de 5 MB." };
  }

  const ext = file.type.split("/")[1] === "jpeg" ? "jpg" : file.type.split("/")[1];
  const path = `${crypto.randomUUID()}.${ext}`;

  const { error } = await supabase.storage
    .from("product-images")
    .upload(path, file, { contentType: file.type });
  if (error) return { error: "No se pudo subir la imagen: " + error.message };

  const { data } = supabase.storage.from("product-images").getPublicUrl(path);
  return { url: data.publicUrl, path };
}

/** Borra una foto del bucket. No frena el flujo si falla: es solo prolijidad. */
async function deleteProductImage(
  supabase: Awaited<ReturnType<typeof getSupabaseServerClient>>,
  imageUrl: string,
): Promise<void> {
  const path = imageUrl.split("/product-images/")[1];
  if (!path) return;
  await supabase.storage.from("product-images").remove([decodeURIComponent(path)]);
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

  const image = formData.get("image");
  let image_url: string | null = null;
  if (image instanceof File && image.size > 0) {
    const uploaded = await uploadProductImage(supabase, image);
    if ("error" in uploaded) return { error: uploaded.error };
    image_url = uploaded.url;
  }

  const { data, error } = await supabase
    .from("products")
    .insert({ ...parsed.values, image_url })
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

  const { data: current } = await supabase
    .from("products")
    .select("image_url")
    .eq("id", id)
    .maybeSingle();
  const previousImageUrl = (current as { image_url: string | null } | null)
    ?.image_url ?? null;

  const image = formData.get("image");
  const removeImage = formData.get("remove_image") !== null;
  let values: typeof parsed.values & { image_url?: string | null } =
    parsed.values;

  if (image instanceof File && image.size > 0) {
    const uploaded = await uploadProductImage(supabase, image);
    if ("error" in uploaded) return { error: uploaded.error };
    values = { ...values, image_url: uploaded.url };
    if (previousImageUrl) await deleteProductImage(supabase, previousImageUrl);
  } else if (removeImage && previousImageUrl) {
    values = { ...values, image_url: null };
    await deleteProductImage(supabase, previousImageUrl);
  }

  const { error } = await supabase.from("products").update(values).eq("id", id);

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
