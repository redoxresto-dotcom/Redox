import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Cliente de servidor con SERVICE ROLE KEY: bypassea RLS.
 *
 * NUNCA importar este módulo desde un componente cliente. El import de
 * "server-only" hace que el build falle si alguien lo intenta.
 *
 * Todas las operaciones del POS (cargar productos a una mesa, cobrar,
 * CRUD de catálogo, resolver alertas) pasan por acá vía Server Actions
 * o Route Handlers.
 */
let adminClient: SupabaseClient | undefined;

export function getSupabaseAdminClient(): SupabaseClient {
  if (adminClient) return adminClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      "Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local"
    );
  }

  adminClient = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return adminClient;
}
