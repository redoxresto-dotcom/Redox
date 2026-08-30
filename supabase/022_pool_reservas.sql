-- =============================================================================
--  NexoRestUy — Redox, Punta Carretas
--  Migración 022: reservas de mesas de pool
--
--  Ejecutar DESPUÉS de 021_editar_numero_mesa.sql, en:
--    Supabase Dashboard → SQL Editor → New query → Run
--  Es idempotente.
--
--  --------------------------------------------------------------------------
--  Qué es una reserva
--
--  Un turno para una mesa de pool: nombre, celular, a qué hora y cuánto rato
--  quiere jugar. NO enciende la mesa: cuando el cliente llega, alguien de
--  administración la activa a mano. Así, si el cliente se demora, no se le
--  descuenta tiempo pagado que todavía no jugó.
--
--  El ciclo de una reserva:
--
--    reservada ──(llega el cliente, se activa a mano)──▶ activada
--        │                                                  └─ queda enganchada
--        │                                                     a una partida real
--        ├──(no viene / cancela)──▶ liberada
--        └──(pasa el día sin activarse)──▶ vencida
--
--  Sólo administración (admin y gerente) crea, activa y libera reservas. El
--  resto del personal las ve en la pantalla del salón, nada más.
--  --------------------------------------------------------------------------
-- =============================================================================

-- =============================================================================
--  1. POOL_RESERVATIONS — una fila por turno
--
--  `table_id` apunta a `tables` y no a `pool_tables`: si mañana se le saca el
--  aparato a una mesa, la reserva histórica no tiene por qué desaparecer con
--  él. Que la mesa sea de pool se controla al crear la reserva, no con una FK.
-- =============================================================================
create table if not exists public.pool_reservations (
  id            uuid primary key default gen_random_uuid(),
  table_id      uuid not null references public.tables (id) on delete cascade,

  customer_name text not null check (length(trim(customer_name)) > 0),
  -- Celular uruguayo ya normalizado a 9 dígitos: 09 + 7. La app lo limpia
  -- antes de mandarlo; el check es la red de contención.
  phone         text not null check (phone ~ '^09[0-9]{7}$'),

  -- El turno: cuándo se lo espera al cliente. Es la "hora de reserva" que se
  -- muestra en la grilla del salón.
  scheduled_at  timestamptz not null,

  -- Cuánto rato quiere jugar, en minutos. Se guarda en minutos para hablar el
  -- mismo idioma que pool_sell_time y POOL_BLOQUES.
  play_minutes  integer not null check (play_minutes > 0),

  --  reservada → activada  (llegó y se encendió la mesa)
  --            → liberada  (avisó que no viene / se canceló)
  --            → no_show   (no vino ni avisó)
  --            → vencida   (pasó el día sin activarse ni cerrarse)
  status        text not null default 'reservada'
                check (status in
                  ('reservada', 'activada', 'liberada', 'no_show', 'vencida')),

  -- Se completa al activar: la partida real que arrancó a partir de esta
  -- reserva. Si esa partida se borra alguna vez, la reserva queda igual.
  session_id    uuid references public.pool_sessions (id) on delete set null,

  created_by    uuid references public.profiles (id) on delete set null,
  activated_by  uuid references public.profiles (id) on delete set null,
  released_by   uuid references public.profiles (id) on delete set null,

  activated_at  timestamptz,
  released_at   timestamptz,
  created_at    timestamptz not null default now()
);

-- Los `check` de arriba solo corren al CREAR la tabla. Si esta migración ya se
-- aplicó con una versión anterior, `create table if not exists` la saltea y las
-- restricciones quedan viejas. Este bloque las deja al día en cualquier caso.
alter table public.pool_reservations
  drop constraint if exists pool_reservations_status_check,
  add  constraint pool_reservations_status_check
       check (status in
         ('reservada', 'activada', 'liberada', 'no_show', 'vencida'));

-- El del celular puede fallar si hay filas viejas con otro formato: normalizalas
-- (09 + 7 dígitos) antes de volver a correr esto.
alter table public.pool_reservations
  drop constraint if exists pool_reservations_phone_check,
  add  constraint pool_reservations_phone_check
       check (phone ~ '^09[0-9]{7}$');

-- Dos turnos vigentes con la misma mesa a la misma hora exacta es un error de
-- carga. Solapamientos parciales NO se bloquean acá: los avisa la pantalla,
-- porque en la práctica los clientes se atrasan y adelantan.
create unique index if not exists pool_reservations_sin_choque
  on public.pool_reservations (table_id, scheduled_at)
  where status in ('reservada', 'activada');

-- La cola por mesa: lo que lee la pantalla del salón.
create index if not exists pool_reservations_cola_idx
  on public.pool_reservations (table_id, scheduled_at)
  where status = 'reservada';

-- El listado del día para administración.
create index if not exists pool_reservations_dia_idx
  on public.pool_reservations (scheduled_at desc);

-- =============================================================================
--  2. Crear una reserva
--
--  Valida que la mesa sea de pool y esté en servicio, y que los minutos no se
--  pasen del tope de esa mesa (el mismo tope que usa una venta suelta).
-- =============================================================================
create or replace function public.pool_reserve(
  p_table_id     uuid,
  p_customer     text,
  p_phone        text,
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
  if not public.is_admin() then
    raise exception 'Sólo administración puede crear reservas de pool';
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
  if coalesce(trim(p_phone), '') = '' then
    raise exception 'Falta el celular del cliente';
  end if;
  -- Llega ya normalizado desde la app (09 + 7 dígitos). Si algún cliente de la
  -- API lo manda torcido, corta acá con un mensaje claro y no con el check.
  if trim(p_phone) !~ '^09[0-9]{7}$' then
    raise exception 'El celular tiene que ser un celular uruguayo (09XXXXXXX)';
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
    (table_id, customer_name, phone, scheduled_at, play_minutes, created_by)
  values
    (p_table_id, trim(p_customer), trim(p_phone), p_scheduled_at, p_minutes, auth.uid())
  returning * into v_reservation;

  return v_reservation;
exception
  when unique_violation then
    raise exception 'Ya hay una reserva para esa mesa a esa hora';
end;
$$;

-- =============================================================================
--  3. Activar una reserva
--
--  Llega el cliente y alguien la enciende a mano. Arranca una partida con los
--  minutos de la reserva (o los que se pasen, por si compran otra cosa), la
--  engancha y deja el nombre del cliente como jugador uno si la partida recién
--  nace en blanco.
--
--  No se activa sobre una mesa que ya tiene partida: para eso está "comprar más
--  tiempo" en el panel. Acá se empieza de cero.
-- =============================================================================
create or replace function public.pool_reservation_activate(
  p_id      uuid,
  p_minutes integer default null
)
returns public.pool_reservations
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_reservation public.pool_reservations;
  v_session     public.pool_sessions;
  v_minutos     integer;
begin
  if not public.is_admin() then
    raise exception 'Sólo administración puede activar reservas de pool';
  end if;

  select * into v_reservation
    from public.pool_reservations
   where id = p_id
   for update;

  if v_reservation.id is null then
    raise exception 'La reserva no existe';
  end if;
  if v_reservation.status <> 'reservada' then
    raise exception 'Esa reserva ya no está pendiente';
  end if;

  if exists (
    select 1 from public.pool_sessions
     where table_id = v_reservation.table_id and status = 'activa'
  ) then
    raise exception 'La mesa ya tiene una partida en curso';
  end if;

  v_minutos := coalesce(p_minutes, v_reservation.play_minutes);

  -- Todo el peso de vender tiempo (abrir cuenta, cargar la línea, crear la
  -- partida, registrar la compra) lo hace este RPC.
  v_session := public.pool_sell_time(v_reservation.table_id, v_minutos);

  update public.pool_sessions
     set player_one = v_reservation.customer_name
   where id = v_session.id
     and player_one is null;

  update public.pool_reservations
     set status       = 'activada',
         session_id   = v_session.id,
         activated_by = auth.uid(),
         activated_at = now()
   where id = v_reservation.id
  returning * into v_reservation;

  return v_reservation;
end;
$$;

-- =============================================================================
--  4. Sacar una reserva de la cola
--
--  Dos motivos, que se registran distinto para poder medir después:
--    · liberada — el cliente avisó que no viene, o se canceló.
--    · no_show  — no vino ni avisó.
-- =============================================================================
create or replace function public.pool_reservation_release(
  p_id      uuid,
  p_no_show boolean default false
)
returns public.pool_reservations
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_reservation public.pool_reservations;
begin
  if not public.is_admin() then
    raise exception 'Sólo administración puede liberar reservas de pool';
  end if;

  select * into v_reservation
    from public.pool_reservations
   where id = p_id
   for update;

  if v_reservation.id is null then
    raise exception 'La reserva no existe';
  end if;
  if v_reservation.status <> 'reservada' then
    raise exception 'Sólo se puede liberar una reserva pendiente';
  end if;

  update public.pool_reservations
     set status      = case when p_no_show then 'no_show' else 'liberada' end,
         released_by  = auth.uid(),
         released_at  = now()
   where id = v_reservation.id
  returning * into v_reservation;

  return v_reservation;
end;
$$;

-- =============================================================================
--  5. Vencer lo que quedó sin activar
--
--  Nadie corre una tarea programada acá. Las reservas de días pasados que nunca
--  se activaron ni se liberaron las cierra quien pase por las pantallas. Como
--  sólo toca lo que quedó de ayer para atrás, llamarla de más no hace nada.
-- =============================================================================
create or replace function public.pool_reservations_expire_due()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vencidas integer;
begin
  -- El "día" es en hora de Montevideo, igual que en los reportes: si no, el
  -- corte caería a las 21:00 y una reserva de anoche se vencería sola.
  with vencidas as (
    update public.pool_reservations
       set status = 'vencida'
     where status = 'reservada'
       and (scheduled_at at time zone 'America/Montevideo')::date
           < (now() at time zone 'America/Montevideo')::date
    returning 1
  )
  select count(*) into v_vencidas from vencidas;

  return v_vencidas;
end;
$$;

-- =============================================================================
--  6. El listado del día
--
--  Lo que consume la página de administración y, agrupado por mesa en el
--  cliente, la cola de la pantalla del salón y el panel. Trae el número de mesa
--  y los nombres de quién hizo cada cosa, ya resueltos.
-- =============================================================================
create or replace function public.pool_day_reservations(
  p_date date default (now() at time zone 'America/Montevideo')::date
)
returns table (
  id                uuid,
  table_id          uuid,
  table_number      integer,
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

-- =============================================================================
--  7. ROW LEVEL SECURITY
--
--  El personal mira (lo necesita la pantalla del salón). Sólo administración
--  escribe: crear, activar y liberar pasan por is_admin().
-- =============================================================================
alter table public.pool_reservations enable row level security;

drop policy if exists "pool_reservations_staff_read" on public.pool_reservations;
create policy "pool_reservations_staff_read"
  on public.pool_reservations for select
  to authenticated
  using (public.is_staff());

drop policy if exists "pool_reservations_admin_write" on public.pool_reservations;
create policy "pool_reservations_admin_write"
  on public.pool_reservations for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- =============================================================================
--  8. REALTIME
--
--  Que la pantalla del salón y el panel se enteren de una reserva nueva, o de
--  que se activó o se liberó, sin preguntar.
-- =============================================================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and tablename = 'pool_reservations'
  ) then
    alter publication supabase_realtime add table public.pool_reservations;
  end if;
end
$$;
