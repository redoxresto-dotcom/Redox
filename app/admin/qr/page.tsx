import QRCode from "qrcode";
import { headers } from "next/headers";
import { requireAdmin } from "@/lib/auth";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { BarTable } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Base pública del sitio. Si NEXT_PUBLIC_SITE_URL no está seteada, se deduce
 * del host de la request: así los QR generados en desarrollo apuntan a la IP
 * de la red local y se pueden escanear desde un celular.
 */
async function siteUrl(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "");
  if (configured) return configured;

  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export default async function QrPage() {
  await requireAdmin();

  const supabase = await getSupabaseServerClient();
  const { data } = await supabase.from("tables").select("*").order("number");
  // Las mesas internas (ventas sin conexión) no tienen QR físico.
  const tables = ((data ?? []) as BarTable[]).filter((t) => !t.is_system);
  const base = await siteUrl();

  const codes = await Promise.all(
    tables.map(async (table) => {
      const url = `${base}/table/${table.id}`;
      return {
        table,
        url,
        png: await QRCode.toDataURL(url, {
          width: 420,
          margin: 1,
          errorCorrectionLevel: "M",
          color: { dark: "#000000", light: "#ffffff" },
        }),
      };
    })
  );

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <header className="mb-5 print:hidden">
        <h1 className="text-2xl font-semibold">Códigos QR de las mesas</h1>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          Imprimí esta página y pegá cada código en su mesa. Apuntan a{" "}
          <code className="rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 text-xs">
            {base}
          </code>
          , así que si cambiás el dominio hay que reimprimirlos.
        </p>
        {!process.env.NEXT_PUBLIC_SITE_URL ? (
          <p className="mt-3 rounded-lg bg-[var(--color-busy)]/15 px-3 py-2 text-sm text-[var(--color-busy)] backdrop-blur-md">
            Ojo: <code>NEXT_PUBLIC_SITE_URL</code> no está configurada, así que
            estos QR usan la dirección desde la que abriste esta página. Antes de
            imprimir en serio, definila con el dominio final.
          </p>
        ) : null}
      </header>

      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 print:grid-cols-3">
        {codes.map(({ table, png, url }) => (
          <li
            key={table.id}
            className="flex break-inside-avoid flex-col items-center gap-2 rounded-2xl border border-[var(--color-border)] bg-white p-4 text-center print:border-black"
          >
            <span className="text-3xl font-bold text-black">
              {table.name ? table.name : `Mesa ${table.number}`}
            </span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={png}
              alt={`Código QR de la mesa ${table.number}`}
              className="w-full max-w-44"
            />
            <span className="text-[10px] break-all text-neutral-500 print:hidden">
              {url}
            </span>
            <span className="text-sm font-medium text-black">
              Escaneá para llamar al mozo
            </span>
          </li>
        ))}
      </ul>
    </main>
  );
}
