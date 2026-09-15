"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ChangeEvent,
} from "react";
import {
  createProduct,
  deleteProduct,
  reactivateProduct,
  updateProduct,
} from "./actions";
import { ImportPanel } from "./import-panel";
import {
  CATEGORY_LABELS,
  comboUltimoDia,
  comboVigente,
  formatMoney,
  hoyMontevideo,
  STATION_LABELS,
  type ComboComponent,
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

export function CatalogManager({
  products,
  comboItems,
}: {
  products: Product[];
  /** id de combo → sus componentes con cantidad. */
  comboItems: Record<string, ComboComponent[]>;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [isPending, startTransition] = useTransition();
  const editPanelRef = useRef<HTMLDivElement>(null);

  const hoy = hoyMontevideo();
  const editingProduct = products.find((p) => p.id === editingId) ?? null;

  // El panel de edición vive arriba de la tabla, no en la fila: si la lista
  // es larga y la mesa está lejos del tope, tocar "Editar" igual lo muestra.
  useEffect(() => {
    if (editingId) editPanelRef.current?.scrollIntoView({ block: "nearest" });
  }, [editingId]);

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
    <main className="relative mx-auto max-w-5xl px-4 py-6">
      {/*
        Prueba de glassmorfismo: sin estas manchas de color detrás, los
        paneles translúcidos + blur solo se ven como cajas grises apagadas.
        Fixed y detrás de todo (-z-10): solo se nota este experimento
        mientras se está viendo el Catálogo, no pisa el resto del admin.
      */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
      >
        <div className="absolute -top-32 -left-32 size-[28rem] rounded-full bg-[var(--color-accent)]/20 blur-[110px]" />
        <div className="absolute top-1/4 -right-40 size-[26rem] rounded-full bg-[var(--color-brand)]/25 blur-[110px]" />
        <div className="absolute bottom-0 left-1/3 size-[24rem] rounded-full bg-[var(--color-free)]/10 blur-[110px]" />
      </div>

      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black tracking-tight uppercase">
            Catálogo
          </h1>
          <p className="text-xs font-medium tracking-[0.2em] text-[var(--color-muted)] uppercase">
            {activos.length} producto{activos.length === 1 ? "" : "s"} en venta ·
            margen promedio {margenPromedio.toFixed(0)}%
          </p>
        </div>

        <div className="flex items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar…"
            className="w-36 rounded-lg bg-white/5 px-3 py-2 text-sm shadow-inner shadow-black/20 backdrop-blur-md outline-none placeholder:text-[var(--color-muted)] focus:bg-white/10"
          />
          <button
            type="button"
            onClick={() => {
              setImporting((v) => !v);
              setCreating(false);
              setEditingId(null);
              setError(null);
            }}
            className="rounded-lg bg-white/5 px-4 py-2 text-sm text-[var(--color-muted)] backdrop-blur-md transition-colors hover:bg-white/10 hover:text-[var(--color-ink)]"
          >
            {importing ? "Cerrar" : "Importar CSV"}
          </button>
          <button
            type="button"
            onClick={() => {
              setCreating((c) => !c);
              setImporting(false);
              setEditingId(null);
              setError(null);
            }}
            className="rounded-lg bg-[var(--color-accent)]/90 px-4 py-2 text-sm font-semibold text-[#04121c] shadow-lg shadow-[var(--color-accent)]/20 backdrop-blur-md transition-colors hover:bg-[var(--color-accent)]"
          >
            {creating ? "Cancelar" : "+ Producto"}
          </button>
        </div>
      </header>

      {importing ? <ImportPanel onDone={() => setImporting(false)} /> : null}

      {error ? (
        <p
          role="alert"
          className="mb-4 rounded-lg border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-3 py-2 text-sm text-[var(--color-danger)]"
        >
          {error}
        </p>
      ) : null}

      {creating ? (
        <div className="mb-4 rounded-xl border border-white/10 bg-[var(--color-surface)]/40 p-4 shadow-xl shadow-black/30 backdrop-blur-xl">
          <ProductForm
            products={products}
            disabled={isPending}
            onSubmit={(formData) =>
              run(() => createProduct(formData), () => setCreating(false))
            }
            onCancel={() => setCreating(false)}
            submitLabel="Agregar"
          />
        </div>
      ) : null}

      {editingProduct ? (
        <div
          ref={editPanelRef}
          className="mb-4 rounded-xl border border-white/10 bg-[var(--color-surface)]/40 p-4 shadow-xl shadow-black/30 backdrop-blur-xl"
        >
          <p className="mb-3 text-xs font-semibold tracking-wide text-[var(--color-muted)] uppercase">
            Editando «{editingProduct.name}»
          </p>
          <ProductForm
            product={editingProduct}
            products={products}
            comboItems={comboItems[editingProduct.id]}
            disabled={isPending}
            onSubmit={(formData) =>
              run(
                () => updateProduct(editingProduct.id, formData),
                () => setEditingId(null)
              )
            }
            onCancel={() => setEditingId(null)}
            submitLabel="Guardar"
          />
        </div>
      ) : null}

      {/*
        table-fixed + anchos en % para que las 8 columnas siempre entren en el
        ancho disponible: con table-layout auto (el default), el navegador le
        daba a cada columna lo que su contenido más ancho pedía y la suma se
        pasaba de la pantalla, obligando a scrollear para llegar a "Quitar".
        Acá el contenido angosto (precios, badges) se corta con truncate en
        vez de estirar la tabla.
      */}
      <div className="overflow-x-auto rounded-xl border border-white/10 bg-[var(--color-surface)]/30 shadow-xl shadow-black/20 backdrop-blur-xl">
        <table className="w-full table-fixed text-sm">
          <thead className="bg-white/5 text-left text-xs tracking-wide text-[var(--color-muted)] uppercase backdrop-blur-md">
            <tr>
              <th className="w-[21%] truncate px-3 py-2.5 font-medium">Producto</th>
              <th className="w-[9%] truncate px-3 py-2.5 font-medium">Categoría</th>
              <th className="w-[11%] truncate px-3 py-2.5 font-medium">Estación</th>
              <th className="w-[7%] truncate px-3 py-2.5 font-medium">Carta</th>
              <th className="w-[9%] truncate px-3 py-2.5 text-right font-medium">Venta</th>
              <th className="w-[9%] truncate px-3 py-2.5 text-right font-medium">Costo</th>
              <th className="w-[9%] truncate px-3 py-2.5 text-right font-medium">Margen</th>
              <th className="w-[25%] px-3 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="px-3 py-10 text-center text-[var(--color-muted)]"
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
                    className={`border-t border-white/5 ${
                      isEditing
                        ? "bg-[var(--color-accent)]/5"
                        : product.active
                          ? ""
                          : "opacity-45"
                    }`}
                  >
                        <td className="px-3 py-3">
                          <div className="flex items-start gap-2">
                            {product.image_url ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={product.image_url}
                                alt=""
                                className="size-9 shrink-0 rounded-lg object-cover"
                              />
                            ) : null}
                            <div className="min-w-0">
                          {product.name}
                          {product.is_combo ? (
                            <span className="ml-2 rounded bg-[var(--color-accent)]/15 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-[var(--color-accent)] uppercase">
                              combo
                            </span>
                          ) : null}
                          {comboUltimoDia(product, hoy) ? (
                            <span className="ml-2 rounded bg-[var(--color-busy)]/15 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-[var(--color-busy)] uppercase">
                              último día
                            </span>
                          ) : product.is_combo && !comboVigente(product, hoy) ? (
                            <span className="ml-2 rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-[var(--color-muted)] uppercase">
                              vencido
                            </span>
                          ) : null}
                          {!product.active ? (
                            <span className="ml-2 rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[10px] tracking-wide uppercase">
                              fuera de venta
                            </span>
                          ) : null}
                          {product.is_combo && comboItems[product.id] ? (
                            <span className="block max-w-xs truncate text-xs text-[var(--color-muted)]">
                              {comboItems[product.id]
                                .map((item) => {
                                  const nombre = products.find(
                                    (p) => p.id === item.product_id,
                                  )?.name;
                                  return nombre
                                    ? `${item.quantity}× ${nombre}`
                                    : null;
                                })
                                .filter(Boolean)
                                .join(" + ")}
                            </span>
                          ) : product.description ? (
                            <span className="block max-w-xs truncate text-xs text-[var(--color-muted)]">
                              {product.description}
                            </span>
                          ) : null}
                            </div>
                          </div>
                        </td>
                        <td className="truncate px-3 py-3 text-[var(--color-muted)]">
                          {CATEGORY_LABELS[product.category]}
                        </td>
                        <td className="truncate px-3 py-3">
                          <span
                            className={`inline-block max-w-full truncate rounded-full px-2 py-0.5 text-xs ${
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
                        <td className="truncate px-3 py-3">
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
                        <td className="truncate px-3 py-3 text-right tabular-nums">
                          {formatMoney(product.price)}
                        </td>
                        <td className="truncate px-3 py-3 text-right tabular-nums text-[var(--color-muted)]">
                          {formatMoney(product.cost)}
                        </td>
                        <td
                          className={`truncate px-3 py-3 text-right tabular-nums ${
                            m !== null && m < 30
                              ? "text-[var(--color-busy)]"
                              : "text-[var(--color-free)]"
                          }`}
                        >
                          {m === null ? "—" : `${m.toFixed(0)}%`}
                        </td>
                        <td className="px-3 py-3">
                          {/*
                            flex-wrap en vez de nowrap: si "Editar" y "Quitar"
                            no entran en una sola línea, "Quitar" pasa a la de
                            abajo en vez de desbordar por encima de "Margen".
                          */}
                          <div className="flex flex-wrap justify-end gap-x-1 gap-y-0.5">
                            <button
                              type="button"
                              disabled={isPending}
                              onClick={() => {
                                setEditingId(isEditing ? null : product.id);
                                setCreating(false);
                                setError(null);
                              }}
                              className={`rounded-lg px-2 py-1 whitespace-nowrap transition-colors disabled:opacity-50 ${
                                isEditing
                                  ? "text-[var(--color-accent)]"
                                  : "text-[var(--color-muted)] hover:text-[var(--color-ink)]"
                              }`}
                            >
                              {isEditing ? "Editando…" : "Editar"}
                            </button>
                            {product.active ? (
                              <button
                                type="button"
                                disabled={isPending}
                                onClick={() => run(() => deleteProduct(product.id))}
                                className="rounded-lg px-2 py-1 whitespace-nowrap text-[var(--color-muted)] transition-colors hover:text-[var(--color-danger)] disabled:opacity-50"
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
                                className="rounded-lg px-2 py-1 whitespace-nowrap text-[var(--color-muted)] transition-colors hover:text-[var(--color-free)] disabled:opacity-50"
                              >
                                Reactivar
                              </button>
                            )}
                          </div>
                        </td>
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
  products,
  comboItems,
  disabled,
  onSubmit,
  onCancel,
  submitLabel,
}: {
  product?: Product;
  /** Todo el catálogo, para elegir de qué productos se arma el combo. */
  products: Product[];
  /** Componentes actuales, si este producto ya es un combo. */
  comboItems?: ComboComponent[];
  disabled: boolean;
  onSubmit: (formData: FormData) => void;
  onCancel: () => void;
  submitLabel: string;
}) {
  const [isCombo, setIsCombo] = useState(product?.is_combo ?? false);
  const [items, setItems] = useState<ComboComponent[]>(comboItems ?? []);
  const [pickerId, setPickerId] = useState("");
  const [imagePreview, setImagePreview] = useState<string | null>(
    product?.image_url ?? null,
  );
  const [removeImage, setRemoveImage] = useState(false);

  function onImageChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setRemoveImage(false);
    if (!file) {
      setImagePreview(product?.image_url ?? null);
      return;
    }
    // Vista previa local: no hace falta subir nada para ver cómo va a quedar.
    setImagePreview(URL.createObjectURL(file));
  }

  // No se puede meter un combo dentro de otro combo, ni el producto adentro
  // de sí mismo.
  const disponibles = products.filter(
    (p) =>
      p.active &&
      !p.is_combo &&
      p.id !== product?.id &&
      !items.some((i) => i.product_id === p.id),
  );

  function agregarComponente() {
    if (!pickerId) return;
    setItems((prev) => [...prev, { product_id: pickerId, quantity: 1 }]);
    setPickerId("");
  }

  function quitarComponente(productId: string) {
    setItems((prev) => prev.filter((i) => i.product_id !== productId));
  }

  function cambiarCantidad(productId: string, quantity: number) {
    setItems((prev) =>
      prev.map((i) =>
        i.product_id === productId
          ? { ...i, quantity: Math.max(1, Math.round(quantity) || 1) }
          : i,
      ),
    );
  }

  const sugerido = items.reduce((sum, item) => {
    const precio = products.find((p) => p.id === item.product_id)?.price ?? 0;
    return sum + precio * item.quantity;
  }, 0);

  return (
    <form action={onSubmit} className="grid gap-3">
      <div className="flex min-w-0 items-center gap-3">
        {imagePreview && !removeImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imagePreview}
            alt=""
            className="size-16 shrink-0 rounded-xl border border-white/10 object-cover"
          />
        ) : (
          <div className="flex size-16 shrink-0 items-center justify-center rounded-xl border border-dashed border-white/15 text-[10px] text-[var(--color-muted)]">
            Sin foto
          </div>
        )}
        <div className="grid min-w-0 gap-1">
          <label className="text-xs text-[var(--color-muted)]">
            Foto (opcional)
          </label>
          <input
            type="file"
            name="image"
            accept="image/jpeg,image/png,image/webp,image/gif"
            onChange={onImageChange}
            className="max-w-full text-xs text-[var(--color-muted)] file:mr-2 file:rounded-lg file:border-0 file:bg-[var(--color-surface-2)] file:px-2.5 file:py-1.5 file:text-xs file:text-[var(--color-ink)]"
          />
          {product?.image_url ? (
            <label className="flex items-center gap-1.5 text-xs text-[var(--color-muted)]">
              <input
                type="checkbox"
                name="remove_image"
                checked={removeImage}
                onChange={(e) => {
                  setRemoveImage(e.target.checked);
                  setImagePreview(e.target.checked ? null : product.image_url);
                }}
                className="size-3.5 accent-[var(--color-accent)]"
              />
              Quitar la foto actual
            </label>
          ) : null}
        </div>
      </div>

      {/*
        Grid explícito en vez de flex-wrap: con flex, el ancho de "Nombre"
        dependía de cuánto le sobrara a sus vecinos y en pantallas angostas
        terminaba pisando a "Categoría". Con columnas fijas cada campo tiene
        su lugar reservado sin importar el ancho de la pantalla.
      */}
      <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-4">
        <label className="col-span-2 grid min-w-0 gap-1">
          <span className="text-xs text-[var(--color-muted)]">Nombre</span>
          <input
            name="name"
            defaultValue={product?.name}
            required
            autoFocus
            className="w-full min-w-0 rounded-lg bg-white/5 px-3 py-2 text-sm shadow-inner shadow-black/20 backdrop-blur-md outline-none focus:bg-white/10"
          />
        </label>

        <label className="grid min-w-0 gap-1">
          <span className="text-xs text-[var(--color-muted)]">Categoría</span>
          <select
            name="category"
            defaultValue={product?.category ?? "bebida"}
            className="w-full min-w-0 rounded-lg bg-white/5 px-3 py-2 text-sm shadow-inner shadow-black/20 backdrop-blur-md outline-none focus:bg-white/10"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </label>

        <label className="grid min-w-0 gap-1">
          <span className="text-xs text-[var(--color-muted)]">Estación</span>
          <select
            name="station"
            defaultValue={product?.station ?? "barra"}
            className="w-full min-w-0 rounded-lg bg-white/5 px-3 py-2 text-sm shadow-inner shadow-black/20 backdrop-blur-md outline-none focus:bg-white/10"
          >
            {STATIONS.map((st) => (
              <option key={st} value={st}>
                {STATION_LABELS[st]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid min-w-0 grid-cols-2 gap-3 sm:w-64">
        <label className="grid min-w-0 gap-1">
          <span className="text-xs text-[var(--color-muted)]">
            Precio venta
          </span>
          <input
            name="price"
            type="number"
            min="0"
            step="0.01"
            defaultValue={product?.price ?? ""}
            required
            className="w-full min-w-0 rounded-lg bg-white/5 px-3 py-2 text-sm tabular-nums shadow-inner shadow-black/20 backdrop-blur-md outline-none focus:bg-white/10"
          />
        </label>

        <label className="grid min-w-0 gap-1">
          <span className="text-xs text-[var(--color-muted)]">Costo</span>
          <input
            name="cost"
            type="number"
            min="0"
            step="0.01"
            defaultValue={product?.cost ?? 0}
            className="w-full min-w-0 rounded-lg bg-white/5 px-3 py-2 text-sm tabular-nums shadow-inner shadow-black/20 backdrop-blur-md outline-none focus:bg-white/10"
          />
        </label>
      </div>

      <label className="grid w-full gap-1">
        <span className="text-xs text-[var(--color-muted)]">
          Descripción para la carta (opcional)
        </span>
        <input
          name="description"
          defaultValue={product?.description ?? ""}
          placeholder="Gin, campari, vermouth rosso"
          className="rounded-lg bg-white/5 px-3 py-2 text-sm shadow-inner shadow-black/20 backdrop-blur-md outline-none focus:bg-white/10"
        />
      </label>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="in_menu"
            defaultChecked={product?.in_menu ?? true}
            className="size-4 accent-[var(--color-accent)]"
          />
          <span className="text-sm">Mostrar en la carta</span>
        </label>

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="is_combo"
            checked={isCombo}
            onChange={(e) => setIsCombo(e.target.checked)}
            className="size-4 accent-[var(--color-accent)]"
          />
          <span className="text-sm">Es un combo o promoción</span>
        </label>
      </div>

      {isCombo ? (
        <div className="w-full rounded-lg border border-white/10 bg-white/5 p-3 backdrop-blur-md">
          <input type="hidden" name="combo_items" value={JSON.stringify(items)} />

          <div className="mb-3 grid gap-2 sm:grid-cols-2">
            <label className="grid gap-1">
              <span className="text-xs text-[var(--color-muted)]">
                Vigente desde (opcional)
              </span>
              <input
                type="date"
                name="combo_valid_from"
                defaultValue={product?.combo_valid_from ?? ""}
                className="rounded-lg bg-white/5 px-3 py-2 text-sm shadow-inner shadow-black/20 backdrop-blur-md outline-none focus:bg-white/10"
              />
            </label>
            <label className="grid gap-1">
              <span className="text-xs text-[var(--color-muted)]">
                Vigente hasta (opcional)
              </span>
              <input
                type="date"
                name="combo_valid_until"
                defaultValue={product?.combo_valid_until ?? ""}
                className="rounded-lg bg-white/5 px-3 py-2 text-sm shadow-inner shadow-black/20 backdrop-blur-md outline-none focus:bg-white/10"
              />
            </label>
            <p className="text-xs text-[var(--color-muted)] sm:col-span-2">
              Fuera de esas fechas el combo no se ofrece en la mesa ni en la
              carta. El último día aparece un aviso en el tablero.
            </p>
          </div>

          <p className="mb-2 text-xs text-[var(--color-muted)]">
            Qué productos incluye. El precio de venta de arriba es el que paga
            el cliente por todo junto, no se calcula solo.
          </p>

          {items.length > 0 ? (
            <ul className="mb-2 grid gap-1.5">
              {items.map((item) => {
                const producto = products.find(
                  (p) => p.id === item.product_id,
                );
                return (
                  <li
                    key={item.product_id}
                    className="flex items-center gap-2 rounded-lg bg-white/5 px-2 py-1.5 backdrop-blur-md"
                  >
                    <span className="flex-1 truncate text-sm">
                      {producto?.name ?? "Producto"}
                    </span>
                    <input
                      type="number"
                      min="1"
                      value={item.quantity}
                      onChange={(e) =>
                        cambiarCantidad(item.product_id, Number(e.target.value))
                      }
                      className="w-14 rounded-lg bg-white/10 px-2 py-1 text-sm tabular-nums shadow-inner shadow-black/20 outline-none focus:bg-white/15"
                    />
                    <button
                      type="button"
                      onClick={() => quitarComponente(item.product_id)}
                      aria-label={`Quitar ${producto?.name ?? "producto"} del combo`}
                      className="rounded-lg px-1.5 py-1 text-sm text-[var(--color-muted)] transition-colors hover:text-[var(--color-danger)]"
                    >
                      ✕
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}

          <div className="flex items-center gap-2">
            <select
              value={pickerId}
              onChange={(e) => setPickerId(e.target.value)}
              className="flex-1 rounded-lg bg-white/5 px-3 py-2 text-sm shadow-inner shadow-black/20 backdrop-blur-md outline-none focus:bg-white/10"
            >
              <option value="">Elegí un producto…</option>
              {disponibles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={agregarComponente}
              disabled={!pickerId}
              className="rounded-lg bg-white/5 px-3 py-2 text-sm text-[var(--color-muted)] backdrop-blur-md transition-colors hover:bg-white/10 hover:text-[var(--color-accent)] disabled:opacity-50"
            >
              + Agregar
            </button>
          </div>

          {items.length > 0 ? (
            <p className="mt-2 text-xs text-[var(--color-muted)]">
              Suma de esos productos por separado: {formatMoney(sugerido)}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg bg-white/5 px-3 py-2 text-sm text-[var(--color-muted)] backdrop-blur-md transition-colors hover:bg-white/10 hover:text-[var(--color-ink)]"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={disabled}
          className="rounded-lg bg-[var(--color-accent)]/90 px-4 py-2 text-sm font-semibold text-[#04121c] shadow-lg shadow-[var(--color-accent)]/20 backdrop-blur-md transition-colors hover:bg-[var(--color-accent)] disabled:opacity-50"
        >
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
