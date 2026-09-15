import Link from "next/link";
import { PoweredBy, RedoxLogo } from "./_components/brand";

export default function Home() {
  return (
    <main className="relative mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-8 px-6 py-16">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
      >
        <div className="absolute -top-32 -left-32 size-[28rem] rounded-full bg-[var(--color-brand)]/20 blur-[110px]" />
        <div className="absolute right-0 bottom-0 size-[26rem] rounded-full bg-[var(--color-accent)]/15 blur-[110px]" />
      </div>

      <div className="flex flex-col items-center text-center">
        <RedoxLogo width={320} />
        <p className="mt-2 text-[var(--color-muted)]">
          Gestión de salón, barra y cocina.
        </p>
        <p className="mt-1 text-[11px] tracking-[0.24em] text-[var(--color-muted)] uppercase">
          Punta Carretas
        </p>
      </div>

      <div className="grid gap-3">
        <Link
          href="/admin"
          className="rounded-xl bg-white/5 px-5 py-4 shadow-lg shadow-black/20 backdrop-blur-xl transition-colors hover:bg-white/10"
        >
          <span className="block font-medium">Panel de salón</span>
          <span className="block text-sm text-[var(--color-muted)]">
            Mesas, alertas y cobro
          </span>
        </Link>

        <Link
          href="/admin/catalogo"
          className="rounded-xl bg-white/5 px-5 py-4 shadow-lg shadow-black/20 backdrop-blur-xl transition-colors hover:bg-white/10"
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
