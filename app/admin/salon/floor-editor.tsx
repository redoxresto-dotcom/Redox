"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useRouter } from "next/navigation";
import { FloorTable } from "../_components/floor-table";
import {
  createSector,
  createTable,
  deleteSector,
  deleteTable,
  renameSector,
  saveLayout,
  type LayoutInput,
} from "./actions";
import { CANVAS_H, CANVAS_W, GRID, clamp, fitScale, snap } from "@/lib/floor";
import {
  SHAPE_LABELS,
  TABLE_SHAPES,
  type BarTable,
  type Sector,
  type TableShape,
} from "@/lib/types";

type Props = {
  sectors: Sector[];
  tables: BarTable[];
  /** Mesas con cuenta abierta: no conviene moverlas con gente sentada. */
  ocupadas: string[];
};

type Drag = {
  id: string;
  startX: number;
  startY: number;
  origX: number;
  origY: number;
  moved: boolean;
};

export function FloorEditor({ sectors, tables, ocupadas }: Props) {
  const router = useRouter();
  const [sectorId, setSectorId] = useState<string | null>(
    sectors[0]?.id ?? null,
  );
  const [layout, setLayout] = useState<BarTable[]>(tables);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [nuevoSector, setNuevoSector] = useState(false);
  const [isPending, startTransition] = useTransition();

  const dragRef = useRef<Drag | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  const ocupadasSet = useMemo(() => new Set(ocupadas), [ocupadas]);

  // El servidor manda la verdad salvo que haya cambios sin guardar: pisarlos
  // con una revalidación sería perder el trabajo del encargado.
  useEffect(() => {
    if (dirty.size === 0) setLayout(tables);
  }, [tables, dirty]);

  // El plano se guarda en unidades fijas y cada pantalla lo escala a su ancho.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;

    const ro = new ResizeObserver(([entry]) => {
      setScale(fitScale(entry.contentRect.width));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Cerrar la pestaña con el plano a medio mover no debería ser gratis.
  useEffect(() => {
    if (dirty.size === 0) return;
    function avisar(e: BeforeUnloadEvent) {
      e.preventDefault();
    }
    window.addEventListener("beforeunload", avisar);
    return () => window.removeEventListener("beforeunload", avisar);
  }, [dirty]);

  const visibles = layout.filter((t) => t.sector_id === sectorId);
  const selected = layout.find((t) => t.id === selectedId) ?? null;
  const numeroRepetido =
    selected !== null &&
    layout.some((t) => t.id !== selected.id && t.number === selected.number);

  const patch = useCallback((id: string, cambios: Partial<BarTable>) => {
    setLayout((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...cambios } : t)),
    );
    setDirty((prev) => new Set(prev).add(id));
  }, []);

  // Mover con las flechas: para el ajuste fino que el mouse no da.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!selectedId) return;
      const target = e.target as HTMLElement;
      if (["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) return;

      const paso = e.shiftKey ? GRID * 5 : GRID;
      const mov: Record<string, [number, number]> = {
        ArrowLeft: [-paso, 0],
        ArrowRight: [paso, 0],
        ArrowUp: [0, -paso],
        ArrowDown: [0, paso],
      };
      const delta = mov[e.key];
      if (!delta) return;

      e.preventDefault();
      const t = layout.find((x) => x.id === selectedId);
      if (!t) return;

      patch(selectedId, {
        pos_x: clamp(t.pos_x + delta[0], 0, CANVAS_W),
        pos_y: clamp(t.pos_y + delta[1], 0, CANVAS_H),
      });
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, layout, patch]);

  function run(
    fn: () => Promise<{ error: string | null }>,
    onDone?: () => void,
  ) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (result.error) setError(result.error);
      else onDone?.();
    });
  }

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>, t: BarTable) {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      id: t.id,
      startX: e.clientX,
      startY: e.clientY,
      origX: t.pos_x,
      origY: t.pos_y,
      moved: false,
    };
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const d = dragRef.current;
    if (!d) return;

    // El puntero se mueve en píxeles de pantalla; el plano está en sus propias
    // unidades. Sin dividir por la escala, la mesa se va más rápido que el dedo.
    const dx = (e.clientX - d.startX) / scale;
    const dy = (e.clientY - d.startY) / scale;

    if (!d.moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
    d.moved = true;

    patch(d.id, {
      pos_x: clamp(snap(d.origX + dx), 0, CANVAS_W),
      pos_y: clamp(snap(d.origY + dy), 0, CANVAS_H),
    });
  }

  function onPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;

    e.currentTarget.releasePointerCapture(e.pointerId);
    // Un toque sin arrastre es una selección, no un movimiento.
    if (!d.moved) setSelectedId(d.id);
  }

  function guardar() {
    const cambios: LayoutInput[] = layout
      .filter((t) => dirty.has(t.id))
      .map((t) => ({
        id: t.id,
        number: t.number,
        sector_id: t.sector_id,
        pos_x: t.pos_x,
        pos_y: t.pos_y,
        shape: t.shape,
        width: t.width,
        height: t.height,
        rotation: t.rotation,
        seats: t.seats,
        name: t.name,
      }));

    run(
      () => saveLayout(cambios),
      () => {
        setDirty(new Set());
        router.refresh();
      },
    );
  }

  function descartar() {
    setLayout(tables);
    setDirty(new Set());
    setError(null);
  }

  function agregarMesa() {
    const siguiente = Math.max(0, ...layout.map((t) => t.number)) + 1;
    run(
      () => createTable(siguiente, sectorId, 120, 120),
      () => router.refresh(),
    );
  }

  const sectorActual = sectors.find((s) => s.id === sectorId) ?? null;

  return (
    <main className="mx-auto max-w-7xl px-4 py-6">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Plano del salón</h1>
          <p className="text-sm text-[var(--color-muted)]">
            Arrastrá cada mesa al lugar donde está físicamente. Con la mesa
            elegida, las flechas la mueven de a poco.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {dirty.size > 0 ? (
            <>
              <span className="text-sm text-[var(--color-busy)]">
                {dirty.size} mesa{dirty.size === 1 ? "" : "s"} sin guardar
              </span>
              <button
                type="button"
                onClick={descartar}
                disabled={isPending}
                className="rounded-lg bg-white/5 px-3 py-2 text-sm text-[var(--color-muted)] backdrop-blur-md transition-colors hover:bg-white/10 disabled:opacity-50"
              >
                Descartar
              </button>
            </>
          ) : null}
          <button
            type="button"
            onClick={guardar}
            disabled={isPending || dirty.size === 0}
            className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-[#04121c] disabled:opacity-40"
          >
            {isPending ? "Guardando…" : "Guardar plano"}
          </button>
        </div>
      </header>

      {error ? (
        <p
          role="alert"
          className="mb-4 rounded-lg bg-[var(--color-danger)]/15 px-3 py-2 text-sm text-[var(--color-danger)] backdrop-blur-md"
        >
          {error}
        </p>
      ) : null}

      {/* Sectores */}
      <div className="mb-3 flex flex-wrap items-center gap-1 border-b border-white/10 pb-2">
        {sectors.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => {
              setSectorId(s.id);
              setSelectedId(null);
            }}
            className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
              s.id === sectorId
                ? "bg-[var(--color-surface-2)] text-[var(--color-ink)]"
                : "text-[var(--color-muted)] hover:text-[var(--color-ink)]"
            }`}
          >
            {s.name}
            <span className="ml-1.5 text-xs text-[var(--color-muted)]">
              {layout.filter((t) => t.sector_id === s.id).length}
            </span>
          </button>
        ))}

        {nuevoSector ? (
          <form
            action={(fd) =>
              run(
                () => createSector(fd),
                () => setNuevoSector(false),
              )
            }
            className="flex items-center gap-1"
          >
            <input
              name="name"
              required
              autoFocus
              placeholder="Nombre del sector"
              className="w-40 rounded-lg bg-white/5 px-2.5 py-1.5 text-sm shadow-inner shadow-black/20 backdrop-blur-md outline-none focus:bg-white/10"
            />
            <button
              type="submit"
              disabled={isPending}
              className="rounded-lg bg-[var(--color-accent)] px-2.5 py-1.5 text-sm font-semibold text-[#04121c] disabled:opacity-50"
            >
              Crear
            </button>
            <button
              type="button"
              onClick={() => setNuevoSector(false)}
              className="px-2 py-1.5 text-sm text-[var(--color-muted)]"
            >
              ✕
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setNuevoSector(true)}
            className="rounded-lg px-3 py-1.5 text-sm text-[var(--color-accent)] hover:bg-white/10"
          >
            + Sector
          </button>
        )}

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={agregarMesa}
            disabled={isPending || !sectorId}
            className="rounded-lg bg-white/5 px-3 py-1.5 text-sm backdrop-blur-md transition-colors hover:bg-white/10 disabled:opacity-40"
          >
            + Mesa
          </button>
        </div>
      </div>

      {/*
        minmax(0,1fr) y no 1fr a secas: un "1fr" solo vale "minmax(auto, 1fr)",
        así que esa columna no se achica más allá del contenido del plano
        (que puede ser mucho más ancho que la pantalla). Chrome lo dejaba
        pasar igual; Firefox lo respeta al pie de la letra y terminaba
        estirando esa columna, empujando el panel de la mesa fuera de su
        lugar (o superpuesto con el plano). min-w-0 en los dos hijos es el
        mismo seguro por si algún nieto vuelve a traer un ancho intrínseco
        grande.
      */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        {/* Plano */}
        <div
          ref={wrapRef}
          // El escalado es una transformación: no encoge la caja. Sin fijarle
          // la altura, el plano deja un hueco enorme debajo.
          //
          // contain: paint le exige al navegador recortar TODO lo de adentro
          // al borde de esta caja, transform incluido. Sin esto, Firefox deja
          // que la mesa transformada (scale) se pinte un poco más allá del
          // borde redondeado durante el primer render (antes de que el
          // ResizeObserver ajuste la escala), y esa franja quedaba asomando
          // por debajo del panel de la derecha.
          style={{ height: CANVAS_H * scale, contain: "paint" }}
          className="min-w-0 overflow-x-auto rounded-2xl bg-white/5 backdrop-blur-xl"
        >
          {/* Caja con la medida ya escalada: el transform no encoge el div en
              el layout, y sin esto sobra plano para desplazar al costado. */}
          <div style={{ width: CANVAS_W * scale, height: CANVAS_H * scale }}>
            <div
              onPointerDown={(e) => {
                // Un clic en el vacío deselecciona.
                if (e.target === e.currentTarget) setSelectedId(null);
              }}
              className="relative origin-top-left"
              style={{
                width: CANVAS_W,
                height: CANVAS_H,
                transform: `scale(${scale})`,
                backgroundImage:
                  "linear-gradient(var(--color-border) 1px, transparent 1px), linear-gradient(90deg, var(--color-border) 1px, transparent 1px)",
                backgroundSize: `${GRID * 5}px ${GRID * 5}px`,
                backgroundPosition: "0 0",
                opacity: 1,
              }}
            >
              {visibles.map((t) => {
                const ocupada = ocupadasSet.has(t.id);
                return (
                  <FloorTable
                    key={t.id}
                    table={t}
                    selected={t.id === selectedId}
                    label={`Mesa ${t.number}`}
                    title={ocupada ? "Mesa con cuenta abierta" : undefined}
                    className={`cursor-grab backdrop-blur-xl active:cursor-grabbing ${
                      ocupada
                        ? "border-[var(--color-busy)] bg-[var(--color-busy)]/20 text-[var(--color-busy)]"
                        : "border-transparent bg-white/10 text-[var(--color-ink)]"
                    }`}
                    onPointerDown={(e) => onPointerDown(e, t)}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                  >
                    <span className="text-lg font-bold tabular-nums">
                      {t.number}
                    </span>
                    {t.name ? (
                      <span className="max-w-full truncate text-[10px] font-semibold">
                        {t.name}
                      </span>
                    ) : null}
                    <span className="text-xs text-[var(--color-muted)]">
                      {t.seats} 🪑
                    </span>
                  </FloorTable>
                );
              })}
            </div>
          </div>
        </div>

        {/* Panel de la mesa elegida */}
        <aside className="min-w-0 rounded-2xl bg-white/5 p-4 shadow-lg shadow-black/10 backdrop-blur-xl">
          {selected === null ? (
            <div className="grid gap-3">
              <p className="text-sm text-[var(--color-muted)]">
                Elegí una mesa del plano para cambiarle la forma, el tamaño, las
                sillas o el sector.
              </p>

              {sectorActual ? (
                <div className="border-t border-white/10 pt-3">
                  <label className="grid gap-1">
                    <span className="text-xs text-[var(--color-muted)]">
                      Nombre del sector
                    </span>
                    <input
                      key={sectorActual.id}
                      defaultValue={sectorActual.name}
                      onBlur={(e) => {
                        const valor = e.target.value.trim();
                        if (valor && valor !== sectorActual.name) {
                          run(() => renameSector(sectorActual.id, valor));
                        }
                      }}
                      className="rounded-lg bg-white/5 px-3 py-2 text-sm shadow-inner shadow-black/20 backdrop-blur-md outline-none focus:bg-white/10"
                    />
                  </label>

                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() =>
                      run(
                        () => deleteSector(sectorActual.id),
                        () => {
                          setSectorId(
                            sectors.find((s) => s.id !== sectorActual.id)?.id ??
                              null,
                          );
                          router.refresh();
                        },
                      )
                    }
                    className="mt-3 w-full rounded-lg bg-white/5 px-3 py-2 text-sm text-[var(--color-muted)] backdrop-blur-md transition-colors hover:bg-[var(--color-danger)]/15 hover:text-[var(--color-danger)] disabled:opacity-50"
                  >
                    Borrar sector
                  </button>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="grid gap-3">
              <div className="flex items-baseline justify-between">
                <h2 className="text-lg font-semibold">
                  Mesa {selected.number}
                </h2>
                <button
                  type="button"
                  onClick={() => setSelectedId(null)}
                  className="text-sm text-[var(--color-muted)] hover:text-[var(--color-ink)]"
                >
                  ✕
                </button>
              </div>

              <label className="grid gap-1">
                <span className="text-xs text-[var(--color-muted)]">
                  Número de mesa
                </span>
                <input
                  key={`${selected.id}-number`}
                  type="number"
                  min={1}
                  step={1}
                  defaultValue={selected.number}
                  onBlur={(e) => {
                    const n = Math.max(1, Math.round(Number(e.target.value)));
                    patch(selected.id, { number: n || selected.number });
                  }}
                  className="rounded-lg bg-white/5 px-3 py-2 text-sm tabular-nums shadow-inner shadow-black/20 backdrop-blur-md outline-none focus:bg-white/10"
                />
                {numeroRepetido ? (
                  <span className="text-xs text-[var(--color-danger)]">
                    Ya hay otra mesa con el número {selected.number}.
                  </span>
                ) : null}
              </label>

              <label className="grid gap-1">
                <span className="text-xs text-[var(--color-muted)]">
                  Nombre (opcional)
                </span>
                <input
                  key={selected.id}
                  type="text"
                  maxLength={40}
                  defaultValue={selected.name ?? ""}
                  placeholder={`Mesa ${selected.number}`}
                  onBlur={(e) =>
                    patch(selected.id, { name: e.target.value.trim() || null })
                  }
                  className="rounded-lg bg-white/5 px-3 py-2 text-sm shadow-inner shadow-black/20 backdrop-blur-md outline-none focus:bg-white/10"
                />
              </label>

              <label className="grid gap-1">
                <span className="text-xs text-[var(--color-muted)]">Forma</span>
                <select
                  value={selected.shape}
                  onChange={(e) => {
                    const shape = e.target.value as TableShape;
                    // Redonda y cuadrada son de un solo tamaño: si el alto y el
                    // ancho quedan distintos, la mesa sale ovalada sin querer.
                    patch(selected.id, {
                      shape,
                      height:
                        shape === "rectangular"
                          ? selected.height
                          : selected.width,
                    });
                  }}
                  className="rounded-lg bg-white/5 px-3 py-2 text-sm shadow-inner shadow-black/20 backdrop-blur-md outline-none focus:bg-white/10"
                >
                  {TABLE_SHAPES.map((s) => (
                    <option key={s} value={s}>
                      {SHAPE_LABELS[s]}
                    </option>
                  ))}
                </select>
              </label>

              <div className="grid min-w-0 grid-cols-2 gap-2">
                <label className="grid min-w-0 gap-1">
                  <span className="text-xs text-[var(--color-muted)]">
                    Ancho
                  </span>
                  <input
                    type="number"
                    min={40}
                    max={600}
                    step={10}
                    value={selected.width}
                    onChange={(e) => {
                      const width = clamp(
                        Number(e.target.value) || 40,
                        40,
                        600,
                      );
                      patch(selected.id, {
                        width,
                        height:
                          selected.shape === "rectangular"
                            ? selected.height
                            : width,
                      });
                    }}
                    className="rounded-lg bg-white/5 px-3 py-2 text-sm tabular-nums shadow-inner shadow-black/20 backdrop-blur-md outline-none focus:bg-white/10"
                  />
                </label>
                <label className="grid min-w-0 gap-1">
                  <span className="text-xs text-[var(--color-muted)]">
                    Alto
                  </span>
                  <input
                    type="number"
                    min={40}
                    max={600}
                    step={10}
                    disabled={selected.shape !== "rectangular"}
                    value={selected.height}
                    onChange={(e) =>
                      patch(selected.id, {
                        height: clamp(Number(e.target.value) || 40, 40, 600),
                      })
                    }
                    className="rounded-lg bg-white/5 px-3 py-2 text-sm tabular-nums shadow-inner shadow-black/20 backdrop-blur-md outline-none focus:bg-white/10 disabled:opacity-40"
                  />
                </label>
              </div>

              <label className="grid gap-1">
                <span className="text-xs text-[var(--color-muted)]">
                  Sillas: {selected.seats}
                </span>
                <input
                  type="range"
                  min={0}
                  max={20}
                  value={selected.seats}
                  onChange={(e) =>
                    patch(selected.id, { seats: Number(e.target.value) })
                  }
                  className="accent-[var(--color-accent)]"
                />
              </label>

              <div className="grid gap-1">
                <span className="text-xs text-[var(--color-muted)]">
                  Rotación: {selected.rotation}°
                </span>
                <input
                  type="range"
                  min={0}
                  max={355}
                  step={5}
                  value={selected.rotation}
                  onChange={(e) =>
                    patch(selected.id, { rotation: Number(e.target.value) })
                  }
                  className="accent-[var(--color-accent)]"
                />
                <div className="flex gap-1">
                  {[0, 90, 180, 270].map((deg) => (
                    <button
                      key={deg}
                      type="button"
                      onClick={() => patch(selected.id, { rotation: deg })}
                      className={`flex-1 rounded-lg px-2 py-1 text-xs backdrop-blur-md ${
                        selected.rotation === deg
                          ? "bg-[var(--color-accent)]/15 text-[var(--color-accent)]"
                          : "bg-white/5 text-[var(--color-muted)]"
                      }`}
                    >
                      {deg}°
                    </button>
                  ))}
                </div>
              </div>

              <label className="grid gap-1">
                <span className="text-xs text-[var(--color-muted)]">
                  Sector
                </span>
                <select
                  value={selected.sector_id ?? ""}
                  onChange={(e) =>
                    patch(selected.id, { sector_id: e.target.value || null })
                  }
                  className="rounded-lg bg-white/5 px-3 py-2 text-sm shadow-inner shadow-black/20 backdrop-blur-md outline-none focus:bg-white/10"
                >
                  {sectors.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>

              <button
                type="button"
                disabled={isPending}
                onClick={() =>
                  run(
                    () => deleteTable(selected.id),
                    () => {
                      setSelectedId(null);
                      router.refresh();
                    },
                  )
                }
                className="mt-1 rounded-lg bg-white/5 px-3 py-2 text-sm text-[var(--color-muted)] backdrop-blur-md transition-colors hover:bg-[var(--color-danger)]/15 hover:text-[var(--color-danger)] disabled:opacity-50"
              >
                Quitar mesa
              </button>
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}
