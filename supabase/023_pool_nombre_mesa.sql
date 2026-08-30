-- =============================================================================
--  NexoRestUy — Redox, Punta Carretas
--  Migración 023: la sección de pool muestra el nombre de la mesa
--
--  Ejecutar DESPUÉS de 022_pool_reservas.sql, en:
--    Supabase Dashboard → SQL Editor → New query → Run
--  Es idempotente.
--
--  El panel y la pantalla del salón (TV) mostraban "Mesa 12" — el número, que
--  es el identificador interno. Se agrega el nombre de la mesa (`tables.name`,
--  la etiqueta opcional "Terraza", "Pool 1"…) a los dos RPC que alimentan esas
--  pantallas. La app usa el nombre y cae al número sólo si la mesa no tiene uno.
--
--  Cambian las columnas que devuelven las funciones, así que van con DROP antes
--  del CREATE: `create or replace` no puede cambiarle la forma a una función.
--  Es seguro — a estas dos las llama sólo la app por RPC, nada dentro de la base.
-- =============================================================================

-- =============================================================================
--  1. Estado en vivo de las mesas de pool
-- =============================================================================
drop function if exists public.pool_status();

create function public.pool_status()
returns table (
  table_id             uuid,
  table_number         integer,
  table_name           text,
  device_id            text,
  session_id           uuid,
  started_at           timestamptz,
  ends_at              timestamptz,
  player_one           text,
  player_two           text,
  order_id             uuid,
  order_total          numeric,
  purchased_minutes    integer,
  warning_minutes      integer,
  max_block_minutes    integer,
  last_seen_at         timestamptz,
  relay_on             boolean,
  hours_played         numeric,
  felt_threshold_hours integer
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    pt.table_id,
    t.number as table_number,
    t.name   as table_name,
    pt.device_id,
    s.id     as session_id,
    s.started_at,
    s.ends_at,
    s.player_one,
    s.player_two,
    s.order_id,
    o.total  as order_total,
    coalesce((
      select sum(pp.minutes)::integer
        from public.pool_purchases pp
       where pp.session_id = s.id
    ), 0) as purchased_minutes,
    pt.warning_minutes,
    pt.max_block_minutes,
    pt.last_seen_at,
    pt.relay_on,
    coalesce((
      select round(sum(h.minutes_played)::numeric / 60, 2)
        from public.pool_sessions h
       where h.table_id = pt.table_id
         and h.minutes_played is not null
         and h.started_at > coalesce(
           (select m.done_at
              from public.pool_maintenance m
             where m.table_id = pt.table_id and m.kind = 'paño'
             order by m.done_at desc
             limit 1),
           '-infinity'::timestamptz
         )
    ), 0) as hours_played,
    pt.felt_threshold_hours
  from public.pool_tables pt
  join public.tables t on t.id = pt.table_id
  left join public.pool_sessions s
    on s.table_id = pt.table_id and s.status = 'activa'
  left join public.orders o on o.id = s.order_id
  where pt.active
  order by t.number;
$$;

-- =============================================================================
--  2. Listado de reservas del día
-- =============================================================================
drop function if exists public.pool_day_reservations(date);

create function public.pool_day_reservations(
  p_date date default (now() at time zone 'America/Montevideo')::date
)
returns table (
  id                uuid,
  table_id          uuid,
  table_number      integer,
  table_name        text,
  customer_name     text,
  phone             text,
  scheduled_at      timestamptz,
  play_minutes      integer,
  status            text,
  session_id        uuid,
  created_at        timestamptz,
  activated_at      timestamptz,
  released_at       timestamptz,
  created_by_name   text,
  activated_by_name text,
  released_by_name  text
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    r.id,
    r.table_id,
    t.number as table_number,
    t.name   as table_name,
    r.customer_name,
    r.phone,
    r.scheduled_at,
    r.play_minutes,
    r.status,
    r.session_id,
    r.created_at,
    r.activated_at,
    r.released_at,
    pc.full_name as created_by_name,
    pa.full_name as activated_by_name,
    pr.full_name as released_by_name
  from public.pool_reservations r
  join public.tables t on t.id = r.table_id
  left join public.profiles pc on pc.id = r.created_by
  left join public.profiles pa on pa.id = r.activated_by
  left join public.profiles pr on pr.id = r.released_by
  where (r.scheduled_at at time zone 'America/Montevideo')::date = p_date
  order by r.scheduled_at;
$$;

notify pgrst, 'reload schema';
