import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { signOut } from "../login/actions";
import { RedoxFlask } from "../_components/brand";

/**
 * Chrome mínimo para las pantallas de estación.
 *
 * No cuelga de /admin a propósito: el monitor de la barra y el de la cocina
 * están para mostrar comandas y nada más. La barra de alertas del salón y la
 * navegación del panel serían ruido en una pantalla que se mira de lejos y
 * a la que nadie le presta atención hasta que algo cambia.
 */
export default async function EstacionLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await requireStaff();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center gap-3 border-b border-[var(--color-border)] px-4 py-2">
        <RedoxFlask size={20} />
        <Link
          href="/estacion"
          className="text-sm text-[var(--color-muted)] transition-colors hover:text-[var(--color-ink)]"
        >
          Estaciones
        </Link>
        <Link
          href="/admin"
          className="text-sm text-[var(--color-muted)] transition-colors hover:text-[var(--color-ink)]"
        >
          Salón
        </Link>
        <span className="ml-auto text-sm text-[var(--color-muted)]">
          {profile.full_name}
        </span>
        <form action={signOut}>
          <button
            type="submit"
            className="rounded-lg border border-[var(--color-border)] px-2.5 py-1 text-sm text-[var(--color-muted)] transition-colors hover:border-[var(--color-danger)] hover:text-[var(--color-danger)]"
          >
            Salir
          </button>
        </form>
      </header>

      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
