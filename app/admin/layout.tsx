import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { signOut } from "../login/actions";
import { AlertMonitor } from "./_components/alert-monitor";
import type { Alert, BarTable } from "@/lib/types";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Guard real: aunque el proxy ya filtró, cada render vuelve a validar
  // el usuario y su perfil contra la base.
  const profile = await requireStaff();

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
    ])
  );

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-[var(--color-border)] bg-[var(--color-bg)]/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3">
          <Link href="/admin" className="font-semibold tracking-tight">
            POS <span className="text-[var(--color-accent)]">Punta Carretas</span>
          </Link>

          <nav className="flex items-center gap-1 text-sm">
            <Link
              href="/admin"
              className="rounded-lg px-3 py-1.5 text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface)] hover:text-[var(--color-ink)]"
            >
              Salón
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
              href="/admin/caja"
              className="rounded-lg px-3 py-1.5 text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface)] hover:text-[var(--color-ink)]"
            >
              Caja
            </Link>
            {profile.role === "admin" ? (
              <>
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
              {profile.role === "admin" ? (
                <span className="ml-1.5 rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[10px] tracking-wide uppercase">
                  admin
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
