"use client";

import { useMemo, useState, useTransition } from "react";
import {
  createProduct,
  deleteProduct,
  reactivateProduct,
  updateProduct,
} from "./actions";
import {
  CATEGORY_LABELS,
  formatMoney,
  STATION_LABELS,
  type Product,
  type ProductCategory,
  type Station,
} from "@/lib/types";

const CATEGORIES: ProductCategory[] = ["bebida", "comida", "otro"];
const STATIONS: Station[] = ["barra", "cocina", "ninguna"];

/** Margen bruto sobre el precio de venta. */
function margin(product: Product): number | null {
  if (!product.price) return null;
  return ((product.price - product.cost) / product.price) * 100;
}

export function CatalogManager({ products }: { products: Product[] }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [isPending, startTransition] = useTransition();

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return term
      ? products.filter((p) => p.name.toLowerCase().includes(term))
      : products;
  }, [products, search]);

  const activos = products.filter((p) => p.active);
  const margenPromedio = activos.length
    ? activos.reduce((sum, p) => sum + (margin(p) ?? 0), 0) / activos.length
    : 0;

  function run(fn: () => Promise<{ error: string | null }>, onDone?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (result.error) setError(result.error);
      else onDone?.();
    });
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Catálogo</h1>
          <p className="text-sm text-[var(--color-muted)]">
            {activos.length} producto{activos.length === 1 ? "" : "s"} en venta ·
            margen promedio {margenPromedio.toFixed(0)}%
          </p>
        </div>

        <div className="flex items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar…"
            className="w-36 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
          />
          <button
            type="button"
            onClick={() => {
              setCreating((c) => !c);
              setEditingId(null);
              setError(null);
            }}
            className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-[#04121c]"
          >
            {creating ? "Cancelar" : "+ Producto"}
          </button>
        </div>
      </header>

      {error ? (
        <p
          role="alert"
          className="mb-4 rounded-lg border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-3 py-2 text-sm text-[var(--color-danger)]"
        >
          {error}
        </p>
      ) : null}

      {creating ? (
        <div className="mb-4 rounded-xl border border-[var(--color-accent)]/40 bg-[var(--color-surface)] p-4">
          <ProductForm
            disabled={isPending}
            onSubmit={(formData) =>
              run(() => createProduct(formData), () => setCreating(false))
            }
            onCancel={() => setCreating(false)}
            submitLabel="Agregar"
          />
        </div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-[var(--color-border)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--color-surface)] text-left text-xs tracking-wide text-[var(--color-muted)] uppercase">
            <tr>
              <th className="px-4 py-2.5 font-medium">Producto</th>
              <th className="px-4 py-2.5 font-medium">Categoría</th>
              <th className="px-4 py-2.5 font-medium">Estación</th>
              <th className="px-4 py-2.5 font-medium">Carta</th>
              <th className="px-4 py-2.5 text-right font-medium">Venta</th>
              <th className="px-4 py-2.5 text-right font-medium">Costo</th>
              <th className="px-4 py-2.5 text-right font-medium">Margen</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="px-4 py-10 text-center text-[var(--color-muted)]"
                >
                  {search ? "Ningún producto coincide." : "El catálogo está vacío."}
                </td>
              </tr>
            ) : (
              visible.map((product) => {
                const m = margin(product);
                const isEditing = editingId === product.id;

                return (
                  <tr
                    key={product.id}
                    className={`border-t border-[var(--color-border)] ${
                      product.active ? "" : "opacity-45"
                    }`}
                  >
                    {isEditing ? (
                      <td colSpan={8} className="bg-[var(--color-surface)] px-4 py-4">
                        <ProductForm
                          product={product}
                          disabled={isPending}
                          onSubmit={(formData) =>
                            run(
                              () => updateProduct(product.id, formData),
                              () => setEditingId(null)
                            )
                          }
                          onCancel={() => setEditingId(null)}
                          submitLabel="Guardar"
                        />
                      </td>
                    ) : (
                      <>
                        <td className="px-4 py-3">
                          {product.name}
                          {product.description ? (
                            <span className="block max-w-xs truncate text-xs text-[var(--color-muted)]">
                              {product.description}
                            </span>
                          ) : null}
                          {!product.active ? (
                            <span className="ml-2 rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[10px] tracking-wide uppercase">
                              fuera de venta
                            </span>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 text-[var(--color-muted)]">
                          {CATEGORY_LABELS[product.category]}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs ${
                              product.station === "cocina"
                                ? "bg-[var(--color-busy)]/15 text-[var(--color-busy)]"
                                : product.station === "barra"
                                  ? "bg-[var(--color-accent)]/15 text-[var(--color-accent)]"
                                  : "bg-[var(--color-surface-2)] text-[var(--color-muted)]"
                            }`}
                          >
                            {STATION_LABELS[product.station]}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {product.in_menu ? (
                            <span className="text-[var(--color-free)]" title="Se muestra en la carta del QR">
                              ✓
                            </span>
                          ) : (
                            <span className="text-[var(--color-muted)]" title="No se muestra en la carta">
                              —
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {formatMoney(product.price)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-[var(--color-muted)]">
                          {formatMoney(product.cost)}
                        </td>
                        <td
                          className={`px-4 py-3 text-right tabular-nums ${
                            m !== null && m < 30
                              ? "text-[var(--color-busy)]"
                              : "text-[var(--color-free)]"
                          }`}
                        >
                          {m === null ? "—" : `${m.toFixed(0)}%`}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-1">
                            <button
                              type="button"
                              disabled={isPending}
                              onClick={() => {
                                setEditingId(product.id);
                                setCreating(false);
                                setError(null);
                              }}
                              className="rounded-lg px-2.5 py-1 text-[var(--color-muted)] transition-colors hover:text-[var(--color-ink)] disabled:opacity-50"
                            >
                              Editar
                            </button>
                            {product.active ? (
                              <button
                                type="button"
                                disabled={isPending}
                                onClick={() => run(() => deleteProduct(product.id))}
                                className="rounded-lg px-2.5 py-1 text-[var(--color-muted)] transition-colors hover:text-[var(--color-danger)] disabled:opacity-50"
                              >
                                Quitar
                              </button>
                            ) : (
                              <button
                                type="button"
                                disabled={isPending}
                                onClick={() =>
                                  run(() => reactivateProduct(product.id))
                                }
                                className="rounded-lg px-2.5 py-1 text-[var(--color-muted)] transition-colors hover:text-[var(--color-free)] disabled:opacity-50"
                              >
                                Reactivar
                              </button>
                            )}
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-3 grid gap-1 text-xs text-[var(--color-muted)]">
        <p>
          Al quitar un producto que ya se vendió, no se borra: queda fuera de
          venta para no romper el histórico de cuentas.
        </p>
        <p>
          Lo que esté marcado como <strong>mostrar en la carta</strong> aparece
          en el QR de las mesas con su precio y su descripción. La misma carta
          va a alimentar el sitio web: se cambia acá y cambia en los dos lados.
        </p>
        <p>
          La <strong>estación</strong> decide a qué pantalla va la comanda.
          «Sin comanda» es para lo que se cobra sin que nadie lo prepare, como la
          hora de pool. Cambiarla no mueve las comandas que ya están en curso.
        </p>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------

function ProductForm({
  product,
  disabled,
  onSubmit,
  onCancel,
  submitLabel,
}: {
  product?: Product;
  disabled: boolean;
  onSubmit: (formData: FormData) => void;
  onCancel: () => void;
  submitLabel: string;
}) {
  return (
    <form
      action={onSubmit}
      className="flex flex-wrap items-end gap-3"
    >
      <label className="grid flex-1 gap-1 min-w-40">
        <span className="text-xs text-[var(--color-muted)]">Nombre</span>
        <input
          name="name"
          defaultValue={product?.name}
          required
          autoFocus
          className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
        />
      </label>

      <label className="grid gap-1">
        <span className="text-xs text-[var(--color-muted)]">Categoría</span>
        <select
          name="category"
          defaultValue={product?.category ?? "bebida"}
          className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
      </label>

      <label className="grid gap-1">
        <span className="text-xs text-[var(--color-muted)]">Estación</span>
        <select
          name="station"
          defaultValue={product?.station ?? "barra"}
          className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
        >
          {STATIONS.map((st) => (
            <option key={st} value={st}>
              {STATION_LABELS[st]}
            </option>
          ))}
        </select>
      </label>

      <label className="grid w-28 gap-1">
        <span className="text-xs text-[var(--color-muted)]">Precio venta</span>
        <input
          name="price"
          type="number"
          min="0"
          step="0.01"
          defaultValue={product?.price ?? ""}
          required
          className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-sm tabular-nums outline-none focus:border-[var(--color-accent)]"
        />
      </label>

      <label className="grid w-28 gap-1">
        <span className="text-xs text-[var(--color-muted)]">Costo</span>
        <input
          name="cost"
          type="number"
          min="0"
          step="0.01"
          defaultValue={product?.cost ?? 0}
          className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-sm tabular-nums outline-none focus:border-[var(--color-accent)]"
        />
      </label>

      <label className="grid w-full gap-1">
        <span className="text-xs text-[var(--color-muted)]">
          Descripción para la carta (opcional)
        </span>
        <input
          name="description"
          defaultValue={product?.description ?? ""}
          placeholder="Gin, campari, vermouth rosso"
          className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
        />
      </label>

      <label className="flex items-center gap-2 pb-2">
        <input
          type="checkbox"
          name="in_menu"
          defaultChecked={product?.in_menu ?? true}
          className="size-4 accent-[var(--color-accent)]"
        />
        <span className="text-sm">Mostrar en la carta</span>
      </label>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-muted)]"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={disabled}
          className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-[#04121c] disabled:opacity-50"
        >
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
