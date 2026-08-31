"use client";

import { useEffect, useState, type ComponentType } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "../../login/actions";
import { RedoxFlask } from "../../_components/brand";
import { hasRank, ROLE_LABELS, type StaffRole } from "@/lib/types";
import {
  IconSalon,
  IconMesas,
  IconCaja,
  IconPool,
  IconBarra,
  IconCocina,
  IconCatalogo,
  IconPlano,
  IconReportes,
  IconUsuarios,
  IconQR,
  IconLogout,
  IconMenu,
  IconClose,
  IconChevronsLeft,
  IconChevronsRight,
} from "./sidebar-icons";

const SIDEBAR_KEY = "pos-sidebar-collapsed";

type NavItem = {
  href: string;
  label: string;
  icon: ComponentType<{ size?: number; className?: string }>;
};

function itemsFor(role: StaffRole): NavItem[] {
  const items: NavItem[] = [
    { href: "/admin", label: "Salón", icon: IconSalon },
    { href: "/admin/mis-mesas", label: "Mis mesas", icon: IconMesas },
  ];

  if (!hasRank(role, "admin")) return items;

  items.push(
    { href: "/admin/caja", label: "Caja", icon: IconCaja },
    { href: "/admin/pool", label: "Pool", icon: IconPool },
    { href: "/estacion/barra", label: "Barra", icon: IconBarra },
    { href: "/estacion/cocina", label: "Cocina", icon: IconCocina },
    { href: "/admin/catalogo", label: "Catálogo", icon: IconCatalogo },
    { href: "/admin/salon", label: "Plano", icon: IconPlano },
  );

  if (hasRank(role, "gerente")) {
    // La facturación es del gerente: el admin opera el salón pero no ve las ventas.
    items.push(
      { href: "/admin/reportes", label: "Reportes", icon: IconReportes },
      { href: "/admin/usuarios", label: "Usuarios", icon: IconUsuarios },
    );
  }

  items.push({ href: "/admin/qr", label: "QR", icon: IconQR });

  return items;
}

function iniciales(nombre: string): string {
  const partes = nombre.trim().split(/\s+/);
  const letras = partes.length > 1
    ? [partes[0][0], partes[partes.length - 1][0]]
    : [partes[0]?.[0] ?? "?"];
  return letras.join("").toUpperCase();
}

export function Sidebar({
  role,
  fullName,
  children,
}: {
  role: StaffRole;
  fullName: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  // Colapsar a solo íconos: elección del escritorio, se recuerda entre
  // sesiones. En el celular no significa nada — ahí el menú entero se guarda
  // (ver `mobileOpen`), no tiene un estado intermedio.
  const [collapsed, setCollapsed] = useState(false);
  // El menú del celular arranca cerrado siempre: no tiene sentido persistirlo
  // como el de escritorio, porque taparía toda la pantalla en cada visita.
  const [mobileOpen, setMobileOpen] = useState(false);

  // Se lee después del primer render a propósito: el servidor no conoce el
  // localStorage y pintar distinto de lo que ya está en pantalla rompe la
  // hidratación.
  useEffect(() => {
    if (window.localStorage.getItem(SIDEBAR_KEY) === "1") setCollapsed(true);
  }, []);

  // Cambiar de página con el menú del celular abierto lo deja abierto tapando
  // la pantalla nueva si no se cierra solo.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  function toggleCollapsed() {
    setCollapsed((c) => {
      const next = !c;
      window.localStorage.setItem(SIDEBAR_KEY, next ? "1" : "0");
      return next;
    });
  }

  const items = itemsFor(role);

  return (
    <div className="flex min-h-screen">
      {/* Fondo oscuro detrás del menú del celular: tocarlo lo cierra. */}
      {mobileOpen ? (
        <div
          role="presentation"
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-[1px] md:hidden"
        />
      ) : null}

      <aside
        className={`fixed top-0 left-0 z-40 flex h-screen w-72 flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)] backdrop-blur transition-transform duration-200 md:sticky md:z-30 md:translate-x-0 md:bg-[var(--color-surface)]/60 md:transition-[width] ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        } ${collapsed ? "md:w-[76px]" : "md:w-64"}`}
      >
        <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-4 py-4">
          <Link
            href="/admin"
            aria-label="Redox"
            className="flex min-w-0 items-center gap-2"
          >
            <RedoxFlask size={26} />
            <span
              className={`truncate text-lg font-semibold tracking-tight text-[var(--color-brand-soft)] italic ${
                collapsed ? "md:hidden" : ""
              }`}
              style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}
            >
              Redox
            </span>
          </Link>

          {/* Colapsar a rail de íconos: solo tiene sentido con lugar de sobra. */}
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Expandir menú" : "Colapsar menú"}
            className="ml-auto hidden shrink-0 rounded-lg p-1.5 text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)] md:block"
          >
            {collapsed ? (
              <IconChevronsRight size={16} />
            ) : (
              <IconChevronsLeft size={16} />
            )}
          </button>

          {/* En el celular el menú es todo o nada: se cierra, no se colapsa. */}
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            aria-label="Cerrar menú"
            className="ml-auto shrink-0 rounded-lg p-1.5 text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)] md:hidden"
          >
            <IconClose size={18} />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          <ul className="grid gap-1">
            {items.map((item) => {
              const active = pathname === item.href;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    title={collapsed ? item.label : undefined}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                      collapsed ? "md:justify-center" : ""
                    } ${
                      active
                        ? "bg-[var(--color-accent)]/15 text-[var(--color-accent)]"
                        : "text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
                    }`}
                  >
                    <item.icon size={20} className="shrink-0" />
                    <span className={`truncate ${collapsed ? "md:hidden" : ""}`}>
                      {item.label}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="border-t border-[var(--color-border)] p-3">
          <div
            className={`flex items-center gap-2.5 rounded-lg px-2 py-2 ${
              collapsed ? "md:justify-center" : ""
            }`}
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent)]/20 text-xs font-semibold text-[var(--color-accent)]">
              {iniciales(fullName)}
            </span>
            <span className={`min-w-0 flex-1 ${collapsed ? "md:hidden" : ""}`}>
              <span className="block truncate text-sm font-medium">
                {fullName}
              </span>
              <span className="block truncate text-xs text-[var(--color-muted)]">
                {ROLE_LABELS[role]}
              </span>
            </span>
          </div>

          <form action={signOut}>
            <button
              type="submit"
              title={collapsed ? "Salir" : undefined}
              className={`mt-1 flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-sm text-[var(--color-muted)] transition-colors hover:bg-[var(--color-danger)]/10 hover:text-[var(--color-danger)] ${
                collapsed ? "md:justify-center" : ""
              }`}
            >
              <IconLogout size={18} className="shrink-0" />
              <span className={collapsed ? "md:hidden" : ""}>Salir</span>
            </button>
          </form>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        {/* Barra del celular: el menú entero se guarda atrás de este botón. */}
        <div className="sticky top-0 z-20 flex items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-bg)]/95 px-4 py-3 backdrop-blur md:hidden">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label="Abrir menú"
            className="rounded-lg p-1.5 text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface)] hover:text-[var(--color-ink)]"
          >
            <IconMenu size={22} />
          </button>
          <Link href="/admin" aria-label="Redox" className="flex items-center gap-2">
            <RedoxFlask size={22} />
            <span
              className="text-base font-semibold tracking-tight text-[var(--color-brand-soft)] italic"
              style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}
            >
              Redox
            </span>
          </Link>
        </div>

        {children}
      </div>
    </div>
  );
}
