import "server-only";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import {
  atiendeMesas,
  comboVigente,
  hoyMontevideo,
  type Alert,
  type AlertType,
  type BarTable,
  type Order,
  type OrderItemWithProduct,
  type Product,
  type Profile,
  type Sector,
  type TableDetail,
} from "@/lib/types";

type OrderWithItems = Order & { order_items: OrderItemWithProduct[] };

export type SalonData = {
  tables: TableDetail[];
  products: Product[];
  /** id de perfil → nombre, para mostrar quién atiende cada mesa. */
  waiters: Record<string, string>;
  /** A quién se le puede pasar una mesa: personal activo que atiende mesas. */
  staff: { id: string; full_name: string }[];
  pendingAlerts: Record<string, AlertType[]>;
  hasOpenShift: boolean;
  sectors: Sector[];
  /** Mesas que además son mesas de pool: se marcan en el tablero del salón. */
  poolTableIds: string[];
};

/**
 * Todo lo que necesita el tablero del salón, en una sola pasada.
 *
 * Lo consumen el salón y «Mis mesas»: las dos pantallas muestran lo mismo con
 * distinto recorte, y separar la carga evita que se desincronicen.
 */
export async function loadSalon(): Promise<SalonData> {
  const supabase = await getSupabaseServerClient();

  const [
    tablesRes,
    ordersRes,
    productsRes,
    profilesRes,
    alertsRes,
    shiftRes,
    sectorsRes,
    poolRes,
  ] = await Promise.all([
    supabase.from("tables").select("*").eq("active", true).order("number"),
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
    supabase.from("profiles").select("id, full_name, role, active"),
    supabase.from("alerts").select("*").eq("status", "pendiente"),
    supabase
      .from("cash_shifts")
      .select("id")
      .is("closed_at", null)
      .maybeSingle(),
    supabase.from("sectors").select("*").order("sort_order").order("name"),
    // Para marcar en el tablero cuáles son mesas de pool (ver poolTableIds).
    supabase.from("pool_tables").select("table_id"),
  ]);

  const esDePool = new Set(
    ((poolRes.data ?? []) as { table_id: string }[]).map((p) => p.table_id),
  );

  // Barra y las mesas internas del sistema no van en el tablero del salón. Las
  // de pool sí: el tiempo se vende desde /admin/pool, pero un cliente sentado
  // ahí puede pedir de comer o tomar igual que en cualquier mesa, y el mozo
  // necesita encontrarla en el salón para cargarle el consumo.
  const tables = ((tablesRes.data ?? []) as BarTable[]).filter(
    (t) => !t.is_bar && !t.is_system,
  );
  const orders = (ordersRes.data ?? []) as OrderWithItems[];
  const alerts = (alertsRes.data ?? []) as Alert[];
  const perfiles = (profilesRes.data ?? []) as Pick<
    Profile,
    "id" | "full_name" | "role" | "active"
  >[];

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
        a.created_at.localeCompare(b.created_at),
      ),
    };
  });

  // Un combo fuera de su ventana de vigencia no se ofrece en la mesa. La
  // tarifa de pool tampoco: ahora que el mozo tiene su propia sección Pool
  // para vender tiempo, dejarla en este catálogo solo invita a cargarla por
  // error como si fuera un producto suelto, fuera de una partida real.
  const hoy = hoyMontevideo();
  const products = ((productsRes.data ?? []) as Product[]).filter(
    (p) => !p.is_pool_rate && (!p.is_combo || comboVigente(p, hoy)),
  );

  return {
    tables: details,
    products,
    waiters: Object.fromEntries(perfiles.map((p) => [p.id, p.full_name])),
    // La barra y la cocina no atienden mesas: pasarles una dejaría la cuenta a
    // nombre de alguien que no va a ir a buscarla.
    staff: perfiles
      .filter((p) => p.active && atiendeMesas(p.role))
      .map((p) => ({ id: p.id, full_name: p.full_name })),
    pendingAlerts: alerts.reduce<Record<string, AlertType[]>>((acc, alert) => {
      (acc[alert.table_id] ??= []).push(alert.type);
      return acc;
    }, {}),
    hasOpenShift: Boolean(shiftRes.data),
    sectors: (sectorsRes.data ?? []) as Sector[],
    poolTableIds: [...esDePool],
  };
}
