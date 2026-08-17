"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Cliente de navegador. Usa la ANON KEY (pública) y comparte la sesión con el
 * servidor vía cookies, así que las policies de RLS lo ven como el mozo logueado
 * (o como `anon` en la vista del cliente con QR).
 *
 * Es el que abre el WebSocket de Realtime del monitor de alertas.
 */
let browserClient: SupabaseClient | undefined;

export function getSupabaseBrowserClient(): SupabaseClient {
  if (browserClient) return browserClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY en .env.local"
    );
  }

  browserClient = createBrowserClient(url, anonKey, {
    realtime: { params: { eventsPerSecond: 10 } },
  });

  return browserClient;
}
