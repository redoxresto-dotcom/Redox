import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-8 px-6 py-16">
      <div>
        <p className="text-sm font-medium tracking-widest text-[var(--color-accent)] uppercase">
          Punta Carretas
        </p>
        <h1 className="mt-2 text-4xl font-semibold">POS Venta</h1>
        <p className="mt-3 text-[var(--color-muted)]">
          Punto de venta y gestión de salón.
        </p>
      </div>

      <div className="grid gap-3">
        <Link
          href="/admin"
          className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-4 transition-colors hover:border-[var(--color-accent)]"
        >
          <span className="block font-medium">Panel de salón</span>
          <span className="block text-sm text-[var(--color-muted)]">
            Mesas, alertas y cobro
          </span>
        </Link>

        <Link
          href="/admin/catalogo"
          className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-5 py-4 transition-colors hover:border-[var(--color-accent)]"
        >
          <span className="block font-medium">Catálogo</span>
          <span className="block text-sm text-[var(--color-muted)]">
            Productos, precios y costos
          </span>
        </Link>
      </div>
    </main>
  );
}
