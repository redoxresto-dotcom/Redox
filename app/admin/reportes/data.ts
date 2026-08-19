import "server-only";

import type { getSupabaseServerClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof getSupabaseServerClient>>;

/**
 * Uruguay no cambia de hora desde 2015, así que el offset fijo alcanza y
 * evita depender de la zona horaria del servidor, que en producción es UTC.
 */
const OFFSET = "-03:00";

export type Range = { desde: string; hasta: string; from: string; to: string };

export type SummaryRow = {
  tickets: number;
  total: number;
  ticket_avg: number;
  items_units: number;
};
export type PaymentRow = {
  payment_method: string;
  tickets: number;
  total: number;
};
export type ProductRow = {
  product_id: string;
  name: string;
  category: string;
  station: string;
  units: number;
  total: number;
};
export type HourRow = { hour: number; tickets: number; total: number };
export type DeliveryRow = {
  station: string;
  entregas: number;
  promedio_min: number;
  peor_min: number;
};
export type WeekdayRow = { weekday: number; tickets: number; total: number };
export type DayRow = {
  day: string;
  tickets: number;
  total: number;
  efectivo: number;
  debito: number;
  credito: number;
  transferencia: number;
  otro: number;
};

function isDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Rango del reporte a partir de la query. Por defecto, los últimos 30 días.
 *
 * `hasta` es inclusivo para quien lo lee, así que el corte se hace en el
 * arranque del día siguiente: si no, el último día del período queda afuera.
 */
export function parseRange(params: Record<string, string | undefined>): Range {
  const hoy = new Date();
  const hace30 = new Date(hoy.getTime() - 29 * 86_400_000);

  const desde = isDate(params.desde) ? params.desde : toISODate(hace30);
  const hasta = isDate(params.hasta) ? params.hasta : toISODate(hoy);

  // Un rango dado vuelta no devuelve nada y parece un bug de la base.
  const [ini, fin] = desde <= hasta ? [desde, hasta] : [hasta, desde];

  const siguiente = new Date(`${fin}T00:00:00${OFFSET}`);
  siguiente.setUTCDate(siguiente.getUTCDate() + 1);

  return {
    desde: ini,
    hasta: fin,
    from: new Date(`${ini}T00:00:00${OFFSET}`).toISOString(),
    to: siguiente.toISOString(),
  };
}

async function rpc<T>(
  supabase: Supabase,
  fn: string,
  range: Range,
): Promise<T[]> {
  const { data, error } = await supabase.rpc(fn, {
    p_from: range.from,
    p_to: range.to,
  });

  if (error) {
    console.error(`[reportes] ${fn}`, error.message);
    return [];
  }

  return (data ?? []) as T[];
}

export async function getSummary(
  supabase: Supabase,
  range: Range,
): Promise<SummaryRow> {
  const rows = await rpc<SummaryRow>(supabase, "report_summary", range);
  return rows[0] ?? { tickets: 0, total: 0, ticket_avg: 0, items_units: 0 };
}

export const getByPayment = (s: Supabase, r: Range) =>
  rpc<PaymentRow>(s, "report_by_payment", r);
export const getByProduct = (s: Supabase, r: Range) =>
  rpc<ProductRow>(s, "report_by_product", r);
export const getByHour = (s: Supabase, r: Range) =>
  rpc<HourRow>(s, "report_by_hour", r);
export const getByWeekday = (s: Supabase, r: Range) =>
  rpc<WeekdayRow>(s, "report_by_weekday", r);
export const getByDay = (s: Supabase, r: Range) =>
  rpc<DayRow>(s, "report_by_day", r);

/** Minutos entre que un plato queda pronto y que llega a la mesa. */
export const getDeliveryTimes = (s: Supabase, r: Range) =>
  rpc<DeliveryRow>(s, "report_delivery_times", r);

export const WEEKDAY_LABELS: Record<number, string> = {
  1: "Lunes",
  2: "Martes",
  3: "Miércoles",
  4: "Jueves",
  5: "Viernes",
  6: "Sábado",
  7: "Domingo",
};
