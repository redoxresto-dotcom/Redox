import Link from "next/link";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { signOut } from "../login/actions";
import { RedoxFlask } from "../_components/brand";
import { atiendeBarra, homeFor, ROLE_LABELS } from "@/lib/types";

export default async function BarraLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await requireStaff();

  // La pantalla de ventas de barra es para el rol barra (y para admin/gerente
  // que quieran usarla). El resto, a su pantalla.
  if (!atiendeBarra(profile.role)) redirect(homeFor(profile.role));

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <header className="sticky top-0 z-20 flex flex-wrap items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-bg)]/95 px-4 py-3 backdrop-blur">
        <Link href="/barra" className="flex items-center gap-2">
          <RedoxFlask size={24} />
          <span className="text-lg font-semibold tracking-tight">Barra</span>
        </Link>

        <Link
          href="/estacion/barra"
          className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm whitespace-nowrap text-[var(--color-muted)] transition-colors hover:text-[var(--color-ink)]"
        >
          Comandas ↗
        </Link>

        <div className="ml-auto flex items-center gap-3">
          <span className="text-sm text-[var(--color-muted)]">
            {profile.full_name}
            <span className="ml-1.5 text-xs">{ROLE_LABELS[profile.role]}</span>
          </span>
          <form action={signOut}>
            <button
              type="submit"
              className="rounded-lg px-2.5 py-1.5 text-sm text-[var(--color-muted)] transition-colors hover:text-[var(--color-danger)]"
            >
              Salir
            </button>
          </form>
        </div>
      </header>

      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
