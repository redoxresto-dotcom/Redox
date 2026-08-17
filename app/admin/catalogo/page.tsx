import { requireAdmin } from "@/lib/auth";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { CatalogManager } from "./catalog-manager";
import type { Product } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function CatalogPage() {
  // Solo admin: un mozo que escriba la URL a mano termina en /admin.
  await requireAdmin();

  const supabase = await getSupabaseServerClient();
  const { data } = await supabase
    .from("products")
    .select("*")
    .order("active", { ascending: false })
    .order("category")
    .order("name");

  return <CatalogManager products={(data ?? []) as Product[]} />;
}
