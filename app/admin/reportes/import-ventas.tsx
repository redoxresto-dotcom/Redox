"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  deleteOfflineSale,
  importOfflineSales,
  type OfflineImportResult,
} from "./actions";
import { formatMoney, PAYMENT_LABELS, type PaymentMethod } from "@/lib/types";

export type VentaManual = {
  id: string;
  closed_at: string;
  total: number;
  payment_method: PaymentMethod | null;
  mozo: string | null;
};

function hora(iso: string): string {
  return new Date(iso).toLocaleString("es-UY", {
    timeZone: "America/Montevideo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function ImportVentas({ manuales }: { manuales: VentaManual[] }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [result, setResult] = useState<OfflineImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function onSubmit(formData: FormData) {
    setError(null);
    setResult(null);
    startTransition(async () => {
      const r = await importOfflineSales(formData);
      if (r.error) setError(r.error);
      else {
        setResult(r);
        if (r.errores.length === 0) router.refresh();
      }
    });
  }

  function borrar(id: string) {
    startTransition(async () => {
      const r = await deleteOfflineSale(id);
      if (r.error) setError(r.error);
      else router.refresh();
    });
  }

  return (
    <section className="mt-6">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        className="flex w-full items-center justify-between rounded-2xl bg-white/5 px-4 py-3 text-left backdrop-blur-xl transition-colors hover:bg-white/10"
      >
        <span className="text-sm font-medium">
          Cargar ventas sin conexión (corte de luz / internet)
          {manuales.length > 0 ? (
            <span className="ml-2 rounded-full bg-[var(--color-accent)]/20 px-1.5 py-0.5 text-xs font-semibold text-[var(--color-accent)] tabular-nums">
              {manuales.length}
            </span>
          ) : null}
        </span>
        <span className="text-[var(--color-muted)]">{abierto ? "−" : "+"}</span>
      </button>

      {abierto ? (
        <div className="mt-2 rounded-2xl bg-white/5 p-4 shadow-lg shadow-black/10 backdrop-blur-xl">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-xs text-[var(--color-muted)]">
              Una fila por producto. Las líneas de un mismo ticket comparten{" "}
              <strong>ticket</strong>, <strong>fecha_hora</strong>,{" "}
              <strong>medio_pago</strong> y <strong>mozo</strong>. Suman a los
              reportes, no al arqueo de caja.
            </p>
            <a
              href="/admin/reportes/plantilla-ventas"
              className="text-sm text-[var(--color-accent)] underline"
            >
              Descargar plantilla
            </a>
          </div>

          <form action={onSubmit} className="mt-3 flex flex-wrap items-center gap-2">
            <input
              type="file"
              name="file"
              accept=".csv,text/csv"
              required
              className="text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-[var(--color-surface-2)] file:px-3 file:py-2 file:text-sm file:text-[var(--color-ink)]"
            />
            <button
              type="submit"
              disabled={isPending}
              className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-[#04121c] disabled:opacity-50"
            >
              {isPending ? "Cargando…" : "Cargar"}
            </button>
          </form>

          {error ? (
            <p
              role="alert"
              className="mt-3 rounded-lg bg-[var(--color-danger)]/15 px-3 py-2 text-sm text-[var(--color-danger)] backdrop-blur-md"
            >
              {error}
            </p>
          ) : null}

          {result && result.errores.length > 0 ? (
            <div className="mt-3 rounded-lg bg-[var(--color-danger)]/15 p-3 text-sm backdrop-blur-md">
              <p className="font-medium text-[var(--color-danger)]">
                No se cargó nada. Corregí estas filas:
              </p>
              <ul className="mt-1.5 grid gap-0.5">
                {result.errores.map((e, i) => (
                  <li key={i}>
                    <span className="text-[var(--color-muted)]">Fila {e.fila}:</span>{" "}
                    {e.error}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {result && result.errores.length === 0 ? (
            <p className="mt-3 rounded-lg bg-[var(--color-free)]/15 px-3 py-2 text-sm text-[var(--color-free)] backdrop-blur-md">
              {result.tickets} ticket{result.tickets === 1 ? "" : "s"} ·{" "}
              {result.lineas} línea{result.lineas === 1 ? "" : "s"} ·{" "}
              {formatMoney(result.total)} cargados.
            </p>
          ) : null}

          {manuales.length > 0 ? (
            <div className="mt-4 border-t border-white/10 pt-3">
              <p className="mb-1.5 text-xs tracking-wide text-[var(--color-muted)] uppercase">
                Ventas cargadas a mano en este período
              </p>
              <ul className="grid gap-1.5">
                {manuales.map((m) => (
                  <li
                    key={m.id}
                    className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 rounded-lg bg-[var(--color-surface-2)] px-3 py-2 text-sm"
                  >
                    <span className="tabular-nums text-[var(--color-muted)]">
                      {hora(m.closed_at)}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {m.payment_method
                        ? PAYMENT_LABELS[m.payment_method]
                        : "—"}
                      {m.mozo ? ` · ${m.mozo}` : ""}
                    </span>
                    <span className="font-medium tabular-nums">
                      {formatMoney(Number(m.total))}
                    </span>
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => borrar(m.id)}
                      className="rounded-md bg-white/5 px-2 py-0.5 text-xs text-[var(--color-muted)] backdrop-blur-md transition-colors hover:bg-[var(--color-danger)]/15 hover:text-[var(--color-danger)] disabled:opacity-50"
                    >
                      Borrar
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
