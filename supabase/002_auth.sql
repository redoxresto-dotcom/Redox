-- =============================================================================
--  POS VENTA — Punta Carretas
--  Migración 002: autenticación de mozos y RLS basada en auth.uid()
--
--  Ejecutar DESPUÉS de schema.sql, en:
--    Supabase Dashboard → SQL Editor → New query → Run
--  Es idempotente.
--
--  Reemplaza el modelo provisorio "todo por service_role" por permisos reales:
--  cada mozo entra con su usuario y la base decide qué puede hacer.
-- =============================================================================

-- =============================================================================
--  1. PROFILES — extiende auth.users con nombre y rol
-- =============================================================================
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  full_name  text        not null,
  role       text        not null default 'mozo' check (role in ('mozo', 'admin')),
  active     boolean     not null default true,
  created_at timestamptz not null default now()
);

-- Al crearse un usuario en Auth, se crea su perfil automáticamente.
-- El PRIMER usuario del sistema queda como admin: evita quedarse afuera.
create or replace function public.fn_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  if not exists (select 1 from public.profiles) then
    v_role := 'admin';
  else
    v_role := coalesce(new.raw_user_meta_data ->> 'role', 'mozo');
    if v_role not in ('mozo', 'admin') then
      v_role := 'mozo';
    end if;
  end if;

  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
      split_part(new.email, '@', 1)
    ),
    v_role
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.fn_handle_new_user();

-- Backfill: si ya creaste usuarios antes de correr esta migración, les arma el perfil.
insert into public.profiles (id, full_name, role)
select
  u.id,
  coalesce(nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''), split_part(u.email, '@', 1)),
  case when row_number() over (order by u.created_at) = 1 then 'admin' else 'mozo' end
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id)
on conflict (id) do nothing;

-- =============================================================================
--  2. HELPERS de permisos
--  security definer para que no choquen con la RLS de profiles (recursión).
-- =============================================================================
create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid() and p.active
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid() and p.active and p.role = 'admin'
  );
$$;

-- =============================================================================
--  3. Trazabilidad: qué mozo atiende cada mesa y quién abrió/cobró cada cuenta
-- =============================================================================

-- tables.assigned_waiter pasa de texto libre a referencia real al mozo.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'tables'
       and column_name = 'assigned_waiter' and data_type <> 'uuid'
  ) then
    alter table public.tables drop column assigned_waiter;
  end if;
end
$$;

alter table public.tables
  add column if not exists assigned_waiter uuid references public.profiles (id) on delete set null;

alter table public.orders
  add column if not exists opened_by uuid references public.profiles (id) on delete set null,
  add column if not exists closed_by uuid references public.profiles (id) on delete set null;

alter table public.order_items
  add column if not exists created_by uuid references public.profiles (id) on delete set null;

alter table public.alerts
  add column if not exists resolved_by uuid references public.profiles (id) on delete set null;

-- Los RPC ahora registran quién hizo la operación.
create or replace function public.open_table_order(p_table_id uuid)
returns uuid
language plpgsql
security invoker
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
    insert into public.orders (table_id, opened_by)
    values (p_table_id, auth.uid())
    returning id into v_order_id;
  end if;

  update public.tables
     set status = 'ocupada',
         assigned_waiter = coalesce(assigned_waiter, auth.uid())
   where id = p_table_id;

  return v_order_id;
end;
$$;

create or replace function public.close_table_order(p_order_id uuid)
returns public.orders
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_order public.orders;
begin
  update public.orders
     set status = 'cobrada', closed_at = now(), closed_by = auth.uid()
   where id = p_order_id and status = 'abierta'
  returning * into v_order;

  if v_order.id is null then
    raise exception 'La cuenta % no existe o ya fue cobrada', p_order_id;
  end if;

  update public.tables
     set status = 'libre', assigned_waiter = null
   where id = v_order.table_id;

  update public.alerts
     set status = 'resuelta', resolved_by = auth.uid()
   where table_id = v_order.table_id and status = 'pendiente';

  return v_order;
end;
$$;

-- El trigger de resolved_at ahora también sella quién resolvió.
create or replace function public.fn_alert_resolved_at()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'resuelta' and old.status <> 'resuelta' then
    new.resolved_at := now();
    new.resolved_by := coalesce(new.resolved_by, auth.uid());
  end if;
  return new;
end;
$$;

-- =============================================================================
--  4. ROW LEVEL SECURITY — modelo definitivo
-- -----------------------------------------------------------------------------
--   anon (cliente con el QR, sin login)
--     · lee tables y products activos
--     · lee alerts (para ver "el mozo fue avisado")
--     · crea alerts en estado 'pendiente'
--     · NADA de orders / order_items / profiles
--
--   mozo (autenticado, profiles.role = 'mozo')
--     · opera el salón: mesas, cuentas, líneas, resolver alertas
--     · lee el catálogo pero NO lo edita
--
--   admin (profiles.role = 'admin')
--     · todo lo del mozo + ABM de catálogo y de usuarios
--
--   Un usuario con active = false pierde todos los permisos sin borrar su
--   historial: es la forma de dar de baja a un mozo.
-- =============================================================================

alter table public.profiles enable row level security;

-- --- profiles -----------------------------------------------------------------
drop policy if exists "profiles_select_self" on public.profiles;
create policy "profiles_select_self"
  on public.profiles for select
  to authenticated
  using (id = auth.uid() or public.is_staff());

drop policy if exists "profiles_update_own_name" on public.profiles;
create policy "profiles_update_own_name"
  on public.profiles for update
  to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

drop policy if exists "profiles_admin_write" on public.profiles;
create policy "profiles_admin_write"
  on public.profiles for insert
  to authenticated
  with check (public.is_admin());

drop policy if exists "profiles_admin_delete" on public.profiles;
create policy "profiles_admin_delete"
  on public.profiles for delete
  to authenticated
  using (public.is_admin());

-- --- products -----------------------------------------------------------------
drop policy if exists "products_select_public" on public.products;
create policy "products_select_public"
  on public.products for select
  to anon
  using (active = true);

drop policy if exists "products_select_staff" on public.products;
create policy "products_select_staff"
  on public.products for select
  to authenticated
  using (active = true or public.is_staff());

drop policy if exists "products_admin_write" on public.products;
create policy "products_admin_write"
  on public.products for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- --- tables -------------------------------------------------------------------
drop policy if exists "tables_select_public" on public.tables;
create policy "tables_select_public"
  on public.tables for select
  to anon, authenticated
  using (true);

drop policy if exists "tables_staff_write" on public.tables;
create policy "tables_staff_write"
  on public.tables for all
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- --- orders -------------------------------------------------------------------
drop policy if exists "orders_staff_all" on public.orders;
create policy "orders_staff_all"
  on public.orders for all
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- --- order_items --------------------------------------------------------------
drop policy if exists "order_items_staff_all" on public.order_items;
create policy "order_items_staff_all"
  on public.order_items for all
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- --- alerts -------------------------------------------------------------------
drop policy if exists "alerts_select_public" on public.alerts;
create policy "alerts_select_public"
  on public.alerts for select
  to anon, authenticated
  using (true);

drop policy if exists "alerts_insert_public" on public.alerts;
create policy "alerts_insert_public"
  on public.alerts for insert
  to anon, authenticated
  with check (
    status = 'pendiente'
    and type in ('llamar_mozo', 'pedir_cuenta')
  );

drop policy if exists "alerts_staff_resolve" on public.alerts;
create policy "alerts_staff_resolve"
  on public.alerts for update
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

drop policy if exists "alerts_staff_delete" on public.alerts;
create policy "alerts_staff_delete"
  on public.alerts for delete
  to authenticated
  using (public.is_staff());

-- =============================================================================
--  5. Realtime de profiles no hace falta; sí conviene que orders/tables/alerts
--     sigan publicados (ya lo hizo schema.sql).
-- =============================================================================
