import "server-only";

import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { hasRank, type Profile } from "@/lib/types";

/**
 * Devuelve el perfil del mozo logueado o corta el render mandando a /login.
 * Toda página y Server Action bajo /admin arranca por acá.
 */
export async function requireStaff(): Promise<Profile> {
  const supabase = await getSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle<Profile>();

  // Usuario de Auth sin perfil, o dado de baja: no opera el salón.
  if (!profile || !profile.active) {
    redirect("/login?error=sin-acceso");
  }

  return profile;
}

/**
 * Igual que requireStaff pero exige nivel admin o superior.
 *
 * Se compara por rango y no por igualdad: el gerente está por encima del admin
 * y tiene que pasar por todas las puertas que pasa un admin.
 */
export async function requireAdmin(): Promise<Profile> {
  const profile = await requireStaff();
  if (!hasRank(profile.role, "admin")) redirect("/admin?error=solo-admin");
  return profile;
}

/** Exige nivel gerente: la administración de usuarios. */
export async function requireManager(): Promise<Profile> {
  const profile = await requireStaff();
  if (!hasRank(profile.role, "gerente")) redirect("/admin?error=solo-gerente");
  return profile;
}

/** Perfil actual, o null si no hay sesión. No redirige. */
export async function getCurrentProfile(): Promise<Profile | null> {
  const supabase = await getSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle<Profile>();

  return data ?? null;
}
