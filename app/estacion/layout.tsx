import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { signOut } from "../login/actions";
import { RedoxFlask } from "../_components/brand";
import { stationOf } from "@/lib/types";

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

  // Barra y cocina tienen una sola pantalla: no hay dónde navegar. Los links
  // de estaciones y salón son solo para admin/gerente, que abren los monitores.
  const soloSuPantalla = stationOf(profile.role) !== null;

  return (
    <div className="relative flex min-h-screen flex-col">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
      >
        <div className="absolute -top-32 -left-32 size-[28rem] rounded-full bg-[var(--color-accent)]/15 blur-[110px]" />
        <div className="absolute right-0 bottom-0 size-[26rem] rounded-full bg-[var(--color-brand)]/20 blur-[110px]" />
      </div>

      <header className="flex items-center gap-3 bg-white/5 px-4 py-2 backdrop-blur-xl">
        <RedoxFlask size={20} />
        {soloSuPantalla ? (
          profile.role === "barra" ? (
            <Link
              href="/barra"
              className="text-sm text-[var(--color-muted)] transition-colors hover:text-[var(--color-ink)]"
            >
              ← Ventas
            </Link>
          ) : null
        ) : (
          <>
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
          </>
        )}
        <span className="ml-auto text-sm text-[var(--color-muted)]">
          {profile.full_name}
        </span>
        <form action={signOut}>
          <button
            type="submit"
            className="rounded-lg bg-white/5 px-2.5 py-1 text-sm text-[var(--color-muted)] backdrop-blur-md transition-colors hover:bg-[var(--color-danger)]/15 hover:text-[var(--color-danger)]"
          >
            Salir
          </button>
        </form>
      </header>

      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
