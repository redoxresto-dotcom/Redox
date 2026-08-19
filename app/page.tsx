import Link from "next/link";
import { PoweredBy, RedoxLogo } from "./_components/brand";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-8 px-6 py-16">
      <div>
        <RedoxLogo width={280} />
        <p className="mt-4 text-[var(--color-muted)]">
          Gestión de salón, barra y cocina.
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

      <PoweredBy />
    </main>
  );
}
