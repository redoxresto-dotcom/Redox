"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export type LoginState = { error: string | null };

/** Solo se permite volver a rutas internas: evita redirects a sitios externos. */
function safeRedirect(target: FormDataEntryValue | null): string {
  const value = typeof target === "string" ? target : "";
  return value.startsWith("/") && !value.startsWith("//") ? value : "/admin";
}

export async function signIn(
  _prev: LoginState,
  formData: FormData
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Completá usuario y contraseña." };
  }

  const supabase = await getSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // No distinguimos "usuario inexistente" de "clave incorrecta":
    // decirlo permitiría averiguar qué mails están registrados.
    return { error: "Usuario o contraseña incorrectos." };
  }

  const destination = safeRedirect(formData.get("redirect"));
  revalidatePath("/", "layout");
  redirect(destination);
}

export async function signOut() {
  const supabase = await getSupabaseServerClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}
