"use client";

import { useState, useTransition } from "react";
import { importProducts, type ImportResult } from "./actions";

export function ImportPanel({ onDone }: { onDone: () => void }) {
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function onSubmit(formData: FormData) {
    setError(null);
    setResult(null);
    startTransition(async () => {
      const r = await importProducts(formData);
      if (r.error) setError(r.error);
      else {
        setResult(r);
        if (r.errores.length === 0 && (r.creados > 0 || r.actualizados > 0)) {
          onDone();
        }
      }
    });
  }

  return (
    <div className="mb-4 rounded-xl border border-[var(--color-accent)]/40 bg-[var(--color-surface)] p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-medium">Importar productos desde CSV</h2>
        <a
          href="/admin/catalogo/plantilla"
          className="text-sm text-[var(--color-accent)] underline"
        >
          Descargar plantilla
        </a>
      </div>
      <p className="mt-1 text-xs text-[var(--color-muted)]">
        Columnas: <strong>nombre</strong>, <strong>precio</strong>,{" "}
        <strong>categoria</strong> (obligatorias) y costo, estacion, descripcion,
        en_carta. Sin imágenes ni combos. Guardá el Excel como «CSV UTF-8».
      </p>

      <form action={onSubmit} className="mt-3 grid gap-3">
        <input
          type="file"
          name="file"
          accept=".csv,text/csv"
          required
          className="text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-[var(--color-surface-2)] file:px-3 file:py-2 file:text-sm file:text-[var(--color-ink)]"
        />

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="actualizar"
            className="size-4 accent-[var(--color-accent)]"
          />
          Actualizar precio/costo/categoría de los productos que ya existen (por
          nombre). Si está apagado, los repetidos se omiten.
        </label>

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={isPending}
            className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-[#04121c] disabled:opacity-50"
          >
            {isPending ? "Importando…" : "Importar"}
          </button>
          <button
            type="button"
            onClick={onDone}
            className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-muted)]"
          >
            Cerrar
          </button>
        </div>
      </form>

      {error ? (
        <p
          role="alert"
          className="mt-3 rounded-lg border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-3 py-2 text-sm text-[var(--color-danger)]"
        >
          {error}
        </p>
      ) : null}

      {result && result.errores.length > 0 ? (
        <div className="mt-3 rounded-lg border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 p-3 text-sm">
          <p className="font-medium text-[var(--color-danger)]">
            No se importó nada. Corregí estas filas y volvé a subir el archivo:
          </p>
          <ul className="mt-1.5 grid gap-0.5">
            {result.errores.map((e) => (
              <li key={e.fila}>
                <span className="text-[var(--color-muted)]">Fila {e.fila}:</span>{" "}
                {e.error}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {result && result.errores.length === 0 ? (
        <p className="mt-3 rounded-lg border border-[var(--color-free)]/40 bg-[var(--color-free)]/10 px-3 py-2 text-sm text-[var(--color-free)]">
          {result.creados} creado{result.creados === 1 ? "" : "s"} ·{" "}
          {result.actualizados} actualizado
          {result.actualizados === 1 ? "" : "s"} · {result.omitidos} omitido
          {result.omitidos === 1 ? "" : "s"}.
        </p>
      ) : null}
    </div>
  );
}
