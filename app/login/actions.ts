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

  let supabase;
  try {
    supabase = await getSupabaseServerClient();
  } catch {
    return {
      error:
        "El servidor no tiene configuradas las claves de Supabase. Revisá las variables de entorno.",
    };
  }

  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // Credenciales equivocadas: se responde en genérico a propósito. Decir
    // "ese mail no existe" permitiría averiguar qué usuarios hay registrados.
    const isBadCredentials =
      error.code === "invalid_credentials" ||
      error.code === "email_not_confirmed" ||
      error.status === 400;

    if (isBadCredentials) {
      return { error: "Usuario o contraseña incorrectos." };
    }

    // Cualquier otra cosa (clave de API inválida, proyecto caído, red) no es
    // culpa de quien escribe la contraseña. Enmascararlo hace que un problema
    // de configuración se investigue durante horas como si fuera un typo.
    console.error("[login] fallo no atribuible a las credenciales", {
      status: error.status,
      code: error.code,
      message: error.message,
    });

    return {
      error: `No se pudo contactar al servidor de autenticación (${
        error.code ?? error.status ?? "sin código"
      }). No es tu contraseña: avisale a quien administra el sistema.`,
    };
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
