import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Lo que pregunta la mesa de pool.
 *
 * El servidor no puede llamar al ESP32: está detrás del router del bar, sin IP
 * pública. Así que es al revés — el aparato pregunta cada pocos segundos
 * "¿hasta cuándo habilito?" y de paso cuenta que sigue vivo.
 *
 * ---------------------------------------------------------------------------
 * Contrato
 *
 *   POST /api/pool-device
 *   Header:  X-Pool-Secret: <POOL_WEBHOOK_SECRET>
 *   Body:    { "device_id": "pool-1", "relay_on": true }
 *
 *   Respuesta:
 *   {
 *     "ok": true,
 *     "table_number": 3,
 *     "enabled": true,
 *     "seconds_left": 1740,
 *     "ends_at": "2026-08-19T23:45:00.000Z",
 *     "poll_seconds": 10
 *   }
 *
 * ---------------------------------------------------------------------------
 * Tres cosas que la firmware tiene que respetar
 *
 * 1. Mandarse por `seconds_left`, NO por `ends_at`. Un ESP32 sin RTC arranca
 *    con el reloj en cualquier lado; comparar horas absolutas contra un reloj
 *    equivocado apaga mesas que están pagas. Los segundos que faltan no
 *    dependen de la hora del aparato. `ends_at` va solo para depurar.
 *
 * 2. Seguir contando por su cuenta si no hay respuesta. Si se cae el WiFi, la
 *    mesa tiene que terminar la partida que ya está paga y recién ahí apagarse.
 *    Un corte de red no puede cortarle el juego a alguien que pagó.
 *
 * 3. Respetar `poll_seconds`. El servidor decide cada cuánto conviene
 *    preguntar, y lo cambia según lo que esté pasando. Así se ajusta el ritmo
 *    sin volver a tocar el firmware de cuatro mesas.
 * ---------------------------------------------------------------------------
 */

/** Cada cuánto conviene que pregunte, según lo que esté pasando. */
const POLL_LIBRE = 15;
const POLL_JUGANDO = 10;
const POLL_FINAL = 3;
/** Bajo este umbral, la mesa pregunta seguido: está por apagarse. */
const SEGUNDOS_FINALES = 120;

/** Comparación de secretos en tiempo constante. */
function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // timingSafeEqual explota si difieren los largos; el largo no es secreto.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function readSecret(request: NextRequest): string | null {
  const header = request.headers.get("x-pool-secret");
  if (header) return header.trim();

  const auth = request.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();

  return null;
}

export async function POST(request: NextRequest) {
  const expected = process.env.POOL_WEBHOOK_SECRET;
  if (!expected) {
    console.error("[pool-device] POOL_WEBHOOK_SECRET no está configurada");
    return NextResponse.json(
      { ok: false, enabled: false, error: "Endpoint no configurado." },
      { status: 503 },
    );
  }

  const provided = readSecret(request);
  if (!provided || !secretMatches(provided, expected)) {
    return NextResponse.json(
      { ok: false, enabled: false, error: "No autorizado." },
      { status: 401 },
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, enabled: false, error: "El cuerpo no es JSON válido." },
      { status: 400 },
    );
  }

  const body = (raw ?? {}) as Record<string, unknown>;
  const deviceId =
    typeof body.device_id === "string" ? body.device_id.trim() : "";

  if (!deviceId) {
    return NextResponse.json(
      { ok: false, enabled: false, error: "Falta 'device_id'." },
      { status: 400 },
    );
  }

  const relayOn = typeof body.relay_on === "boolean" ? body.relay_on : null;

  const supabase = getSupabaseAdminClient();

  // Cierra lo que ya venció. Nadie corre una tarea programada acá: el reloj lo
  // hace avanzar quien pasa, y las mesas pasan cada pocos segundos.
  await supabase.rpc("pool_expire_due");

  const { data: pool } = await supabase
    .from("pool_tables")
    .select("table_id, active, tables(number)")
    .eq("device_id", deviceId)
    .maybeSingle<{
      table_id: string;
      active: boolean;
      tables: { number: number } | null;
    }>();

  // Aparato desconocido: queda registrado y la mesa NO se habilita. Un lector
  // mal configurado tiene que fallar cerrado, no abrir mesas gratis.
  if (!pool) {
    await supabase.from("pool_events").insert({
      device_id: deviceId,
      event: "poll",
      rejected: "device_id sin mesa asignada",
      payload: body,
    });

    return NextResponse.json(
      {
        ok: false,
        enabled: false,
        error: "Aparato no reconocido.",
        poll_seconds: POLL_LIBRE,
      },
      { status: 404 },
    );
  }

  // Latido: se supo del aparato y en qué estado dice tener el relé.
  await supabase
    .from("pool_tables")
    .update({
      last_seen_at: new Date().toISOString(),
      ...(relayOn === null ? {} : { relay_on: relayOn }),
    })
    .eq("table_id", pool.table_id);

  if (!pool.active) {
    return NextResponse.json({
      ok: true,
      table_number: pool.tables?.number ?? null,
      enabled: false,
      seconds_left: 0,
      ends_at: null,
      poll_seconds: POLL_LIBRE,
      note: "Mesa fuera de servicio.",
    });
  }

  const { data: session } = await supabase
    .from("pool_sessions")
    .select("id, ends_at")
    .eq("table_id", pool.table_id)
    .eq("status", "activa")
    .maybeSingle<{ id: string; ends_at: string }>();

  if (!session) {
    return NextResponse.json({
      ok: true,
      table_number: pool.tables?.number ?? null,
      enabled: false,
      seconds_left: 0,
      ends_at: null,
      poll_seconds: POLL_LIBRE,
    });
  }

  const secondsLeft = Math.max(
    0,
    Math.round((new Date(session.ends_at).getTime() - Date.now()) / 1000),
  );

  return NextResponse.json({
    ok: true,
    table_number: pool.tables?.number ?? null,
    session_id: session.id,
    enabled: secondsLeft > 0,
    seconds_left: secondsLeft,
    ends_at: session.ends_at,
    poll_seconds:
      secondsLeft <= SEGUNDOS_FINALES ? POLL_FINAL : POLL_JUGANDO,
  });
}

/** Prueba de vida para quien instala el hardware. No expone nada sensible. */
export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "pool-device",
    configured: Boolean(process.env.POOL_WEBHOOK_SECRET),
    contrato: "POST { device_id, relay_on } → { enabled, seconds_left, poll_seconds }",
  });
}
