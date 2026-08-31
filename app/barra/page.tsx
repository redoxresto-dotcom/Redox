import { requireStaff } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { BarraBoard } from "./barra-board";
import {
  atiendeBarra,
  comboVigente,
  hoyMontevideo,
  homeFor,
  nombreMesa,
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

  // Una única "mesa" interna sostiene la venta de barra (la FK de orders). Si
  // hubiera más de una marcada, se usa la primera por número.
  const { data: mesa } = await supabase
    .from("tables")
    .select("*")
    .eq("is_bar", true)
    .order("number")
    .limit(1)
    .maybeSingle<BarTable>();

  const [ordersRes, productsRes, shiftRes] = await Promise.all([
    mesa
      ? supabase
          .from("orders")
          .select("*, order_items(*, product:products(id, name, category))")
          .eq("table_id", mesa.id)
          .eq("status", "abierta")
          .maybeSingle()
      : Promise.resolve({ data: null }),
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

  const found = (ordersRes.data ?? null) as OrderWithItems | null;
  let order: Order | null = null;
  let items: OrderItemWithProduct[] = [];
  if (found) {
    const { order_items, ...rest } = found;
    order = rest;
    items = [...order_items].sort((a, b) =>
      a.created_at.localeCompare(b.created_at),
    );
  }

  const hoy = hoyMontevideo();
  const products = ((productsRes.data ?? []) as Product[]).filter(
    (p) => !p.is_combo || comboVigente(p, hoy),
  );

  return (
    <BarraBoard
      mesa={
        mesa ? { id: mesa.id, label: nombreMesa(mesa.number, mesa.name) } : null
      }
      order={order}
      items={items}
      products={products}
      hasOpenShift={Boolean(shiftRes.data)}
      cajero={profile.full_name}
    />
  );
}
