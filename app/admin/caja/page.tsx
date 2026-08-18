import { requireStaff } from "@/lib/auth";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { CajaClient, type ShiftSummary } from "./caja-client";
import type { CashShift, Order, PaymentMethod, Profile } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Ventas del turno abierto, abiertas por medio de pago. */
async function resumenDelTurno(
  supabase: Awaited<ReturnType<typeof getSupabaseServerClient>>,
  shiftId: string
): Promise<ShiftSummary> {
  const { data } = await supabase
    .from("orders")
    .select("total, payment_method")
    .eq("shift_id", shiftId)
    .eq("status", "cobrada");

  const orders = (data ?? []) as Pick<Order, "total" | "payment_method">[];

  const porMedio: Partial<Record<PaymentMethod, number>> = {};
  for (const order of orders) {
    if (!order.payment_method) continue;
    porMedio[order.payment_method] =
      (porMedio[order.payment_method] ?? 0) + Number(order.total);
  }

  return {
    tickets: orders.length,
    total: orders.reduce((sum, o) => sum + Number(o.total), 0),
    porMedio,
  };
}

export default async function CajaPage() {
  const profile = await requireStaff();
  const supabase = await getSupabaseServerClient();

  const [abiertoRes, historialRes, perfilesRes] = await Promise.all([
    supabase.from("cash_shifts").select("*").is("closed_at", null).maybeSingle(),
    supabase
      .from("cash_shifts")
      .select("*")
      .not("closed_at", "is", null)
      .order("closed_at", { ascending: false })
      .limit(15),
    supabase.from("profiles").select("id, full_name"),
  ]);

  const abierto = abiertoRes.data as CashShift | null;

  const resumen = abierto
    ? await resumenDelTurno(supabase, abierto.id)
    : { tickets: 0, total: 0, porMedio: {} };

  const nombres: Record<string, string> = Object.fromEntries(
    ((perfilesRes.data ?? []) as Pick<Profile, "id" | "full_name">[]).map((p) => [
      p.id,
      p.full_name,
    ])
  );

  return (
    <CajaClient
      shift={abierto}
      summary={resumen}
      history={(historialRes.data ?? []) as CashShift[]}
      names={nombres}
      isAdmin={profile.role === "admin"}
    />
  );
}
