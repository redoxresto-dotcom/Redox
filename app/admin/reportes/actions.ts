"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { requireManager } from "@/lib/auth";
import { normalizarClave, parseCsv, parseNumeroLatam } from "@/lib/csv";
import { PAYMENT_METHODS, type PaymentMethod } from "@/lib/types";

export type OfflineImportResult = {
  error: string | null;
  tickets: number;
  lineas: number;
  total: number;
  errores: { fila: string; error: string }[];
};

export type OfflineResult = { error: string | null };

const MEDIO_SINONIMOS: Record<string, PaymentMethod> = {
  efectivo: "efectivo",
  cash: "efectivo",
  contado: "efectivo",
  debito: "debito",
  "tarjeta debito": "debito",
  credito: "credito",
  "tarjeta credito": "credito",
  tarjeta: "credito",
  transferencia: "transferencia",
  transf: "transferencia",
  otro: "otro",
  otros: "otro",
};

const FECHA_RE = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(:\d{2})?$/;

function parseFechaMontevideo(raw: string): Date | null {
  const m = FECHA_RE.exec(raw.trim());
  if (!m) return null;
  const d = new Date(`${m[1]}T${m[2]}:00-03:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

type LineaTicket = {
  productId: string;
  cantidad: number;
  precioUnit: number;
  cost: number;
  station: string;
};

type Ticket = {
  ref: string;
  cuando: Date;
  medio: PaymentMethod;
  mozoId: string | null;
  lineas: LineaTicket[];
};

/**
 * Carga ventas ocurridas mientras el POS estuvo offline (corte de luz o de
 * internet). Cada `ticket` del CSV se guarda como una venta real cobrada,
 * fechada con `fecha_hora`, marcada con origin='manual' y colgada de la mesa de
 * sistema. Entra en todos los reportes; NO en el arqueo de caja (shift_id nulo).
 *
 * Si alguna fila tiene error, no se inserta nada.
 */
export async function importOfflineSales(
  formData: FormData,
): Promise<OfflineImportResult> {
  const yo = await requireManager();

  const vacio: OfflineImportResult = {
    error: null,
    tickets: 0,
    lineas: 0,
    total: 0,
    errores: [],
  };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ...vacio, error: "Subí un archivo CSV." };
  }
  if (file.size > 2 * 1024 * 1024) {
    return { ...vacio, error: "El archivo es muy grande (máximo 2 MB)." };
  }

  const csv = parseCsv(await file.text());
  for (const col of ["ticket", "fecha_hora", "medio_pago", "producto", "cantidad"]) {
    if (!csv.headers.includes(col)) {
      return {
        ...vacio,
        error:
          "Faltan columnas obligatorias (ticket, fecha_hora, medio_pago, producto, cantidad). Descargá la plantilla.",
      };
    }
  }
  if (csv.rows.length === 0) {
    return { ...vacio, error: "El archivo no tiene filas." };
  }
  if (csv.rows.length > 2000) {
    return { ...vacio, error: "Máximo 2000 filas por archivo." };
  }

  const supabase = await getSupabaseServerClient();

  const [mesaRes, prodRes, perfRes] = await Promise.all([
    supabase.from("tables").select("id").eq("is_system", true).limit(1).maybeSingle(),
    supabase.from("products").select("id, name, price, cost, station"),
    supabase.from("profiles").select("id, full_name").eq("active", true),
  ]);

  if (!mesaRes.data) {
    return {
      ...vacio,
      error:
        "Falta la mesa de sistema. Corré supabase/031_ventas_manuales.sql en Supabase.",
    };
  }
  const sistemaId = mesaRes.data.id as string;

  const productos = new Map(
    (prodRes.data ?? []).map((p) => [
      p.name.toLowerCase(),
      {
        id: p.id as string,
        price: Number(p.price),
        cost: Number(p.cost),
        station: p.station as string,
      },
    ]),
  );
  const perfiles = new Map(
    (perfRes.data ?? []).map((p) => [
      (p.full_name as string).toLowerCase(),
      p.id as string,
    ]),
  );

  const col = (fila: string[], name: string) => {
    const i = csv.headers.indexOf(name);
    return i === -1 ? "" : (fila[i] ?? "").trim();
  };

  const errores: { fila: string; error: string }[] = [];
  const porTicket = new Map<string, Ticket>();

  csv.rows.forEach((fila, i) => {
    const nro = String(i + 2);
    const ref = col(fila, "ticket");
    if (!ref) {
      errores.push({ fila: nro, error: "Falta el número de ticket." });
      return;
    }

    const cuando = parseFechaMontevideo(col(fila, "fecha_hora"));
    if (!cuando) {
      errores.push({
        fila: nro,
        error: "fecha_hora inválida (usá AAAA-MM-DD HH:MM).",
      });
      return;
    }

    const medio = MEDIO_SINONIMOS[normalizarClave(col(fila, "medio_pago"))];
    if (!medio || !PAYMENT_METHODS.includes(medio)) {
      errores.push({
        fila: nro,
        error: "medio_pago inválido (efectivo, debito, credito, transferencia u otro).",
      });
      return;
    }

    const nombreProd = col(fila, "producto");
    const prod = productos.get(nombreProd.toLowerCase());
    if (!prod) {
      errores.push({
        fila: nro,
        error: `El producto "${nombreProd}" no está en el catálogo.`,
      });
      return;
    }

    const cant = parseNumeroLatam(col(fila, "cantidad"));
    if (cant === null || Number.isNaN(cant) || !Number.isInteger(cant) || cant < 1) {
      errores.push({ fila: nro, error: "cantidad tiene que ser un entero mayor a 0." });
      return;
    }

    const precioRaw = parseNumeroLatam(col(fila, "precio_unitario"));
    if (precioRaw !== null && (Number.isNaN(precioRaw) || precioRaw < 0)) {
      errores.push({ fila: nro, error: "precio_unitario no es un número válido." });
      return;
    }
    const precioUnit = precioRaw === null ? prod.price : precioRaw;

    const mozoNombre = col(fila, "mozo");
    const mozoId = mozoNombre ? (perfiles.get(mozoNombre.toLowerCase()) ?? null) : null;

    let t = porTicket.get(ref);
    if (!t) {
      t = { ref, cuando, medio, mozoId, lineas: [] };
      porTicket.set(ref, t);
    } else {
      if (t.cuando.getTime() !== cuando.getTime()) {
        errores.push({
          fila: nro,
          error: `El ticket "${ref}" tiene distinta fecha_hora en otra fila.`,
        });
        return;
      }
      if (t.medio !== medio) {
        errores.push({
          fila: nro,
          error: `El ticket "${ref}" tiene distinto medio_pago en otra fila.`,
        });
        return;
      }
      if (!t.mozoId && mozoId) t.mozoId = mozoId;
    }

    t.lineas.push({
      productId: prod.id,
      cantidad: cant,
      precioUnit,
      cost: prod.cost,
      station: prod.station,
    });
  });

  if (errores.length > 0) {
    return { ...vacio, errores };
  }

  const tickets = [...porTicket.values()];
  let lineasTotal = 0;
  let montoTotal = 0;

  for (const t of tickets) {
    const iso = t.cuando.toISOString();
    const { data: ord, error: ordErr } = await supabase
      .from("orders")
      .insert({
        table_id: sistemaId,
        status: "cobrada",
        origin: "manual",
        opened_at: iso,
        closed_at: iso,
        opened_by: t.mozoId,
        closed_by: yo.id,
        payment_method: t.medio,
        shift_id: null,
      })
      .select("id")
      .single();

    if (ordErr || !ord) {
      return {
        ...vacio,
        error: `No se pudo crear el ticket "${t.ref}": ${ordErr?.message ?? ""}`,
      };
    }

    const { error: itErr } = await supabase.from("order_items").insert(
      t.lineas.map((l) => ({
        order_id: ord.id,
        product_id: l.productId,
        quantity: l.cantidad,
        unit_price: l.precioUnit,
        unit_cost: l.cost,
        subtotal: 0, // lo calcula el trigger
        station: l.station,
        status: "entregado",
        created_by: yo.id,
      })),
    );

    if (itErr) {
      // Deja la venta a medio armar: se borra para no dejar un ticket sin líneas.
      await supabase.from("orders").delete().eq("id", ord.id);
      return {
        ...vacio,
        error: `No se pudieron cargar las líneas del ticket "${t.ref}": ${itErr.message}`,
      };
    }

    lineasTotal += t.lineas.length;
    montoTotal += t.lineas.reduce((s, l) => s + l.cantidad * l.precioUnit, 0);
  }

  revalidatePath("/admin/reportes");

  return {
    error: null,
    tickets: tickets.length,
    lineas: lineasTotal,
    total: montoTotal,
    errores: [],
  };
}

/** Borra una venta manual (y sus líneas, en cascada). Para deshacer una carga. */
export async function deleteOfflineSale(orderId: string): Promise<OfflineResult> {
  await requireManager();
  const supabase = await getSupabaseServerClient();

  const { error } = await supabase
    .from("orders")
    .delete()
    .eq("id", orderId)
    .eq("origin", "manual");

  if (error) return { error: "No se pudo borrar la venta: " + error.message };

  revalidatePath("/admin/reportes");
  return { error: null };
}
