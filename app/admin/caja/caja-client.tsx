"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { closeShift, openShift } from "./actions";
import {
  formatMoney,
  PAYMENT_LABELS,
  PAYMENT_METHODS,
  type CashShift,
  type PaymentMethod,
} from "@/lib/types";

export type ShiftSummary = {
  tickets: number;
  total: number;
  porMedio: Partial<Record<PaymentMethod, number>>;
};

type Props = {
  /** Turno abierto, o null si la caja está cerrada. */
  shift: CashShift | null;
  summary: ShiftSummary;
  history: CashShift[];
  /** id de perfil → nombre. */
  names: Record<string, string>;
  isAdmin: boolean;
};

function fecha(iso: string): string {
  return new Date(iso).toLocaleString("es-UY", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function CajaClient({
  shift,
  summary,
  history,
  names,
  isAdmin,
}: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [contando, setContando] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Abrir o cerrar la caja desde otro dispositivo tiene que verse acá.
  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    const channel = supabase
      .channel("caja")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "cash_shifts" },
        () => router.refresh()
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [router]);

  function run(fn: () => Promise<{ error: string | null }>, onDone?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (result.error) setError(result.error);
      else onDone?.();
    });
  }

  const efectivoEsperado = shift
    ? Number(shift.opening_float) + (summary.porMedio.efectivo ?? 0)
    : 0;

  return (
    <main className="mx-auto max-w-4xl px-4 py-6">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold">Caja</h1>
        <p className="text-sm text-[var(--color-muted)]">
          {shift
            ? `Turno abierto ${fecha(shift.opened_at)}${
                shift.opened_by && names[shift.opened_by]
                  ? ` por ${names[shift.opened_by]}`
                  : ""
              }`
            : "La caja está cerrada."}
        </p>
      </header>

      {error ? (
        <p
          role="alert"
          className="mb-4 rounded-lg border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-3 py-2 text-sm text-[var(--color-danger)]"
        >
          {error}
        </p>
      ) : null}

      {shift === null ? (
        <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
          <h2 className="text-lg font-medium">Abrir la caja</h2>
          <p className="mt-1 mb-4 text-sm text-[var(--color-muted)]">
            Contá el fondo de cambio con el que arranca el turno. Es contra ese
            número que se hace el arqueo al cerrar.
          </p>

          <form
            action={(formData) => run(() => openShift(formData))}
            className="flex flex-wrap items-end gap-3"
          >
            <label className="grid w-40 gap-1">
              <span className="text-xs text-[var(--color-muted)]">
                Fondo de cambio
              </span>
              <input
                name="opening_float"
                type="number"
                min="0"
                step="0.01"
                defaultValue={0}
                required
                autoFocus
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 tabular-nums outline-none focus:border-[var(--color-accent)]"
              />
            </label>
            <button
              type="submit"
              disabled={isPending}
              className="rounded-xl bg-[var(--color-accent)] px-5 py-2.5 font-semibold text-[#04121c] disabled:opacity-50"
            >
              {isPending ? "Abriendo…" : "Abrir turno"}
            </button>
          </form>
        </section>
      ) : (
        <section className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
            <h2 className="text-sm tracking-wide text-[var(--color-muted)] uppercase">
              Vendido en el turno
            </h2>
            <p className="mt-1 text-3xl font-semibold tabular-nums">
              {formatMoney(summary.total)}
            </p>
            <p className="text-sm text-[var(--color-muted)]">
              {summary.tickets} ticket{summary.tickets === 1 ? "" : "s"}
              {summary.tickets > 0
                ? ` · promedio ${formatMoney(summary.total / summary.tickets)}`
                : ""}
            </p>

            <ul className="mt-4 grid gap-1.5 border-t border-[var(--color-border)] pt-3">
              {PAYMENT_METHODS.map((method) => (
                <li
                  key={method}
                  className="flex items-baseline justify-between text-sm"
                >
                  <span className="text-[var(--color-muted)]">
                    {PAYMENT_LABELS[method]}
                  </span>
                  <span className="tabular-nums">
                    {formatMoney(summary.porMedio[method] ?? 0)}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
            <h2 className="text-sm tracking-wide text-[var(--color-muted)] uppercase">
              Efectivo esperado en caja
            </h2>
            <p className="mt-1 text-3xl font-semibold tabular-nums">
              {formatMoney(efectivoEsperado)}
            </p>
            <p className="text-sm text-[var(--color-muted)]">
              Fondo {formatMoney(shift.opening_float)} + ventas en efectivo{" "}
              {formatMoney(summary.porMedio.efectivo ?? 0)}
            </p>

            <div className="mt-4 border-t border-[var(--color-border)] pt-4">
              {!isAdmin ? (
                <p className="text-sm text-[var(--color-muted)]">
                  El cierre y el arqueo los hace un encargado.
                </p>
              ) : contando ? (
                <form
                  action={(formData) =>
                    run(
                      () => closeShift(shift.id, formData),
                      () => setContando(false)
                    )
                  }
                  className="grid gap-3"
                >
                  <label className="grid gap-1">
                    <span className="text-xs text-[var(--color-muted)]">
                      Efectivo contado
                    </span>
                    <input
                      name="counted_cash"
                      type="number"
                      min="0"
                      step="0.01"
                      required
                      autoFocus
                      className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 tabular-nums outline-none focus:border-[var(--color-accent)]"
                    />
                  </label>
                  <label className="grid gap-1">
                    <span className="text-xs text-[var(--color-muted)]">
                      Observaciones (opcional)
                    </span>
                    <input
                      name="notes"
                      className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setContando(false)}
                      disabled={isPending}
                      className="rounded-xl border border-[var(--color-border)] px-4 py-2.5 text-sm disabled:opacity-50"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      disabled={isPending}
                      className="rounded-xl bg-[var(--color-free)] px-4 py-2.5 font-semibold text-[#04140a] disabled:opacity-50"
                    >
                      {isPending ? "Cerrando…" : "Cerrar turno"}
                    </button>
                  </div>
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() => setContando(true)}
                  className="w-full rounded-xl border border-[var(--color-border)] px-4 py-3 font-medium transition-colors hover:border-[var(--color-free)] hover:text-[var(--color-free)]"
                >
                  Cerrar turno y arquear
                </button>
              )}
            </div>
          </div>
        </section>
      )}

      {history.length > 0 ? (
        <section className="mt-8">
          <h2 className="mb-3 text-lg font-medium">Turnos cerrados</h2>
          <div className="overflow-x-auto rounded-xl border border-[var(--color-border)]">
            <table className="w-full text-sm">
              <thead className="bg-[var(--color-surface)] text-left text-xs tracking-wide text-[var(--color-muted)] uppercase">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Cierre</th>
                  <th className="px-4 py-2.5 font-medium">Cerró</th>
                  <th className="px-4 py-2.5 text-right font-medium">Esperado</th>
                  <th className="px-4 py-2.5 text-right font-medium">Contado</th>
                  <th className="px-4 py-2.5 text-right font-medium">
                    Diferencia
                  </th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => {
                  const dif = Number(h.difference ?? 0);
                  return (
                    <tr
                      key={h.id}
                      className="border-t border-[var(--color-border)]"
                    >
                      <td className="px-4 py-3">
                        {h.closed_at ? fecha(h.closed_at) : "—"}
                        {h.notes ? (
                          <span className="block text-xs text-[var(--color-muted)]">
                            {h.notes}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-[var(--color-muted)]">
                        {h.closed_by ? (names[h.closed_by] ?? "—") : "—"}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-[var(--color-muted)]">
                        {formatMoney(Number(h.expected_cash ?? 0))}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {formatMoney(Number(h.counted_cash ?? 0))}
                      </td>
                      <td
                        className={`px-4 py-3 text-right font-medium tabular-nums ${
                          dif === 0
                            ? "text-[var(--color-muted)]"
                            : dif > 0
                              ? "text-[var(--color-free)]"
                              : "text-[var(--color-danger)]"
                        }`}
                      >
                        {dif > 0 ? "+" : ""}
                        {formatMoney(dif)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-[var(--color-muted)]">
            La diferencia es lo contado menos lo esperado: positivo sobra,
            negativo falta. El esperado queda congelado al cerrar, así que
            cambiar una cuenta vieja no reescribe un arqueo ya firmado.
          </p>
        </section>
      ) : null}
    </main>
  );
}
