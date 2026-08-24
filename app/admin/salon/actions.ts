"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import type { TableShape } from "@/lib/types";

export type SalonResult = { error: string | null };

const OK: SalonResult = { error: null };

/** Lo que el editor manda por cada mesa movida. */
export type LayoutInput = {
  id: string;
  sector_id: string | null;
  pos_x: number;
  pos_y: number;
  shape: TableShape;
  width: number;
  height: number;
  rotation: number;
  seats: number;
  name: string | null;
};

/**
 * Guarda el plano completo de una vez.
 *
 * Va por RPC y no por un update suelto por mesa: mover cinco mesas y que se
 * guarden tres es peor que no guardar nada. El RPC además exige admin, que es
 * el candado que la policy de `tables` no puede poner sin romperle el trabajo
 * al mozo.
 */
export async function saveLayout(tables: LayoutInput[]): Promise<SalonResult> {
  await requireAdmin();

  if (tables.length === 0) return OK;

  const supabase = await getSupabaseServerClient();
  const { error } = await supabase.rpc("save_table_layout", {
    p_layout: tables,
  });

  if (error) return { error: "No se pudo guardar el plano: " + error.message };

  revalidatePath("/admin/salon");
  revalidatePath("/admin");
  return OK;
}

export async function createTable(
  number: number,
  sectorId: string | null,
  posX: number,
  posY: number
): Promise<SalonResult> {
  await requireAdmin();

  if (!Number.isInteger(number) || number <= 0) {
    return { error: "El número de mesa no es válido." };
  }

  const supabase = await getSupabaseServerClient();
  const { error } = await supabase.rpc("create_bar_table", {
    p_number: number,
    p_sector: sectorId,
    p_pos_x: Math.round(posX),
    p_pos_y: Math.round(posY),
  });

  if (error) {
    return {
      error: error.message.includes("Ya hay una mesa")
        ? `Ya hay una mesa con el número ${number}.`
        : "No se pudo agregar la mesa: " + error.message,
    };
  }

  revalidatePath("/admin/salon");
  revalidatePath("/admin");
  return OK;
}

export async function deleteTable(id: string): Promise<SalonResult> {
  await requireAdmin();

  const supabase = await getSupabaseServerClient();
  const { error } = await supabase.rpc("delete_bar_table", { p_id: id });

  if (error) {
    return {
      error: error.message.includes("histórico")
        ? "La mesa ya facturó alguna vez: borrarla se llevaría puesto el histórico de ventas."
        : "No se pudo quitar la mesa: " + error.message,
    };
  }

  revalidatePath("/admin/salon");
  revalidatePath("/admin");
  return OK;
}

export async function createSector(formData: FormData): Promise<SalonResult> {
  await requireAdmin();

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "El sector necesita un nombre." };

  const supabase = await getSupabaseServerClient();

  const { count } = await supabase
    .from("sectors")
    .select("id", { count: "exact", head: true });

  const { error } = await supabase
    .from("sectors")
    .insert({ name, sort_order: count ?? 0 });

  if (error) {
    return {
      error: error.message.includes("sectors_name_unique")
        ? "Ya hay un sector con ese nombre."
        : "No se pudo crear el sector: " + error.message,
    };
  }

  revalidatePath("/admin/salon");
  revalidatePath("/admin");
  return OK;
}

export async function renameSector(
  id: string,
  name: string
): Promise<SalonResult> {
  await requireAdmin();

  const limpio = name.trim();
  if (!limpio) return { error: "El sector necesita un nombre." };

  const supabase = await getSupabaseServerClient();
  const { error } = await supabase
    .from("sectors")
    .update({ name: limpio })
    .eq("id", id);

  if (error) {
    return {
      error: error.message.includes("sectors_name_unique")
        ? "Ya hay un sector con ese nombre."
        : "No se pudo renombrar: " + error.message,
    };
  }

  revalidatePath("/admin/salon");
  revalidatePath("/admin");
  return OK;
}

/**
 * Borra un sector vacío.
 *
 * Con mesas adentro no se borra: la clave foránea las dejaría sin sector y
 * desaparecerían del plano sin que nadie entienda a dónde fueron.
 */
export async function deleteSector(id: string): Promise<SalonResult> {
  await requireAdmin();

  const supabase = await getSupabaseServerClient();

  const { count } = await supabase
    .from("tables")
    .select("id", { count: "exact", head: true })
    .eq("sector_id", id);

  if (count && count > 0) {
    return {
      error: `El sector tiene ${count} mesa${count === 1 ? "" : "s"}: movelas a otro sector antes de borrarlo.`,
    };
  }

  const { error } = await supabase.from("sectors").delete().eq("id", id);
  if (error) return { error: "No se pudo borrar el sector: " + error.message };

  revalidatePath("/admin/salon");
  revalidatePath("/admin");
  return OK;
}
