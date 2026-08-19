import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { signOut } from "../login/actions";
import { RedoxMark } from "../_components/brand";
import { AlertMonitor } from "./_components/alert-monitor";
import { redirect } from "next/navigation";
import {
  hasRank,
  ROLE_LABELS,
  stationOf,
  type Alert,
  type BarTable,
} from "@/lib/types";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Guard real: aunque el proxy ya filtró, cada render vuelve a validar
  // el usuario y su perfil contra la base.
  const profile = await requireStaff();

  // La barra y la cocina no tienen nada que hacer en el panel: su trabajo son
  // las comandas de todas las mesas. Vale para todo /admin, no solo el salón.
  const station = stationOf(profile.role);
  if (station) redirect(`/estacion/${station}`);

  const supabase = await getSupabaseServerClient();
  const [alertsRes, tablesRes] = await Promise.all([
    supabase
      .from("alerts")
      .select("*")
      .eq("status", "pendiente")
      .order("created_at", { ascending: false }),
    supabase.from("tables").select("id, number"),
  ]);

  const tableNumbers = Object.fromEntries(
    ((tablesRes.data ?? []) as Pick<BarTable, "id" | "number">[]).map((t) => [
      t.id,
      t.number,
    ]),
  );

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-[var(--color-border)] bg-[var(--color-bg)]/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <Link href="/admin" aria-label="Redox">
            <RedoxMark size="sm" />
          </Link>

          {/*
            El mozo ve dos opciones y nada más: el salón para tomar mesas y las
            suyas para atenderlas. Barra y cocina tienen su propio usuario, que
            entra directo a su pantalla; para el mozo son ruido.
          */}
          <nav className="flex flex-wrap items-center gap-1 text-sm">
            <Link
              href="/admin"
              className="rounded-lg px-3 py-1.5 text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface)] hover:text-[var(--color-ink)]"
            >
              Salón
            </Link>
            <Link
              href="/admin/mis-mesas"
              className="rounded-lg px-3 py-1.5 text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface)] hover:text-[var(--color-ink)]"
            >
              Mis mesas
            </Link>
            {hasRank(profile.role, "admin") ? (
              <>
                <Link
                  href="/admin/caja"
                  className="rounded-lg px-3 py-1.5 text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface)] hover:text-[var(--color-ink)]"
                >
                  Caja
                </Link>
                <Link
                  href="/estacion/barra"
                  className="rounded-lg px-3 py-1.5 text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface)] hover:text-[var(--color-ink)]"
                >
                  Barra
                </Link>
                <Link
                  href="/estacion/cocina"
                  className="rounded-lg px-3 py-1.5 text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface)] hover:text-[var(--color-ink)]"
                >
                  Cocina
                </Link>
                <Link
                  href="/admin/catalogo"
                  className="rounded-lg px-3 py-1.5 text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface)] hover:text-[var(--color-ink)]"
                >
                  Catálogo
                </Link>
                <Link
                  href="/admin/salon"
                  className="rounded-lg px-3 py-1.5 text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface)] hover:text-[var(--color-ink)]"
                >
                  Plano
                </Link>
                <Link
                  href="/admin/reportes"
                  className="rounded-lg px-3 py-1.5 text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface)] hover:text-[var(--color-ink)]"
                >
                  Reportes
                </Link>
                {hasRank(profile.role, "gerente") ? (
                  <Link
                    href="/admin/usuarios"
                    className="rounded-lg px-3 py-1.5 text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface)] hover:text-[var(--color-ink)]"
                  >
                    Usuarios
                  </Link>
                ) : null}
                <Link
                  href="/admin/qr"
                  className="rounded-lg px-3 py-1.5 text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface)] hover:text-[var(--color-ink)]"
                >
                  QR
                </Link>
              </>
            ) : null}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-sm text-[var(--color-muted)] sm:inline">
              {profile.full_name}
              {hasRank(profile.role, "admin") ? (
                <span
                  className={`ml-1.5 rounded px-1.5 py-0.5 text-[10px] tracking-wide uppercase ${
                    profile.role === "gerente"
                      ? "bg-[var(--color-accent)]/20 text-[var(--color-accent)]"
                      : "bg-[var(--color-surface-2)]"
                  }`}
                >
                  {ROLE_LABELS[profile.role]}
                </span>
              ) : null}
            </span>
            <form action={signOut}>
              <button
                type="submit"
                className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm text-[var(--color-muted)] transition-colors hover:border-[var(--color-danger)] hover:text-[var(--color-danger)]"
              >
                Salir
              </button>
            </form>
          </div>
        </div>
      </header>

      {/* Siempre visible, en cualquier pantalla del panel. */}
      <AlertMonitor
        initialAlerts={(alertsRes.data ?? []) as Alert[]}
        tableNumbers={tableNumbers}
      />

      {children}
    </div>
  );
}
