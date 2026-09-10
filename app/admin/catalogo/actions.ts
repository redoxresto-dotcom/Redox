"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { normalizarClave, parseCsv, parseNumeroLatam } from "@/lib/csv";
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
        combo_valid_from: string | null;
        combo_valid_until: string | null;
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

  // Vigencia: solo tiene sentido en combos. Fuera de un combo se guarda null
  // para no arrastrar fechas de cuando el producto sí lo era.
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const rawFrom = String(formData.get("combo_valid_from") ?? "").trim();
  const rawUntil = String(formData.get("combo_valid_until") ?? "").trim();
  const combo_valid_from = is_combo && DATE_RE.test(rawFrom) ? rawFrom : null;
  const combo_valid_until = is_combo && DATE_RE.test(rawUntil) ? rawUntil : null;

  if (
    combo_valid_from &&
    combo_valid_until &&
    combo_valid_from > combo_valid_until
  ) {
    return {
      ok: false,
      error: "La fecha de inicio de la promoción es posterior a la de fin.",
    };
  }

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
      combo_valid_from,
      combo_valid_until,
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

// ---------------------------------------------------------------------------
//  Importación masiva desde CSV
// ---------------------------------------------------------------------------

export type ImportResult = {
  error: string | null;
  creados: number;
  actualizados: number;
  omitidos: number;
  /** Errores de validación: si hay alguno, no se insertó nada. */
  errores: { fila: number; error: string }[];
};

/** Sinónimos que se aceptan en la columna `categoria`. */
const CATEGORIA_SINONIMOS: Record<string, ProductCategory> = {
  bebida: "bebida",
  bebidas: "bebida",
  trago: "bebida",
  tragos: "bebida",
  coctel: "bebida",
  cocteles: "bebida",
  comida: "comida",
  comidas: "comida",
  plato: "comida",
  platos: "comida",
  otro: "otro",
  otros: "otro",
  varios: "otro",
};

/** Sinónimos que se aceptan en la columna `estacion`. */
const ESTACION_SINONIMOS: Record<string, Station> = {
  barra: "barra",
  bar: "barra",
  cocina: "cocina",
  ninguna: "ninguna",
  ninguno: "ninguna",
  nada: "ninguna",
  no: "ninguna",
  "sin comanda": "ninguna",
  "sin estacion": "ninguna",
};

function parseBooleano(raw: string, porDefecto: boolean): boolean {
  const v = normalizarClave(raw);
  if (v === "") return porDefecto;
  if (["si", "s", "1", "true", "verdadero", "x"].includes(v)) return true;
  if (["no", "n", "0", "false", "falso"].includes(v)) return false;
  return porDefecto;
}

type FilaProducto = {
  name: string;
  price: number;
  cost: number;
  category: ProductCategory;
  station: Station;
  description: string | null;
  in_menu: boolean;
  is_combo: boolean;
};

/**
 * Alta de productos desde un CSV (Guardar como CSV UTF-8 desde Excel).
 *
 * Columnas: nombre*, precio*, categoria*, costo, estacion, descripcion,
 * en_carta. Si alguna fila tiene un error, no se inserta nada: se devuelve la
 * lista con el número de fila para corregir y volver a subir.
 */
export async function importProducts(formData: FormData): Promise<ImportResult> {
  await requireAdmin();

  const vacio: ImportResult = {
    error: null,
    creados: 0,
    actualizados: 0,
    omitidos: 0,
    errores: [],
  };

  const file = formData.get("file");
  const actualizar = formData.get("actualizar") != null;

  if (!(file instanceof File) || file.size === 0) {
    return { ...vacio, error: "Subí un archivo CSV." };
  }
  if (file.size > 2 * 1024 * 1024) {
    return { ...vacio, error: "El archivo es muy grande (máximo 2 MB)." };
  }

  const csv = parseCsv(await file.text());
  for (const obligatoria of ["nombre", "precio", "categoria"]) {
    if (!csv.headers.includes(obligatoria)) {
      return {
        ...vacio,
        error:
          "El archivo no tiene las columnas obligatorias: nombre, precio y categoria. Descargá la plantilla.",
      };
    }
  }
  if (csv.rows.length === 0) {
    return { ...vacio, error: "El archivo no tiene filas de productos." };
  }
  if (csv.rows.length > 1000) {
    return { ...vacio, error: "Máximo 1000 filas por archivo." };
  }

  const idx = (col: string) => csv.headers.indexOf(col);
  const get = (fila: string[], col: string) =>
    idx(col) === -1 ? "" : (fila[idx(col)] ?? "").trim();

  const errores: { fila: number; error: string }[] = [];
  const filas: FilaProducto[] = [];
  const vistos = new Set<string>();

  csv.rows.forEach((fila, i) => {
    const nroFila = i + 2; // +1 encabezado, +1 base-1
    const name = get(fila, "nombre");
    if (!name) {
      errores.push({ fila: nroFila, error: "Falta el nombre." });
      return;
    }
    if (name.length > 120) {
      errores.push({ fila: nroFila, error: "El nombre es demasiado largo." });
      return;
    }
    const clave = name.toLowerCase();
    if (vistos.has(clave)) {
      errores.push({ fila: nroFila, error: `"${name}" está repetido en el archivo.` });
      return;
    }
    vistos.add(clave);

    const precio = parseNumeroLatam(get(fila, "precio"));
    if (precio === null) {
      errores.push({ fila: nroFila, error: "Falta el precio." });
      return;
    }
    if (Number.isNaN(precio) || precio < 0) {
      errores.push({ fila: nroFila, error: "El precio no es un número válido." });
      return;
    }

    const costoRaw = parseNumeroLatam(get(fila, "costo"));
    const cost = costoRaw === null ? 0 : costoRaw;
    if (Number.isNaN(cost) || cost < 0) {
      errores.push({ fila: nroFila, error: "El costo no es un número válido." });
      return;
    }

    const category = CATEGORIA_SINONIMOS[normalizarClave(get(fila, "categoria"))];
    if (!category) {
      errores.push({
        fila: nroFila,
        error: "Categoría desconocida (usá bebida, comida u otro).",
      });
      return;
    }

    let station: Station = "barra";
    const estacionRaw = normalizarClave(get(fila, "estacion"));
    if (estacionRaw) {
      const s = ESTACION_SINONIMOS[estacionRaw];
      if (!s) {
        errores.push({
          fila: nroFila,
          error: "Estación desconocida (usá barra, cocina o ninguna).",
        });
        return;
      }
      station = s;
    }

    const descripcion = get(fila, "descripcion");

    filas.push({
      name,
      price: precio,
      cost,
      category,
      station,
      description: descripcion || null,
      in_menu: parseBooleano(get(fila, "en_carta"), true),
      is_combo: false,
    });
  });

  if (errores.length > 0) {
    return { ...vacio, errores };
  }

  const supabase = await getSupabaseServerClient();

  const { data: existentesData, error: readError } = await supabase
    .from("products")
    .select("id, name");
  if (readError) {
    return { ...vacio, error: "No se pudo leer el catálogo: " + readError.message };
  }
  const porNombre = new Map(
    (existentesData ?? []).map((p) => [p.name.toLowerCase(), p.id as string]),
  );

  const nuevos = filas.filter((f) => !porNombre.has(f.name.toLowerCase()));
  const yaEstan = filas.filter((f) => porNombre.has(f.name.toLowerCase()));

  let creados = 0;
  if (nuevos.length > 0) {
    const { error } = await supabase.from("products").insert(nuevos);
    if (error) {
      return { ...vacio, error: friendlyError(error.message) };
    }
    creados = nuevos.length;
  }

  let actualizados = 0;
  if (actualizar) {
    for (const f of yaEstan) {
      const id = porNombre.get(f.name.toLowerCase())!;
      const { error } = await supabase
        .from("products")
        .update({
          price: f.price,
          cost: f.cost,
          category: f.category,
          station: f.station,
          description: f.description,
          in_menu: f.in_menu,
        })
        .eq("id", id);
      if (error) {
        return { ...vacio, creados, actualizados, error: friendlyError(error.message) };
      }
      actualizados++;
    }
  }

  revalidatePath("/admin/catalogo");
  revalidatePath("/admin");
  revalidatePath("/estacion", "layout");

  return {
    error: null,
    creados,
    actualizados,
    omitidos: actualizar ? 0 : yaEstan.length,
    errores: [],
  };
}
