import { NextResponse, type NextRequest } from "next/server";
import { getCurrentProfile } from "@/lib/auth";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import {
  getByDay,
  getByHour,
  getByPayment,
  getByProduct,
  getByWaiter,
  parseRange,
  WEEKDAY_LABELS,
  getByWeekday,
} from "../data";
import { hasRank, PAYMENT_LABELS, isPaymentMethod } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Exportación para el contador.
 *
 * Sale como CSV separado por punto y coma y con coma decimal, que es lo que
 * Excel en español abre de un doble clic sin pasar por el asistente de
 * importación. El BOM del arranque es lo que le dice a Excel que es UTF-8;
 * sin él, los acentos llegan rotos.
 */

const SEP = ";";

function celda(value: string | number): string {
  if (typeof value === "number") {
    // Coma decimal, sin separador de miles: Excel es-UY lo toma como número.
    return value.toFixed(2).replace(".", ",");
  }
  const limpio = value.replace(/"/g, '""');
  return /[;\n"]/.test(limpio) ? `"${limpio}"` : limpio;
}

function csv(headers: string[], rows: (string | number)[][]): string {
  const lineas = [
    headers.join(SEP),
    ...rows.map((row) => row.map(celda).join(SEP)),
  ];
  return "﻿" + lineas.join("\r\n") + "\r\n";
}

export async function GET(request: NextRequest) {
  // El proxy ya frena a quien no tenga sesión; acá se controla el rol.
  const profile = await getCurrentProfile();
  if (!profile || !profile.active || !hasRank(profile.role, "gerente")) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const params = Object.fromEntries(request.nextUrl.searchParams.entries());
  const range = parseRange(params);
  const tipo = params.tipo ?? "dias";

  const supabase = await getSupabaseServerClient();

  let nombre: string;
  let contenido: string;

  switch (tipo) {
    case "productos": {
      const rows = await getByProduct(supabase, range);
      nombre = "productos";
      contenido = csv(
        ["Producto", "Categoría", "Estación", "Unidades", "Total"],
        rows.map((r) => [
          r.name,
          r.category,
          r.station,
          Number(r.units),
          Number(r.total),
        ])
      );
      break;
    }

    case "medios": {
      const rows = await getByPayment(supabase, range);
      nombre = "medios-de-pago";
      contenido = csv(
        ["Medio de pago", "Tickets", "Total"],
        rows.map((r) => [
          isPaymentMethod(r.payment_method)
            ? PAYMENT_LABELS[r.payment_method]
            : r.payment_method,
          Number(r.tickets),
          Number(r.total),
        ])
      );
      break;
    }

    case "horas": {
      const rows = await getByHour(supabase, range);
      nombre = "franja-horaria";
      contenido = csv(
        ["Hora", "Tickets", "Total"],
        rows.map((r) => [
          `${String(r.hour).padStart(2, "0")}:00`,
          Number(r.tickets),
          Number(r.total),
        ])
      );
      break;
    }

    case "mozos": {
      const rows = await getByWaiter(supabase, range);
      nombre = "por-mozo";
      contenido = csv(
        ["Mozo", "Tickets", "Ticket promedio", "Total"],
        rows.map((r) => [
          r.waiter_name,
          Number(r.tickets),
          Number(r.ticket_avg),
          Number(r.total),
        ])
      );
      break;
    }

    case "dias-semana": {
      const rows = await getByWeekday(supabase, range);
      nombre = "dia-de-la-semana";
      contenido = csv(
        ["Día", "Tickets", "Total"],
        rows.map((r) => [
          WEEKDAY_LABELS[r.weekday] ?? String(r.weekday),
          Number(r.tickets),
          Number(r.total),
        ])
      );
      break;
    }

    default: {
      const rows = await getByDay(supabase, range);
      nombre = "ventas-por-dia";
      contenido = csv(
        [
          "Fecha",
          "Tickets",
          "Total",
          "Efectivo",
          "Débito",
          "Crédito",
          "Transferencia",
          "Otro",
        ],
        rows.map((r) => [
          r.day,
          Number(r.tickets),
          Number(r.total),
          Number(r.efectivo),
          Number(r.debito),
          Number(r.credito),
          Number(r.transferencia),
          Number(r.otro),
        ])
      );
    }
  }

  const archivo = `${nombre}_${range.desde}_a_${range.hasta}.csv`;

  return new NextResponse(contenido, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${archivo}"`,
      "Cache-Control": "no-store",
    },
  });
}
