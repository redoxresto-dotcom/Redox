import { requireManager } from "@/lib/auth";
import { getSupabaseServerClient } from "@/lib/supabase/server";
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

  return (
    <UserManager profiles={(data ?? []) as Profile[]} me={yo} />
  );
}
