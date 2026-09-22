-- =============================================================================
--  NexoRestUy — Redox, Punta Carretas
--  Migración 034: el mozo también puede cargar reservas de pool
--
--  Ejecutar DESPUÉS de 033_acciones_salon_rpc.sql, en:
--    Supabase Dashboard → SQL Editor → New query → Run
--  Es idempotente.
--
--  La 022 dejó crear, activar y liberar reservas solo a administración
--  (is_admin). Ahora el mozo también opera la sección Pool desde su propia
--  pantalla —vende tiempo y ve la cola de reservas igual que admin— y necesita
--  poder cargar el turno de un cliente y activarlo cuando llega, sin depender
--  de un encargado. Configurar las mesas de pool (Ajustes: agregar/quitar
--  mesa, tarifa, mantenimiento del paño) sigue siendo de administración: esa
--  parte no se toca acá.
--
--  Mismo patrón que ya usó la 013 con pool_sessions/pool_purchases: la policy
--  de administración queda, se suma una de personal.
-- =============================================================================

-- =============================================================================
--  1. Las funciones: is_admin() → is_staff()
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
  if not public.is_staff() then
    raise exception 'Sólo el personal puede activar reservas de pool';
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
  if not public.is_staff() then
    raise exception 'Sólo el personal puede liberar reservas de pool';
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
--  2. ROW LEVEL SECURITY
--
--  La policy de administración de la 022 queda (por si algo más la necesita),
--  y se suma una de personal: crear, activar y liberar pasan a ser trabajo de
--  salón, igual que vender tiempo o terminar una partida.
-- =============================================================================
drop policy if exists "pool_reservations_staff_write" on public.pool_reservations;
create policy "pool_reservations_staff_write"
  on public.pool_reservations for all
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

notify pgrst, 'reload schema';
