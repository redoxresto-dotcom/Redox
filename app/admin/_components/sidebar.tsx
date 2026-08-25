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
    { href: "/admin/reportes", label: "Reportes", icon: IconReportes },
  );

  if (hasRank(role, "gerente")) {
    items.push({ href: "/admin/usuarios", label: "Usuarios", icon: IconUsuarios });
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
  const [collapsed, setCollapsed] = useState(false);

  // Se lee después del primer render a propósito: el servidor no conoce el
  // localStorage y pintar distinto de lo que ya está en pantalla rompe la
  // hidratación.
  useEffect(() => {
    if (window.localStorage.getItem(SIDEBAR_KEY) === "1") setCollapsed(true);
  }, []);

  function toggle() {
    setCollapsed((c) => {
      const next = !c;
      window.localStorage.setItem(SIDEBAR_KEY, next ? "1" : "0");
      return next;
    });
  }

  const items = itemsFor(role);

  return (
    <div className="flex min-h-screen">
      <aside
        className={`sticky top-0 z-30 flex h-screen shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)]/60 backdrop-blur transition-[width] duration-200 ${
          collapsed ? "w-[76px]" : "w-64"
        }`}
      >
        <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-4 py-4">
          <Link
            href="/admin"
            aria-label="Redox"
            className="flex min-w-0 items-center gap-2"
          >
            <RedoxFlask size={26} />
            {!collapsed ? (
              <span
                className="truncate text-lg font-semibold tracking-tight text-[var(--color-brand-soft)] italic"
                style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}
              >
                Redox
              </span>
            ) : null}
          </Link>
          <button
            type="button"
            onClick={toggle}
            aria-label={collapsed ? "Expandir menú" : "Colapsar menú"}
            className="ml-auto shrink-0 rounded-lg p-1.5 text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
          >
            {collapsed ? (
              <IconChevronsRight size={16} />
            ) : (
              <IconChevronsLeft size={16} />
            )}
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
                      collapsed ? "justify-center" : ""
                    } ${
                      active
                        ? "bg-[var(--color-accent)]/15 text-[var(--color-accent)]"
                        : "text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
                    }`}
                  >
                    <item.icon size={20} className="shrink-0" />
                    {!collapsed ? (
                      <span className="truncate">{item.label}</span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="border-t border-[var(--color-border)] p-3">
          <div
            className={`flex items-center gap-2.5 rounded-lg px-2 py-2 ${
              collapsed ? "justify-center" : ""
            }`}
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent)]/20 text-xs font-semibold text-[var(--color-accent)]">
              {iniciales(fullName)}
            </span>
            {!collapsed ? (
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {fullName}
                </span>
                <span className="block truncate text-xs text-[var(--color-muted)]">
                  {ROLE_LABELS[role]}
                </span>
              </span>
            ) : null}
          </div>

          <form action={signOut}>
            <button
              type="submit"
              title={collapsed ? "Salir" : undefined}
              className={`mt-1 flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-sm text-[var(--color-muted)] transition-colors hover:bg-[var(--color-danger)]/10 hover:text-[var(--color-danger)] ${
                collapsed ? "justify-center" : ""
              }`}
            >
              <IconLogout size={18} className="shrink-0" />
              {!collapsed ? "Salir" : null}
            </button>
          </form>
        </div>
      </aside>

      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
