-- =============================================================================
--  POS VENTA — Punta Carretas
--  Esquema completo: tablas, índices, triggers, RLS y Realtime.
--  Ejecutar en:  Supabase Dashboard → SQL Editor → New query → Run
--  Es idempotente: se puede volver a correr sin romper nada.
-- =============================================================================

create extension if not exists "pgcrypto";

-- =============================================================================
--  1. PRODUCTS
-- =============================================================================
create table if not exists public.products (
  id          uuid primary key default gen_random_uuid(),
  name        text        not null check (length(trim(name)) > 0),
  price       numeric(10,2) not null check (price >= 0),   -- precio de venta
  cost        numeric(10,2) not null default 0 check (cost >= 0), -- costo
  category    text        not null default 'bebida'
                          check (category in ('bebida', 'comida', 'otro')),
  active      boolean     not null default true,
  created_at  timestamptz not null default now()
);

create index if not exists products_active_idx on public.products (active, category, name);

-- Evita cargar dos veces el mismo producto por descuido.
create unique index if not exists products_name_unique on public.products (lower(name));

-- =============================================================================
--  2. TABLES (mesas del salón)
-- =============================================================================
create table if not exists public.tables (
  id              uuid primary key default gen_random_uuid(),
  number          integer     not null unique check (number > 0),
  status          text        not null default 'libre'
                              check (status in ('libre', 'ocupada')),
  assigned_waiter text,
  created_at      timestamptz not null default now()
);

create index if not exists tables_number_idx on public.tables (number);

-- =============================================================================
--  3. ORDERS (cuentas)
-- =============================================================================
create table if not exists public.orders (
  id         uuid primary key default gen_random_uuid(),
  table_id   uuid        not null references public.tables (id) on delete restrict,
  status     text        not null default 'abierta'
                         check (status in ('abierta', 'cobrada')),
  total      numeric(10,2) not null default 0 check (total >= 0),
  opened_at  timestamptz not null default now(),
  closed_at  timestamptz,
  created_at timestamptz not null default now()
);

-- Regla de negocio: una sola cuenta ABIERTA por mesa a la vez.
create unique index if not exists orders_one_open_per_table
  on public.orders (table_id)
  where status = 'abierta';

create index if not exists orders_status_idx on public.orders (status, opened_at desc);

-- =============================================================================
--  4. ORDER_ITEMS (líneas de la cuenta)
-- =============================================================================
create table if not exists public.order_items (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid        not null references public.orders (id) on delete cascade,
  product_id uuid        not null references public.products (id) on delete restrict,
  quantity   integer     not null default 1 check (quantity > 0),
  -- Se congela el precio/costo del momento de la venta: si mañana cambia el
  -- precio del producto, las cuentas históricas no se alteran.
  unit_price numeric(10,2) not null check (unit_price >= 0),
  unit_cost  numeric(10,2) not null default 0 check (unit_cost >= 0),
  subtotal   numeric(10,2) not null check (subtotal >= 0),
  created_at timestamptz not null default now()
);

create index if not exists order_items_order_idx on public.order_items (order_id);

-- =============================================================================
--  5. ALERTS (llamados del cliente desde el QR)
-- =============================================================================
create table if not exists public.alerts (
  id          uuid primary key default gen_random_uuid(),
  table_id    uuid        not null references public.tables (id) on delete cascade,
  type        text        not null check (type in ('llamar_mozo', 'pedir_cuenta')),
  status      text        not null default 'pendiente'
                          check (status in ('pendiente', 'resuelta')),
  created_at  timestamptz not null default now(),
  resolved_at timestamptz
);

-- Anti-spam: el cliente no puede acumular dos alertas pendientes del mismo tipo.
-- Si toca "Llamar al mozo" cinco veces, sigue habiendo una sola alerta.
create unique index if not exists alerts_one_pending_per_type
  on public.alerts (table_id, type)
  where status = 'pendiente';

create index if not exists alerts_pending_idx
  on public.alerts (status, created_at desc);

-- =============================================================================
--  TRIGGERS
-- =============================================================================

-- Mantiene order_items.subtotal siempre coherente con quantity * unit_price.
create or replace function public.fn_order_item_subtotal()
returns trigger
language plpgsql
as $$
begin
  new.subtotal := round(new.quantity * new.unit_price, 2);
  return new;
end;
$$;

drop trigger if exists trg_order_item_subtotal on public.order_items;
create trigger trg_order_item_subtotal
  before insert or update of quantity, unit_price on public.order_items
  for each row execute function public.fn_order_item_subtotal();

-- Recalcula orders.total cada vez que cambian las líneas.
create or replace function public.fn_recalc_order_total()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid := coalesce(new.order_id, old.order_id);
begin
  update public.orders o
     set total = coalesce(
       (select sum(oi.subtotal) from public.order_items oi where oi.order_id = v_order_id),
       0
     )
   where o.id = v_order_id;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_recalc_order_total on public.order_items;
create trigger trg_recalc_order_total
  after insert or update or delete on public.order_items
  for each row execute function public.fn_recalc_order_total();

-- Al marcar una alerta como resuelta, sella la hora.
create or replace function public.fn_alert_resolved_at()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'resuelta' and old.status <> 'resuelta' then
    new.resolved_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_alert_resolved_at on public.alerts;
create trigger trg_alert_resolved_at
  before update on public.alerts
  for each row execute function public.fn_alert_resolved_at();

-- =============================================================================
--  RPC: abrir mesa / cerrar mesa (operaciones atómicas)
-- =============================================================================

-- Devuelve la cuenta abierta de una mesa, creándola si no existe,
-- y marca la mesa como ocupada. Todo en una sola transacción.
create or replace function public.open_table_order(p_table_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
begin
  select id into v_order_id
    from public.orders
   where table_id = p_table_id and status = 'abierta'
   limit 1;

  if v_order_id is null then
    insert into public.orders (table_id) values (p_table_id)
    returning id into v_order_id;
  end if;

  update public.tables set status = 'ocupada' where id = p_table_id;

  return v_order_id;
end;
$$;

-- Cierra la cuenta (cobra), libera la mesa y da por resueltas sus alertas.
create or replace function public.close_table_order(p_order_id uuid)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
begin
  update public.orders
     set status = 'cobrada', closed_at = now()
   where id = p_order_id and status = 'abierta'
  returning * into v_order;

  if v_order.id is null then
    raise exception 'La cuenta % no existe o ya fue cobrada', p_order_id;
  end if;

  update public.tables
     set status = 'libre', assigned_waiter = null
   where id = v_order.table_id;

  update public.alerts
     set status = 'resuelta'
   where table_id = v_order.table_id and status = 'pendiente';

  return v_order;
end;
$$;

-- =============================================================================
--  ROW LEVEL SECURITY
-- -----------------------------------------------------------------------------
--  Modelo de esta iteración (sin login todavía):
--
--   * anon (navegador, clave pública NEXT_PUBLIC_SUPABASE_ANON_KEY)
--       - LEE  products, tables, alerts   → necesario para el QR del cliente
--                                            y para el Realtime del monitor.
--       - CREA alerts (solo 'pendiente')  → los dos botones del cliente.
--       - NO ve orders ni order_items     → la plata no se expone al público.
--
--   * service_role (solo servidor, SUPABASE_SERVICE_ROLE_KEY)
--       - Bypassea RLS. Todas las operaciones del POS (cargar productos,
--         cobrar, resolver alertas, CRUD de catálogo) pasan por acá.
--
--  Cuando agreguemos login de mozos, se reemplazan las policies de anon por
--  policies basadas en auth.uid() / auth.jwt() ->> 'role'.
-- =============================================================================

alter table public.products    enable row level security;
alter table public.tables      enable row level security;
alter table public.orders      enable row level security;
alter table public.order_items enable row level security;
alter table public.alerts      enable row level security;

-- --- products: lectura pública de los activos --------------------------------
drop policy if exists "products_select_public" on public.products;
create policy "products_select_public"
  on public.products for select
  to anon, authenticated
  using (active = true);

-- --- tables: lectura pública (el cliente necesita ver su número de mesa) ------
drop policy if exists "tables_select_public" on public.tables;
create policy "tables_select_public"
  on public.tables for select
  to anon, authenticated
  using (true);

-- --- alerts: lectura pública (habilita el Realtime del monitor) ---------------
drop policy if exists "alerts_select_public" on public.alerts;
create policy "alerts_select_public"
  on public.alerts for select
  to anon, authenticated
  using (true);

-- --- alerts: el cliente puede crear, pero solo en estado 'pendiente' ----------
drop policy if exists "alerts_insert_public" on public.alerts;
create policy "alerts_insert_public"
  on public.alerts for insert
  to anon, authenticated
  with check (
    status = 'pendiente'
    and type in ('llamar_mozo', 'pedir_cuenta')
  );

-- orders y order_items quedan SIN policies para anon:
-- RLS activo + cero policies = nadie que no sea service_role puede tocarlas.

-- =============================================================================
--  REALTIME
--  Publica los cambios de 'alerts' por WebSocket. También 'tables' y 'orders'
--  para que el dashboard del salón se refresque solo entre varios dispositivos.
-- =============================================================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and tablename = 'alerts'
  ) then
    alter publication supabase_realtime add table public.alerts;
  end if;

  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and tablename = 'tables'
  ) then
    alter publication supabase_realtime add table public.tables;
  end if;

  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and tablename = 'orders'
  ) then
    alter publication supabase_realtime add table public.orders;
  end if;
end
$$;
