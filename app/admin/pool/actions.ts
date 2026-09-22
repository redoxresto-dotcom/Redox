"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { requireAdmin, requireStaff } from "@/lib/auth";

export type PoolResult = { error: string | null };

const OK: PoolResult = { error: null };

/** Los mensajes de los RPC ya están escritos para que los lea el personal. */
function traducir(mensaje: string, porDefecto: string): string {
  const conocidos = [
    "Esa mesa no es una mesa de pool",
    "La mesa de pool está fuera de servicio",
    "No se pueden vender más de",
    "No hay ningún producto marcado como tarifa de pool",
    "Los minutos tienen que ser un número positivo",
    "La partida no existe o ya está terminada",
    "Solo el personal",
    // Reservas
    "Sólo el personal",
    "Falta el nombre del cliente",
    "Falta la hora del turno",
    "Las horas de juego tienen que ser",
    "No se pueden reservar más de",
    "Ya hay una reserva para esa mesa a esa hora",
    "La reserva no existe",
    "Esa reserva ya no está pendiente",
    "La mesa ya tiene una partida en curso",
    "Sólo se puede liberar una reserva pendiente",
  ];

  const encontrado = conocidos.find((c) => mensaje.includes(c));
  if (encontrado) return mensaje.slice(mensaje.indexOf(encontrado));

  if (mensaje.includes("row-level security")) {
    return "No tenés permiso para hacer ese cambio.";
  }

  return `${porDefecto}: ${mensaje}`;
}

/**
 * Vende un bloque de tiempo.
 *
 * Todo el peso está en el RPC: abre la cuenta de la mesa, carga la línea, crea
 * o estira la partida y registra la compra, en una sola operación. Acá solo se
 * traduce lo que sale mal.
 */
export async function sellPoolTime(
  tableId: string,
  minutes: number,
): Promise<PoolResult> {
  await requireStaff();

  if (!Number.isInteger(minutes) || minutes <= 0) {
    return { error: "Los minutos tienen que ser un número entero positivo." };
  }

  const supabase = await getSupabaseServerClient();
  const { error } = await supabase.rpc("pool_sell_time", {
    p_table_id: tableId,
    p_minutes: minutes,
  });

  if (error)
    return { error: traducir(error.message, "No se pudo vender el tiempo") };

  revalidatePath("/admin/pool");
  revalidatePath("/admin");
  return OK;
}

/**
 * Anota quiénes están jugando.
 *
 * Van en la partida: si compran más tiempo siguen siendo los mismos, y cuando
 * entra otro grupo la partida nueva arranca en blanco sin que nadie borre nada.
 */
export async function setPoolPlayers(
  sessionId: string,
  one: string,
  two: string,
): Promise<PoolResult> {
  await requireStaff();

  const supabase = await getSupabaseServerClient();
  const { error } = await supabase
    .from("pool_sessions")
    .update({ player_one: one, player_two: two })
    .eq("id", sessionId)
    .eq("status", "activa");

  if (error) return { error: traducir(error.message, "No se pudo guardar") };

  revalidatePath("/admin/pool");
  revalidatePath("/pool");
  return OK;
}

/** Corta una partida antes de tiempo: el grupo se fue. */
export async function endPoolSession(sessionId: string): Promise<PoolResult> {
  await requireStaff();

  const supabase = await getSupabaseServerClient();
  const { error } = await supabase.rpc("pool_end_session", {
    p_session_id: sessionId,
    p_source: "panel",
  });

  if (error)
    return { error: traducir(error.message, "No se pudo terminar la partida") };

  revalidatePath("/admin/pool");
  revalidatePath("/admin");
  return OK;
}

/**
 * Cierra las partidas cuyo plazo ya venció.
 *
 * La llaman las pantallas al cargar. Como solo toca lo que ya venció, llamarla
 * de más no hace nada: es la forma de que el reloj avance aunque los aparatos
 * estén desconectados.
 */
export async function expireDuePoolSessions(): Promise<PoolResult> {
  await requireStaff();

  const supabase = await getSupabaseServerClient();
  const { error } = await supabase.rpc("pool_expire_due");

  if (error) return { error: error.message };

  revalidatePath("/admin/pool");
  return OK;
}

// ---------------------------------------------------------------------------
//  Reservas: de administración
//
//  Una reserva es un turno para una mesa de pool. No enciende nada: cuando el
//  cliente llega, se activa a mano y recién ahí arranca una partida.
// ---------------------------------------------------------------------------

/** Registra un turno para una mesa de pool. */
export async function createPoolReservation(datos: {
  tableId: string;
  customerName: string;
  /** Documento, celular, mail… lo que el cliente prefiera dejar. Opcional. */
  contact: string;
  scheduledAt: string;
  minutes: number;
}): Promise<PoolResult> {
  await requireStaff();

  if (!Number.isInteger(datos.minutes) || datos.minutes <= 0) {
    return { error: "Las horas de juego tienen que ser un número positivo." };
  }

  // El input datetime-local manda "YYYY-MM-DDTHH:mm" sin zona. Se interpreta en
  // hora de Montevideo con offset fijo (Uruguay no cambia de hora desde 2015),
  // igual que los reportes: si no, el servidor en UTC lo correría tres horas.
  const crudo = datos.scheduledAt.trim();
  const match = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(crudo);
  const cuando = match
    ? new Date(`${crudo.length === 16 ? `${crudo}:00` : crudo}-03:00`)
    : new Date(NaN);
  if (Number.isNaN(cuando.getTime())) {
    return { error: "La hora del turno no es válida." };
  }

  const supabase = await getSupabaseServerClient();
  const { error } = await supabase.rpc("pool_reserve", {
    p_table_id: datos.tableId,
    p_customer: datos.customerName,
    p_contact: datos.contact.trim() || null,
    p_scheduled_at: cuando.toISOString(),
    p_minutes: datos.minutes,
  });

  if (error)
    return { error: traducir(error.message, "No se pudo crear la reserva") };

  revalidatePath("/admin/pool");
  revalidatePath("/admin/pool/reservas");
  revalidatePath("/pool");
  return OK;
}

/**
 * Enciende la mesa a partir de una reserva: llega el cliente y alguien la
 * activa. Arranca una partida con los minutos de la reserva, salvo que se pasen
 * otros (por si compran otra cosa al llegar).
 */
export async function activatePoolReservation(
  reservationId: string,
  minutes?: number,
): Promise<PoolResult> {
  await requireStaff();

  if (
    minutes !== undefined &&
    (!Number.isInteger(minutes) || minutes <= 0)
  ) {
    return { error: "Los minutos tienen que ser un número entero positivo." };
  }

  const supabase = await getSupabaseServerClient();
  const { error } = await supabase.rpc("pool_reservation_activate", {
    p_id: reservationId,
    p_minutes: minutes ?? null,
  });

  if (error)
    return { error: traducir(error.message, "No se pudo activar la reserva") };

  revalidatePath("/admin/pool");
  revalidatePath("/admin/pool/reservas");
  revalidatePath("/admin");
  revalidatePath("/pool");
  return OK;
}

/**
 * Saca un turno de la cola. `noShow` distingue "no vino ni avisó" de "avisó
 * que no viene", que se registran distinto para poder medirlos.
 */
export async function releasePoolReservation(
  reservationId: string,
  noShow = false,
): Promise<PoolResult> {
  await requireStaff();

  const supabase = await getSupabaseServerClient();
  const { error } = await supabase.rpc("pool_reservation_release", {
    p_id: reservationId,
    p_no_show: noShow,
  });

  if (error)
    return { error: traducir(error.message, "No se pudo liberar la reserva") };

  revalidatePath("/admin/pool");
  revalidatePath("/admin/pool/reservas");
  revalidatePath("/pool");
  return OK;
}

// ---------------------------------------------------------------------------
//  Configuración: del encargado
// ---------------------------------------------------------------------------

/** Convierte una mesa del salón en mesa de pool. */
export async function addPoolTable(
  tableId: string,
  deviceId: string,
): Promise<PoolResult> {
  await requireAdmin();

  const device = deviceId.trim();
  if (!device) return { error: "Falta el identificador del aparato." };

  const supabase = await getSupabaseServerClient();
  const { error } = await supabase
    .from("pool_tables")
    .insert({ table_id: tableId, device_id: device });

  if (error) {
    if (error.message.includes("pool_tables_device_id_key")) {
      return { error: `Ya hay otra mesa con el aparato «${device}».` };
    }
    if (error.message.includes("duplicate key")) {
      return { error: "Esa mesa ya está configurada como mesa de pool." };
    }
    return { error: traducir(error.message, "No se pudo agregar la mesa") };
  }

  revalidatePath("/admin/pool");
  revalidatePath("/admin");
  return OK;
}

export async function updatePoolTable(
  tableId: string,
  cambios: {
    device_id?: string;
    warning_minutes?: number;
    max_block_minutes?: number;
    felt_threshold_hours?: number;
    active?: boolean;
  },
): Promise<PoolResult> {
  await requireAdmin();

  const supabase = await getSupabaseServerClient();
  const { error } = await supabase
    .from("pool_tables")
    .update(cambios)
    .eq("table_id", tableId);

  if (error) return { error: traducir(error.message, "No se pudo guardar") };

  revalidatePath("/admin/pool");
  return OK;
}

/**
 * Deja de ser mesa de pool.
 *
 * La mesa sigue existiendo en el salón: lo que se borra es su aparato y su
 * configuración, no su historia ni sus cuentas.
 */
export async function removePoolTable(tableId: string): Promise<PoolResult> {
  await requireAdmin();

  const supabase = await getSupabaseServerClient();

  const { data: activa } = await supabase
    .from("pool_sessions")
    .select("id")
    .eq("table_id", tableId)
    .eq("status", "activa")
    .maybeSingle();

  if (activa) {
    return { error: "La mesa tiene una partida en curso: terminala primero." };
  }

  const { error } = await supabase
    .from("pool_tables")
    .delete()
    .eq("table_id", tableId);

  if (error) return { error: traducir(error.message, "No se pudo quitar") };

  revalidatePath("/admin/pool");
  revalidatePath("/admin");
  return OK;
}

/**
 * Registra un mantenimiento y reinicia el contador de horas.
 *
 * Se guardan las horas que tenía la mesa en ese momento: recalcularlas después
 * obligaría a conservar para siempre cada partida.
 */
export async function logPoolMaintenance(
  tableId: string,
  kind: string,
  hoursAtChange: number,
  notes: string,
): Promise<PoolResult> {
  const yo = await requireAdmin();

  const supabase = await getSupabaseServerClient();
  const { error } = await supabase.from("pool_maintenance").insert({
    table_id: tableId,
    kind,
    hours_at_change: hoursAtChange,
    notes: notes.trim() || null,
    done_by: yo.id,
  });

  if (error) return { error: traducir(error.message, "No se pudo registrar") };

  revalidatePath("/admin/pool");
  return OK;
}
