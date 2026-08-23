-- =============================================================================
--  NexoRestUy — Redox, Punta Carretas
--  Migración 014: quién está jugando
--
--  Ejecutar DESPUÉS de 013_pool.sql, en:
--    Supabase Dashboard → SQL Editor → New query → Run
--  Es idempotente.
--
--  Dos nombres por partida. Van en la partida y no en la mesa: cuando el grupo
--  compra media hora más, siguen siendo los mismos; cuando se van y entra otro
--  grupo, la partida nueva arranca en blanco sin que nadie tenga que borrarlos.
-- =============================================================================

alter table public.pool_sessions
  add column if not exists player_one text,
  add column if not exists player_two text;

-- Nombres en blanco se guardan como nulo y no como cadena vacía: así "sin
-- nombre" es una sola cosa y no dos que se ven igual.
create or replace function public.fn_pool_players_limpios()
returns trigger
language plpgsql
as $$
begin
  new.player_one := nullif(trim(coalesce(new.player_one, '')), '');
  new.player_two := nullif(trim(coalesce(new.player_two, '')), '');
  return new;
end;
$$;

drop trigger if exists trg_pool_players_limpios on public.pool_sessions;
create trigger trg_pool_players_limpios
  before insert or update of player_one, player_two on public.pool_sessions
  for each row execute function public.fn_pool_players_limpios();

-- =============================================================================
--  El estado en vivo los devuelve
--
--  Reemplaza la versión de la 013: agrega los dos nombres y conserva el resto.
--
--  Va con DROP antes del CREATE, y no alcanza con `create or replace`: cambiar
--  las columnas que devuelve una función es cambiar su forma, y Postgres no
--  deja reemplazarla en el lugar. El DROP es seguro porque a esta función no la
--  usa nada dentro de la base — la llama la aplicación por RPC.
-- =============================================================================
drop function if exists public.pool_status();

create function public.pool_status()
returns table (
  table_id             uuid,
  table_number         integer,
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
