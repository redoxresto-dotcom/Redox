"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { requireAdmin, requireStaff } from "@/lib/auth";

export type CajaResult = { error: string | null };

/**
 * Abre el turno de caja declarando el fondo de cambio.
 *
 * Lo puede hacer cualquiera del personal: si abrir la caja dependiera del
 * encargado, un sábado sin él en el local nadie podría cobrar una mesa.
 */
export async function openShift(formData: FormData): Promise<CajaResult> {
  await requireStaff();

  const fondo = Number(formData.get("opening_float") ?? 0);
  if (!Number.isFinite(fondo) || fondo < 0) {
    return { error: "El fondo de cambio no es válido." };
  }

  const supabase = await getSupabaseServerClient();
  const { error } = await supabase.rpc("open_cash_shift", { p_float: fondo });

  if (error) {
    return {
      error: error.message.includes("Ya hay un turno")
        ? "Ya hay un turno de caja abierto."
        : "No se pudo abrir la caja: " + error.message,
    };
  }

  revalidatePath("/admin/caja");
  revalidatePath("/admin");
  return { error: null };
}

/**
 * Cierra el turno contra lo contado en la caja.
 *
 * El arqueo es responsabilidad del encargado, así que exige admin — y también
 * lo exige el RPC, para que no alcance con saltearse la pantalla.
 */
export async function closeShift(
  shiftId: string,
  formData: FormData
): Promise<CajaResult> {
  await requireAdmin();

  const contado = Number(formData.get("counted_cash"));
  if (!Number.isFinite(contado) || contado < 0) {
    return { error: "El efectivo contado no es válido." };
  }

  const notas = String(formData.get("notes") ?? "").trim();

  const supabase = await getSupabaseServerClient();
  const { error } = await supabase.rpc("close_cash_shift", {
    p_shift_id: shiftId,
    p_counted: contado,
    p_notes: notas || null,
  });

  if (error) {
    return {
      error: error.message.includes("encargado")
        ? "Solo un encargado puede cerrar la caja."
        : "No se pudo cerrar la caja: " + error.message,
    };
  }

  revalidatePath("/admin/caja");
  revalidatePath("/admin");
  return { error: null };
}
