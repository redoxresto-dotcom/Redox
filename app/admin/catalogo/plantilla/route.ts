import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/auth";
import { hasRank } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Plantilla CSV para el alta masiva de productos.
 *
 * Punto y coma + BOM: es lo que Excel en español abre de un doble clic y lo
 * mismo que espera `importProducts`. Trae dos filas de ejemplo.
 */
const PLANTILLA = [
  "nombre;precio;costo;categoria;estacion;descripcion;en_carta",
  "Cerveza artesanal IPA;280;140;bebida;barra;Rubia lupulada, 500 cc;si",
  "Milanesa con papas;520;260;comida;cocina;Con guarnición a elección;si",
].join("\r\n");

export async function GET() {
  const profile = await getCurrentProfile();
  if (!profile || !profile.active || !hasRank(profile.role, "admin")) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  return new NextResponse("﻿" + PLANTILLA + "\r\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="plantilla-productos.csv"',
      "Cache-Control": "no-store",
    },
  });
}
