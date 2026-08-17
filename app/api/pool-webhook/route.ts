import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Puente entre el hardware de las mesas de pool y el POS.
 *
 * El lector RFID/de tarjetas manda un POST cuando arranca o termina una
 * partida. El endpoint valida el secreto compartido, deja constancia del
 * payload crudo en `pool_sessions` y, si corresponde, carga el importe a la
 * cuenta abierta de la mesa.
 *
 * Corre con service_role porque no hay ningún usuario logueado del otro lado.
 * El secreto es lo único que separa este endpoint de internet: sin él,
 * cualquiera podría cargar consumos a cualquier mesa.
 *
 * ---------------------------------------------------------------------------
 * Contrato
 *
 *   POST /api/pool-webhook
 *   Header:  X-Pool-Secret: <POOL_WEBHOOK_SECRET>
 *            (o  Authorization: Bearer <POOL_WEBHOOK_SECRET>)
 *   Body (JSON):
 *   {
 *     "device_id":    "pool-1",              // obligatorio
 *     "event":        "session_end",         // session_start | session_end
 *     "table_number": 7,                     // o "table_id": "<uuid>"
 *     "minutes":      45,                    // requerido en session_end
 *     "amount":       225.00,                // opcional: fuerza el importe
 *     "card_uid":     "04A2B3C4",            // opcional
 *     "external_id":  "pool1-2026-0817-0042" // opcional pero MUY recomendado
 *   }
 *
 * `external_id` es la clave de idempotencia: si el lector reintenta por un
 * corte de red, el mismo id no vuelve a cobrar.
 * ---------------------------------------------------------------------------
 */

type PoolEvent = "session_start" | "session_end";

type ParsedBody = {
  device_id: string;
  event: PoolEvent;
  table_id?: string;
  table_number?: number;
  minutes?: number;
  amount?: number;
  card_uid?: string;
  external_id?: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

function badRequest(error: string, detail?: unknown) {
  return NextResponse.json({ ok: false, error, detail }, { status: 400 });
}

function parseBody(raw: unknown):
  | { ok: true; body: ParsedBody }
  | { ok: false; error: string } {
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, error: "El cuerpo debe ser un objeto JSON." };
  }

  const b = raw as Record<string, unknown>;

  const device_id = typeof b.device_id === "string" ? b.device_id.trim() : "";
  if (!device_id) return { ok: false, error: "Falta 'device_id'." };

  const event = b.event;
  if (event !== "session_start" && event !== "session_end") {
    return {
      ok: false,
      error: "'event' debe ser 'session_start' o 'session_end'.",
    };
  }

  const parsed: ParsedBody = { device_id, event };

  if (b.table_id !== undefined) {
    if (typeof b.table_id !== "string" || !UUID.test(b.table_id)) {
      return { ok: false, error: "'table_id' no es un UUID válido." };
    }
    parsed.table_id = b.table_id;
  }

  if (b.table_number !== undefined) {
    const n = Number(b.table_number);
    if (!Number.isInteger(n) || n <= 0) {
      return { ok: false, error: "'table_number' debe ser un entero positivo." };
    }
    parsed.table_number = n;
  }

  if (!parsed.table_id && parsed.table_number === undefined) {
    return { ok: false, error: "Indicá 'table_id' o 'table_number'." };
  }

  if (b.minutes !== undefined) {
    const m = Number(b.minutes);
    if (!Number.isFinite(m) || m < 0) {
      return { ok: false, error: "'minutes' debe ser un número no negativo." };
    }
    parsed.minutes = Math.round(m);
  }

  if (b.amount !== undefined) {
    const a = Number(b.amount);
    if (!Number.isFinite(a) || a < 0) {
      return { ok: false, error: "'amount' debe ser un número no negativo." };
    }
    parsed.amount = Math.round(a * 100) / 100;
  }

  if (event === "session_end" && parsed.minutes === undefined && parsed.amount === undefined) {
    return {
      ok: false,
      error: "Un 'session_end' necesita 'minutes' o 'amount'.",
    };
  }

  if (typeof b.card_uid === "string" && b.card_uid.trim()) {
    parsed.card_uid = b.card_uid.trim();
  }
  if (typeof b.external_id === "string" && b.external_id.trim()) {
    parsed.external_id = b.external_id.trim();
  }

  return { ok: true, body: parsed };
}

// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  const expected = process.env.POOL_WEBHOOK_SECRET;
  if (!expected) {
    console.error("[pool-webhook] POOL_WEBHOOK_SECRET no está configurada");
    return NextResponse.json(
      { ok: false, error: "Endpoint no configurado." },
      { status: 503 }
    );
  }

  const provided = readSecret(request);
  if (!provided || !secretMatches(provided, expected)) {
    return NextResponse.json(
      { ok: false, error: "No autorizado." },
      { status: 401 }
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return badRequest("El cuerpo no es JSON válido.");
  }

  const parsed = parseBody(raw);
  if (!parsed.ok) return badRequest(parsed.error);
  const body = parsed.body;

  const supabase = getSupabaseAdminClient();

  // --- Idempotencia: ¿ya procesamos este evento? ---------------------------
  if (body.external_id) {
    const { data: previous } = await supabase
      .from("pool_sessions")
      .select("id, order_id, amount, minutes")
      .eq("external_id", body.external_id)
      .maybeSingle();

    if (previous) {
      return NextResponse.json({
        ok: true,
        duplicate: true,
        session_id: previous.id,
        order_id: previous.order_id,
        minutes: previous.minutes,
        amount: previous.amount,
      });
    }
  }

  // --- Resolver la mesa ----------------------------------------------------
  const tableQuery = supabase.from("tables").select("id, number");
  const { data: table } = body.table_id
    ? await tableQuery.eq("id", body.table_id).maybeSingle()
    : await tableQuery.eq("number", body.table_number!).maybeSingle();

  if (!table) {
    // Igual queda registrado: sirve para detectar un lector mal configurado.
    await supabase.from("pool_sessions").insert({
      device_id: body.device_id,
      card_uid: body.card_uid ?? null,
      event: body.event,
      minutes: body.minutes ?? null,
      external_id: body.external_id ?? null,
      payload: raw as object,
    });

    return NextResponse.json(
      { ok: false, error: "Mesa no encontrada." },
      { status: 404 }
    );
  }

  // --- Abrir (o recuperar) la cuenta de la mesa ----------------------------
  const { data: orderId, error: orderError } = await supabase.rpc(
    "open_table_order",
    { p_table_id: table.id }
  );

  if (orderError || !orderId) {
    console.error("[pool-webhook] no se pudo abrir la cuenta", orderError);
    return NextResponse.json(
      { ok: false, error: "No se pudo abrir la cuenta de la mesa." },
      { status: 500 }
    );
  }

  // --- session_start: solo deja constancia y ocupa la mesa -----------------
  if (body.event === "session_start") {
    const { data: session, error: sessionError } = await supabase
      .from("pool_sessions")
      .insert({
        device_id: body.device_id,
        card_uid: body.card_uid ?? null,
        table_id: table.id,
        order_id: orderId,
        event: body.event,
        external_id: body.external_id ?? null,
        payload: raw as object,
      })
      .select("id")
      .single();

    // Si no se pudo dejar constancia, no se puede responder que salió bien:
    // el lector daría por registrada una partida que no existe en el sistema.
    if (sessionError || !session) {
      console.error("[pool-webhook] no se pudo registrar la sesión", sessionError);
      return NextResponse.json(
        { ok: false, error: "No se pudo registrar la sesión de pool." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      session_id: session.id,
      table_number: table.number,
      order_id: orderId,
      charged: false,
    });
  }

  // --- session_end: calcular el importe y cargarlo -------------------------
  const { data: rate } = await supabase
    .from("products")
    .select("id, name, price, cost")
    .eq("is_pool_rate", true)
    .maybeSingle();

  // Toda línea de una cuenta apunta a un producto: sin tarifa designada no hay
  // forma de cobrar el pool, ni siquiera mandando el importe hecho.
  if (!rate) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "No hay producto marcado como tarifa de pool. Marcá uno con is_pool_rate = true en el catálogo.",
      },
      { status: 409 }
    );
  }

  // El precio del catálogo es por hora; se prorratea por minuto.
  // Si el lector manda 'amount', manda el lector.
  const amount =
    body.amount ??
    Math.round((body.minutes! / 60) * Number(rate.price) * 100) / 100;

  const { data: item, error: itemError } = await supabase
    .from("order_items")
    .insert({
      order_id: orderId,
      product_id: rate.id,
      quantity: 1,
      unit_price: amount,
      unit_cost: 0,
      subtotal: 0, // lo calcula el trigger
    })
    .select("id")
    .single();

  if (itemError) {
    console.error("[pool-webhook] no se pudo cargar el consumo", itemError);
    return NextResponse.json(
      { ok: false, error: "No se pudo cargar el consumo a la cuenta." },
      { status: 500 }
    );
  }

  const { data: session, error: sessionError } = await supabase
    .from("pool_sessions")
    .insert({
      device_id: body.device_id,
      card_uid: body.card_uid ?? null,
      table_id: table.id,
      order_id: orderId,
      order_item_id: item.id,
      event: body.event,
      minutes: body.minutes ?? null,
      amount,
      external_id: body.external_id ?? null,
      payload: raw as object,
    })
    .select("id")
    .single();

  // El consumo ya está cargado a la cuenta, así que la respuesta es un éxito.
  // Pero sin bitácora se pierde la idempotencia: si el lector reintenta, vuelve
  // a cobrar. Se avisa para que el problema no pase inadvertido.
  if (sessionError) {
    console.error("[pool-webhook] cobro hecho pero sin bitácora", sessionError);
  }

  return NextResponse.json({
    ok: true,
    logged: !sessionError,
    session_id: session?.id ?? null,
    table_number: table.number,
    order_id: orderId,
    order_item_id: item.id,
    minutes: body.minutes ?? null,
    amount,
    charged: true,
  });
}

/** Health check para el instalador del hardware. No expone nada sensible. */
export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "pool-webhook",
    configured: Boolean(process.env.POOL_WEBHOOK_SECRET),
    accepts: ["session_start", "session_end"],
  });
}
