-- =============================================================================
--  POS VENTA — Punta Carretas
--  Migración 003: mesas de pool (lector RFID / tarjetas)
--
--  Ejecutar DESPUÉS de 002_auth.sql, en:
--    Supabase Dashboard → SQL Editor → New query → Run
--  Es idempotente.
-- =============================================================================

-- =============================================================================
--  1. Producto que define la tarifa de pool
--  El webhook no puede adivinar cuánto cuesta la hora: marca un producto del
--  catálogo como "tarifa de pool" y toma el precio de ahí. Así el encargado
--  cambia la tarifa desde /admin/catalogo, sin tocar código.
-- =============================================================================
alter table public.products
  add column if not exists is_pool_rate boolean not null default false;

-- Solo un producto puede ser la tarifa vigente.
create unique index if not exists products_one_pool_rate
  on public.products (is_pool_rate)
  where is_pool_rate;

-- Marca "Hora de pool" del seed, si todavía no hay ninguno designado.
update public.products
   set is_pool_rate = true
 where lower(name) = 'hora de pool'
   and not exists (select 1 from public.products where is_pool_rate);

-- =============================================================================
--  2. POOL_SESSIONS — bitácora de todo lo que manda el hardware
--
--  Guarda el payload crudo aunque el evento se rechace: si mañana el lector
--  manda algo raro, se puede ver exactamente qué llegó sin depender de logs.
-- =============================================================================
create table if not exists public.pool_sessions (
  id            uuid primary key default gen_random_uuid(),
  device_id     text        not null,
  card_uid      text,
  table_id      uuid        references public.tables (id) on delete set null,
  order_id      uuid        references public.orders (id) on delete set null,
  order_item_id uuid        references public.order_items (id) on delete set null,
  event         text        not null check (event in ('session_start', 'session_end')),
  minutes       integer     check (minutes is null or minutes >= 0),
  amount        numeric(10,2) check (amount is null or amount >= 0),
  -- Clave de idempotencia del lector. Si el aparato reintenta por un corte de
  -- red, el mismo external_id no cobra dos veces.
  external_id   text unique,
  payload       jsonb       not null,
  created_at    timestamptz not null default now()
);

create index if not exists pool_sessions_device_idx
  on public.pool_sessions (device_id, created_at desc);

create index if not exists pool_sessions_table_idx
  on public.pool_sessions (table_id, created_at desc);

-- =============================================================================
--  3. RLS
--  El webhook escribe con service_role (no hay humano detrás), así que no
--  necesita policies de escritura. El personal puede consultar la bitácora.
-- =============================================================================
alter table public.pool_sessions enable row level security;

drop policy if exists "pool_sessions_staff_read" on public.pool_sessions;
create policy "pool_sessions_staff_read"
  on public.pool_sessions for select
  to authenticated
  using (public.is_staff());
