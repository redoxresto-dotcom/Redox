import { requireStaff } from "@/lib/auth";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { SalonBoard } from "./_components/salon-board";
import type {
  Alert,
  AlertType,
  BarTable,
  Order,
  OrderItemWithProduct,
  Product,
  Profile,
  Sector,
  TableDetail,
} from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Motivos por los que alguien puede terminar acá rebotado desde otra pantalla.
 * Sin esto el rebote es mudo: la URL dice el motivo y nadie lo lee.
 */
const ERRORS: Record<string, string> = {
  "solo-admin": "Esa pantalla es de administradores.",
  "solo-gerente":
    "La administración de usuarios es del gerente. Pedísela a quien tenga ese nivel.",
};

type OrderWithItems = Order & { order_items: OrderItemWithProduct[] };

export default async function SalonPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const profile = await requireStaff();
  const { error } = await searchParams;
  const supabase = await getSupabaseServerClient();

  const [
    tablesRes,
    ordersRes,
    productsRes,
    waitersRes,
    alertsRes,
    shiftRes,
    sectorsRes,
  ] =
    await Promise.all([
      supabase.from("tables").select("*").order("number"),
      supabase
        .from("orders")
        .select("*, order_items(*, product:products(id, name, category))")
        .eq("status", "abierta"),
      supabase
        .from("products")
        .select("*")
        .eq("active", true)
        .order("category")
        .order("name"),
      supabase.from("profiles").select("id, full_name"),
      supabase.from("alerts").select("*").eq("status", "pendiente"),
      supabase
        .from("cash_shifts")
        .select("id")
        .is("closed_at", null)
        .maybeSingle(),
      supabase.from("sectors").select("*").order("sort_order").order("name"),
    ]);

  const tables = (tablesRes.data ?? []) as BarTable[];
  const orders = (ordersRes.data ?? []) as OrderWithItems[];
  const products = (productsRes.data ?? []) as Product[];
  const alerts = (alertsRes.data ?? []) as Alert[];

  const ordersByTable = new Map(orders.map((o) => [o.table_id, o]));

  const details: TableDetail[] = tables.map((table) => {
    const found = ordersByTable.get(table.id);
    if (!found) return { table, order: null, items: [] };

    const { order_items, ...order } = found;
    return {
      table,
      order,
      // Orden estable: como se fue cargando, no como lo devuelve Postgres.
      items: [...order_items].sort((a, b) =>
        a.created_at.localeCompare(b.created_at)
      ),
    };
  });

  const waiters: Record<string, string> = Object.fromEntries(
    ((waitersRes.data ?? []) as Pick<Profile, "id" | "full_name">[]).map((p) => [
      p.id,
      p.full_name,
    ])
  );

  const pendingAlerts = alerts.reduce<Record<string, AlertType[]>>(
    (acc, alert) => {
      (acc[alert.table_id] ??= []).push(alert.type);
      return acc;
    },
    {}
  );

  return (
    <SalonBoard
      tables={details}
      products={products}
      waiters={waiters}
      currentUserId={profile.id}
      pendingAlerts={pendingAlerts}
      hasOpenShift={Boolean(shiftRes.data)}
      role={profile.role}
      notice={error ? (ERRORS[error] ?? null) : null}
      sectors={(sectorsRes.data ?? []) as Sector[]}
    />
  );
}
