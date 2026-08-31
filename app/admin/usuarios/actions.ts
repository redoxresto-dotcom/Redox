"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireManager } from "@/lib/auth";
import {
  loginEmailFromDocumento,
  ROLE_RANK,
  STAFF_ROLES,
  type StaffRole,
} from "@/lib/types";

const DOC_RE = /^\d{6,8}$/;

export type UserResult = { error: string | null };

const OK: UserResult = { error: null };

function esRol(valor: string): valor is StaffRole {
  return (STAFF_ROLES as readonly string[]).includes(valor);
}

/**
 * Alta de personal.
 *
 * Crear el usuario de Auth exige la clave service_role, que bypassea RLS y los
 * triggers: acá la jerarquía la tiene que verificar este código, porque la base
 * no ve a nadie del otro lado. El resto de las operaciones va con la sesión del
 * gerente justamente para que las verifique Postgres.
 */
export async function createStaff(formData: FormData): Promise<UserResult> {
  const yo = await requireManager();

  const document = String(formData.get("document") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const fullName = String(formData.get("full_name") ?? "").trim();
  const role = String(formData.get("role") ?? "mozo") as StaffRole;

  if (!DOC_RE.test(document)) {
    return { error: "El documento tiene que ser de 6 a 8 dígitos, sin puntos." };
  }
  if (password.length < 8) {
    return { error: "La contraseña tiene que tener al menos 8 caracteres." };
  }
  if (!fullName) return { error: "Falta el nombre." };
  if (!esRol(role)) return { error: "Rol desconocido." };

  if (ROLE_RANK[role] >= ROLE_RANK[yo.role]) {
    return { error: "No podés crear un usuario de tu mismo nivel o superior." };
  }

  const admin = getSupabaseAdminClient();

  const { error } = await admin.auth.admin.createUser({
    // Supabase Auth necesita un email: se arma uno sintético a partir del
    // documento. El usuario entra escribiendo solo el número.
    email: loginEmailFromDocumento(document),
    password,
    // Sin esto Supabase manda un mail de confirmación y el mozo no puede entrar
    // hasta que lo abra. El alta la hace el gerente en el local.
    email_confirm: true,
    user_metadata: { full_name: fullName, role, document },
  });

  if (error) {
    return {
      error: error.message.toLowerCase().includes("already")
        ? "Ya hay un usuario con ese documento."
        : "No se pudo crear el usuario: " + error.message,
    };
  }

  revalidatePath("/admin/usuarios");
  return OK;
}

/**
 * Cambio de rol.
 *
 * Va con la sesión del gerente: la policy y el trigger de la base deciden si
 * puede. Si mañana alguien llama a esta acción desde otro lado, la regla sigue
 * siendo la misma porque no vive acá.
 */
export async function changeRole(
  userId: string,
  role: StaffRole
): Promise<UserResult> {
  await requireManager();

  if (!esRol(role)) return { error: "Rol desconocido." };

  const supabase = await getSupabaseServerClient();
  const { error } = await supabase
    .from("profiles")
    .update({ role })
    .eq("id", userId);

  if (error) return { error: traducir(error.message) };

  revalidatePath("/admin/usuarios");
  revalidatePath("/admin");
  return OK;
}

/** Alta y baja lógica: revoca los permisos sin borrar el historial de ventas. */
export async function setActive(
  userId: string,
  active: boolean
): Promise<UserResult> {
  await requireManager();

  const supabase = await getSupabaseServerClient();
  const { error } = await supabase
    .from("profiles")
    .update({ active })
    .eq("id", userId);

  if (error) return { error: traducir(error.message) };

  revalidatePath("/admin/usuarios");
  revalidatePath("/admin");
  return OK;
}

/**
 * Baja definitiva: borra el usuario de Auth y su perfil se va con él.
 *
 * Igual que el alta, necesita service_role, así que la jerarquía se verifica
 * acá. Casi siempre conviene desactivar en lugar de borrar: las cuentas viejas
 * quedan sin dueño.
 */
export async function deleteStaff(userId: string): Promise<UserResult> {
  const yo = await requireManager();

  if (userId === yo.id) return { error: "No podés borrar tu propio usuario." };

  const supabase = await getSupabaseServerClient();
  const { data: objetivo } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle<{ role: StaffRole }>();

  if (!objetivo) return { error: "El usuario ya no existe." };

  if (ROLE_RANK[objetivo.role] >= ROLE_RANK[yo.role]) {
    return { error: "Solo se puede borrar a alguien de nivel inferior al tuyo." };
  }

  if (objetivo.role === "gerente") {
    const { count } = await supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("role", "gerente")
      .eq("active", true);

    if ((count ?? 0) <= 1) {
      return { error: "Tiene que quedar al menos un gerente activo." };
    }
  }

  const admin = getSupabaseAdminClient();
  const { error } = await admin.auth.admin.deleteUser(userId);

  if (error) return { error: "No se pudo borrar el usuario: " + error.message };

  revalidatePath("/admin/usuarios");
  revalidatePath("/admin");
  return OK;
}

/**
 * Restablece la contraseña de alguien de nivel inferior.
 *
 * No hay forma de "recuperar" la anterior: Supabase guarda un hash bcrypt, que
 * es de una sola dirección. Nadie puede leerla, ni con la clave service_role.
 * Lo único que se puede hacer es poner una nueva, y esa se la pasa el gerente
 * al mozo en el local, igual que en el alta.
 */
export async function resetPassword(
  userId: string,
  formData: FormData
): Promise<UserResult> {
  const yo = await requireManager();

  const password = String(formData.get("password") ?? "");
  if (password.length < 8) {
    return { error: "La contraseña tiene que tener al menos 8 caracteres." };
  }

  const supabase = await getSupabaseServerClient();
  const { data: objetivo } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle<{ role: StaffRole }>();

  if (!objetivo) return { error: "El usuario ya no existe." };

  // Igual que el alta y la baja: cambiar una contraseña necesita service_role,
  // que bypassea RLS, así que la jerarquía se verifica acá.
  if (ROLE_RANK[objetivo.role] >= ROLE_RANK[yo.role]) {
    return {
      error: "Solo se puede cambiar la contraseña de alguien de nivel inferior al tuyo.",
    };
  }

  const admin = getSupabaseAdminClient();
  const { error } = await admin.auth.admin.updateUserById(userId, { password });

  if (error) {
    return { error: "No se pudo cambiar la contraseña: " + error.message };
  }

  revalidatePath("/admin/usuarios");
  return OK;
}

/**
 * Carga (o cambia) el documento con el que un usuario inicia sesión.
 *
 * Sirve para pasar a las cuentas viejas —creadas con un correo real— al login
 * por documento: se les arma el email sintético y se guarda el número. Igual
 * que el alta, toca Auth con service_role, así que la jerarquía se verifica
 * acá.
 */
export async function setDocument(
  userId: string,
  formData: FormData
): Promise<UserResult> {
  const yo = await requireManager();

  const document = String(formData.get("document") ?? "").trim();
  if (!DOC_RE.test(document)) {
    return { error: "El documento tiene que ser de 6 a 8 dígitos, sin puntos." };
  }

  const supabase = await getSupabaseServerClient();
  const { data: objetivo } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle<{ role: StaffRole }>();

  if (!objetivo) return { error: "El usuario ya no existe." };
  if (ROLE_RANK[objetivo.role] >= ROLE_RANK[yo.role]) {
    return {
      error: "Solo se puede cambiar el documento de alguien de nivel inferior al tuyo.",
    };
  }

  const admin = getSupabaseAdminClient();

  const { data: cuenta, error: readError } =
    await admin.auth.admin.getUserById(userId);
  if (readError || !cuenta.user) {
    return { error: "No se pudo leer la cuenta: " + (readError?.message ?? "") };
  }

  const { error: authError } = await admin.auth.admin.updateUserById(userId, {
    email: loginEmailFromDocumento(document),
    // Auto-confirmado: el email es sintético y no puede recibir un mail de
    // verificación. Sin esto, con "Secure email change" activo el cambio queda
    // pendiente y el usuario no podría entrar con el documento.
    email_confirm: true,
    user_metadata: { ...cuenta.user.user_metadata, document },
  });

  if (authError) {
    return {
      error: authError.message.toLowerCase().includes("already")
        ? "Ya hay un usuario con ese documento."
        : "No se pudo cambiar el documento: " + authError.message,
    };
  }

  const { error: profileError } = await supabase
    .from("profiles")
    .update({ document })
    .eq("id", userId);

  if (profileError) return { error: traducir(profileError.message) };

  revalidatePath("/admin/usuarios");
  return OK;
}

/** Los mensajes que levanta el trigger llegan crudos; se muestran tal cual. */
function traducir(mensaje: string): string {
  const conocidos = [
    "No podés cambiarte el rol a vos mismo",
    "Solo se puede cambiar el rol de alguien de nivel inferior",
    "Solo se puede activar o desactivar a alguien de nivel inferior",
    "Tiene que quedar al menos un gerente activo",
    "No podés crear un usuario de tu mismo nivel o superior",
  ];

  const encontrado = conocidos.find((c) => mensaje.includes(c));
  if (encontrado) return mensaje.slice(mensaje.indexOf(encontrado));

  // Sin policy que lo permita, Postgres no explica nada: no dice "no podés",
  // dice que la fila viola la seguridad. Se traduce para que no parezca un bug.
  if (mensaje.includes("row-level security")) {
    return "No tenés permiso para hacer ese cambio.";
  }

  return mensaje;
}
