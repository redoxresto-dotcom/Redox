"use client";

import { useEffect } from "react";
import { PAYMENT_LABELS, type TicketData } from "@/lib/types";

/** Ancho de línea del ticket de 80 mm en tipografía monoespaciada. */
const W = 42;

function n2(x: number): string {
  return x.toFixed(2).replace(".", ",");
}

function centrar(s: string): string {
  if (s.length >= W) return s.slice(0, W);
  const libre = W - s.length;
  return " ".repeat(Math.floor(libre / 2)) + s;
}

const ANCHO_DESC = W - 3 - 9 - 9 - 2; // cnt(3) + sep + desc + sep + unit(9) + total(9)

function fila(cant: string, desc: string, unit: string, total: string): string {
  const c = cant.padStart(3);
  const u = unit.padStart(9);
  const t = total.padStart(9);
  const d =
    desc.length > ANCHO_DESC
      ? desc.slice(0, ANCHO_DESC)
      : desc.padEnd(ANCHO_DESC);
  return `${c} ${d} ${u}${t}`;
}

/** Las líneas del comprobante, en el orden en que se imprimen (5 bloques). */
export function buildTicketLines(data: TicketData): string[] {
  const sep = "-".repeat(W);
  const doble = "=".repeat(W);
  const lineas: string[] = [];

  // Bloque 1 — emisor
  lineas.push(centrar(data.emisor.nombre.toUpperCase()));
  if (data.emisor.linea2) lineas.push(centrar(data.emisor.linea2));
  lineas.push(doble);

  // Bloque 2 — comprobante
  lineas.push("Comprobante interno");
  lineas.push(`Nro:    ${data.comprobante.numero}`);
  lineas.push(`Fecha:  ${data.comprobante.fecha}`);
  lineas.push(`Mesa:   ${data.comprobante.mesa}`);
  lineas.push(`Cajero: ${data.comprobante.cajero}`);
  lineas.push(sep);

  // Bloque 3 — detalle (columnas: cantidad, descripción, p. unitario, total)
  lineas.push(fila("CNT", "DESCRIPCION", "P.UNIT", "TOTAL"));
  lineas.push(sep);
  for (const l of data.lineas) {
    lineas.push(
      fila(String(l.cantidad), l.descripcion, n2(l.unitario), n2(l.total)),
    );
  }
  lineas.push(sep);

  // Bloque 4 — totales
  lineas.push(`TOTAL: $ ${n2(data.total)}`.padStart(W));
  lineas.push(sep);

  // Bloque 5 — pago
  lineas.push(`Pago: ${PAYMENT_LABELS[data.medioPago]}`);
  lineas.push(doble);
  lineas.push(centrar("Comprobante sin valor fiscal"));
  lineas.push(centrar("Gracias por tu visita"));

  return lineas;
}

/**
 * Vista del ticket a imprimir por navegador. Formato de 80 mm, monoespaciada.
 * Es el paso previo a la impresión térmica ESC/POS por WebUSB, que reusará
 * `buildTicketLines` y la misma estructura `TicketData`.
 */
export function TicketModal({
  data,
  onClose,
}: {
  data: TicketData;
  onClose: () => void;
}) {
  useEffect(() => {
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [onClose]);

  const texto = buildTicketLines(data).join("\n");

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Comprobante"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    >
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #ticket-print, #ticket-print * { visibility: visible !important; }
          #ticket-print {
            position: absolute; left: 0; top: 0; width: 80mm;
            padding: 0; margin: 0; box-shadow: none; border: 0;
            color: #000; background: #fff;
          }
        }
      `}</style>

      <div className="w-full max-w-sm rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <div
          id="ticket-print"
          className="mx-auto w-[80mm] max-w-full rounded-lg bg-white p-3 text-black"
        >
          <pre className="font-mono text-[11px] leading-tight whitespace-pre-wrap">
            {texto}
          </pre>
        </div>

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => window.print()}
            className="flex-1 rounded-lg bg-[var(--color-accent)] px-4 py-2.5 text-sm font-semibold text-[#04121c]"
          >
            Imprimir
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[var(--color-border)] px-4 py-2.5 text-sm text-[var(--color-muted)] transition-colors hover:text-[var(--color-ink)]"
          >
            Cerrar
          </button>
        </div>
        <p className="mt-2 text-xs text-[var(--color-muted)]">
          Comprobante interno, sin valor fiscal. La impresión térmica ESC/POS
          por USB llega en la próxima entrega.
        </p>
      </div>
    </div>
  );
}
