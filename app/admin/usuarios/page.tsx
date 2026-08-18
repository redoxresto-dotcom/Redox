import { requireManager } from "@/lib/auth";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { UserManager } from "./user-manager";
import type { Profile } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function UsuariosPage() {
  // Solo gerente. La base vuelve a exigirlo en cada operación.
  const yo = await requireManager();

  const supabase = await getSupabaseServerClient();
  const { data } = await supabase
    .from("profiles")
    .select("*")
    .order("role", { ascending: false })
    .order("full_name");

  // El mail vive en auth.users, no en profiles, y solo se llega con la clave
  // service_role. Es la pantalla del gerente: puede ver con qué mail entra
  // cada uno de su personal.
  const admin = getSupabaseAdminClient();
  const { data: cuentas } = await admin.auth.admin.listUsers({
    page: 1,
    // De sobra para el personal de un bar. Si algún día hay más, hay que paginar.
    perPage: 200,
  });

  const emails: Record<string, string> = Object.fromEntries(
    (cuentas?.users ?? []).map((u) => [u.id, u.email ?? ""])
  );

  return (
    <UserManager profiles={(data ?? []) as Profile[]} me={yo} emails={emails} />
  );
}
