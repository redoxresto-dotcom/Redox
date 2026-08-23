import { requireAdmin } from "@/lib/auth";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { CatalogManager } from "./catalog-manager";
import type { ComboComponent, Product } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function CatalogPage() {
  // Solo admin: un mozo que escriba la URL a mano termina en /admin.
  await requireAdmin();

  const supabase = await getSupabaseServerClient();
  const [productsRes, comboItemsRes] = await Promise.all([
    supabase
      .from("products")
      .select("*")
      .order("active", { ascending: false })
      .order("category")
      .order("name"),
    supabase.from("combo_items").select("combo_id, component_id, quantity"),
  ]);

  const comboItems = (
    (comboItemsRes.data ?? []) as {
      combo_id: string;
      component_id: string;
      quantity: number;
    }[]
  ).reduce<Record<string, ComboComponent[]>>((acc, row) => {
    (acc[row.combo_id] ??= []).push({
      product_id: row.component_id,
      quantity: row.quantity,
    });
    return acc;
  }, {});

  return (
    <CatalogManager
      products={(productsRes.data ?? []) as Product[]}
      comboItems={comboItems}
    />
  );
}
