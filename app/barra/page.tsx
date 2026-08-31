import { requireStaff } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { BarraBoard, type BarTab } from "./barra-board";
import {
  atiendeBarra,
  comboVigente,
  hoyMontevideo,
  homeFor,
  type BarTable,
  type Order,
  type OrderItemWithProduct,
  type Product,
} from "@/lib/types";

export const dynamic = "force-dynamic";

type OrderWithItems = Order & { order_items: OrderItemWithProduct[] };

export default async function BarraPage() {
  const profile = await requireStaff();
  if (!atiendeBarra(profile.role)) redirect(homeFor(profile.role));

  const supabase = await getSupabaseServerClient();

  const [tablesRes, ordersRes, productsRes, shiftRes] = await Promise.all([
    supabase.from("tables").select("*").eq("is_bar", true).order("number"),
    supabase
      .from("orders")
      .select("*, order_items(*, product:products(id, name, category))")
      .eq("status", "abierta"),
    supabase
      .from("products")
      .select("*")
      .eq("active", true)
      .eq("category", "bebida")
      .order("name"),
    supabase
      .from("cash_shifts")
      .select("id")
      .is("closed_at", null)
      .maybeSingle(),
  ]);

  const tables = (tablesRes.data ?? []) as BarTable[];
  const orders = (ordersRes.data ?? []) as OrderWithItems[];
  const ordersByTable = new Map(orders.map((o) => [o.table_id, o]));

  const tabs: BarTab[] = tables.map((table) => {
    const found = ordersByTable.get(table.id);
    if (!found) return { table, order: null, items: [] };
    const { order_items, ...order } = found;
    return {
      table,
      order,
      items: [...order_items].sort((a, b) =>
        a.created_at.localeCompare(b.created_at),
      ),
    };
  });

  const hoy = hoyMontevideo();
  const products = ((productsRes.data ?? []) as Product[]).filter(
    (p) => !p.is_combo || comboVigente(p, hoy),
  );

  return (
    <BarraBoard
      tabs={tabs}
      products={products}
      hasOpenShift={Boolean(shiftRes.data)}
      cajero={profile.full_name}
    />
  );
}
