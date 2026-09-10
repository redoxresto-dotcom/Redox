import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth";
import { hasRank } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Plantilla CSV para cargar ventas ocurridas sin conexión.
 *
 * Una fila por producto; las líneas de un mismo ticket comparten `ticket`,
 * `fecha_hora`, `medio_pago` y `mozo`. Trae un ticket de ejemplo con 2 líneas.
 */
const PLANTILLA = [
  "ticket;fecha_hora;medio_pago;mozo;producto;cantidad;precio_unitario",
  "1;2026-09-08 21:30;efectivo;Juan Pérez;Cerveza tirada 500ml;2;220",
  "1;2026-09-08 21:30;efectivo;Juan Pérez;Papas fritas;1;",
  "2;2026-09-08 22:05;debito;;Fernet con cola;3;280",
].join("\r\n");

export async function GET() {
  const profile = await getCurrentProfile();
  if (!profile || !profile.active || !hasRank(profile.role, "gerente")) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  return new NextResponse("﻿" + PLANTILLA + "\r\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="plantilla-ventas-sin-conexion.csv"',
      "Cache-Control": "no-store",
    },
  });
}
