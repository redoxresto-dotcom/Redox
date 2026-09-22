-- =============================================================================
--  NexoRestUy — Redox, Punta Carretas
--  Migración 035: la reserva de pool pide un contacto libre, no un celular
--
--  Ejecutar DESPUÉS de 034_pool_reservas_personal.sql, en:
--    Supabase Dashboard → SQL Editor → New query → Run
--  Es idempotente (salvo el rename de columna, que solo corre una vez: si
--  ya se aplicó, `phone` no existe más y el rename no vuelve a dispararse).
--
--  Antes, `phone` era obligatorio y tenía que ser un celular uruguayo
--  (09XXXXXXX). En la práctica el cliente a veces prefiere dejar su documento,
--  un mail, o directamente nada. Se renombra a `contact`, deja de ser
--  obligatorio y deja de exigir formato de celular: es texto libre.
-- =============================================================================

do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'pool_reservations'
       and column_name = 'phone'
  ) then
    alter table public.pool_reservations rename column phone to contact;
  end if;
end
$$;

alter table public.pool_reservations alter column contact drop not null;

alter table public.pool_reservations
  drop constraint if exists pool_reservations_phone_check;

alter table public.pool_reservations
  drop constraint if exists pool_reservations_contact_check,
  add  constraint pool_reservations_contact_check
       check (contact is null or length(trim(contact)) > 0);

-- =============================================================================
--  1. Crear una reserva: el contacto ya no se valida ni es obligatorio
--
--  Cambia el nombre de un parámetro (p_phone -> p_contact), y Postgres no
--  deja renombrar parámetros con CREATE OR REPLACE: hay que borrar la función
--  primero.
-- =============================================================================
drop function if exists public.pool_reserve(uuid, text, text, timestamptz, integer);

create function public.pool_reserve(
  p_table_id     uuid,
  p_customer     text,
  p_contact      text,
  p_scheduled_at timestamptz,
  p_minutes      integer
)
returns public.pool_reservations
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_pool        public.pool_tables;
  v_reservation public.pool_reservations;
begin
  if not public.is_staff() then
    raise exception 'Sólo el personal puede crear reservas de pool';
  end if;

  select * into v_pool from public.pool_tables where table_id = p_table_id;
  if v_pool.table_id is null then
    raise exception 'Esa mesa no es una mesa de pool';
  end if;
  if not v_pool.active then
    raise exception 'La mesa de pool está fuera de servicio';
  end if;

  if coalesce(trim(p_customer), '') = '' then
    raise exception 'Falta el nombre del cliente';
  end if;
  if p_scheduled_at is null then
    raise exception 'Falta la hora del turno';
  end if;
  if p_minutes is null or p_minutes <= 0 then
    raise exception 'Las horas de juego tienen que ser un número positivo';
  end if;
  if p_minutes > v_pool.max_block_minutes then
    raise exception 'No se pueden reservar más de % minutos en esa mesa', v_pool.max_block_minutes;
  end if;

  insert into public.pool_reservations
    (table_id, customer_name, contact, scheduled_at, play_minutes, created_by)
  values
    (p_table_id, trim(p_customer), nullif(trim(coalesce(p_contact, '')), ''),
     p_scheduled_at, p_minutes, auth.uid())
  returning * into v_reservation;

  return v_reservation;
exception
  when unique_violation then
    raise exception 'Ya hay una reserva para esa mesa a esa hora';
end;
$$;

-- =============================================================================
--  2. El listado del día: cambia la columna que devuelve (phone -> contact),
--  así que va con DROP antes del CREATE, igual que en la 023.
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
  contact           text,
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
    r.contact,
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
