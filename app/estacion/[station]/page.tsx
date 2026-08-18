import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { requireStaff } from "@/lib/auth";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { StationBoard, type StationTicket } from "./station-board";
import {
  isPrepStation,
  READY_WINDOW_MINUTES,
  STATION_LABELS,
  type ItemStatus,
} from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/** Fila cruda que devuelve PostgREST con la mesa y el producto ya resueltos. */
type StationRow = {
  id: string;
  quantity: number;
  status: ItemStatus;
  created_at: string;
  started_at: string | null;
  ready_at: string | null;
  product: { name: string } | null;
  order: {
    id: string;
    table: { id: string; number: number } | null;
  } | null;
};

export default async function StationPage({
  params,
}: {
  params: Promise<{ station: string }>;
}) {
  const { station } = await params;
  if (!isPrepStation(station)) notFound();

  await requireStaff();
  const supabase = await getSupabaseServerClient();

  // Lo pendiente, más lo que se marcó listo hace poco: esa ventana es la que
  // permite deshacer un toque de más sin ir a buscar a la caja.
  const since = new Date(
    Date.now() - READY_WINDOW_MINUTES * 60_000
  ).toISOString();

  const { data } = await supabase
    .from("order_items")
    .select(
      "id, quantity, status, created_at, started_at, ready_at, product:products(name), order:orders!inner(id, status, table:tables(id, number))"
    )
    .eq("station", station)
    .eq("order.status", "abierta")
    .or(`status.neq.listo,ready_at.gte.${since}`)
    .order("created_at");

  const rows = (data ?? []) as unknown as StationRow[];

  // Agrupado por mesa: la comanda es de la mesa, no de la línea suelta.
  const byTable = new Map<string, StationTicket>();

  for (const row of rows) {
    const table = row.order?.table;
    if (!table) continue;

    let ticket = byTable.get(table.id);
    if (!ticket) {
      ticket = {
        tableId: table.id,
        tableNumber: table.number,
        items: [],
      };
      byTable.set(table.id, ticket);
    }

    ticket.items.push({
      id: row.id,
      name: row.product?.name ?? "Producto eliminado",
      quantity: row.quantity,
      status: row.status,
      created_at: row.created_at,
      started_at: row.started_at,
      ready_at: row.ready_at,
    });
  }

  // La mesa que espera hace más rato, primero. Las que ya están todas listas
  // caen al final: siguen visibles solo por si hay que deshacer algo.
  const tickets = [...byTable.values()].sort((a, b) => {
    const wa = oldestPending(a);
    const wb = oldestPending(b);
    if (wa === wb) return a.tableNumber - b.tableNumber;
    return wa.localeCompare(wb);
  });

  return (
    <StationBoard
      station={station}
      label={STATION_LABELS[station]}
      tickets={tickets}
    />
  );
}

/** created_at de la línea pendiente más vieja, o "~" para mandar al final. */
function oldestPending(ticket: StationTicket): string {
  const pending = ticket.items.filter((i) => i.status !== "listo");
  if (pending.length === 0) return "~";
  return pending.reduce(
    (min, i) => (i.created_at < min ? i.created_at : min),
    pending[0].created_at
  );
}
