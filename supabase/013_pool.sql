-- =============================================================================
--  NexoRestUy — Redox, Punta Carretas
--  Migración 013: mesas de pool con tiempo prepago
--
--  Ejecutar DESPUÉS de 012_entregado.sql, en:
--    Supabase Dashboard → SQL Editor → New query → Run
--  Es idempotente.
--
--  Modelo: se VENDE TIEMPO y la mesa se apaga sola al terminarse.
--
--    se vende 1 hora → la mesa se habilita → cuenta regresiva en pantalla
--    → aviso a los 5 minutos → se cumple el plazo y la mesa se apaga
--
--  No hay tarjetas. Quien habilita la mesa es alguien del personal desde el
--  panel, y el aparato de la mesa obedece.
--
--  --------------------------------------------------------------------------
--  Cómo se entera la mesa
--
--  El servidor no puede llamar al ESP32: está detrás del router del bar, sin
--  IP pública. Así que es al revés — el aparato PREGUNTA cada pocos segundos
--  "¿hasta cuándo habilito?" y guarda la hora de corte que le contestan.
--
--  Eso tiene dos consecuencias que este esquema toma en serio:
--
--    · La hora de corte (`ends_at`) es el dato importante, no un contador.
--      El aparato y cada pantalla calculan cuánto falta por su cuenta, así que
--      si se cae el WiFi la partida sigue y termina bien igual.
--
--    · La misma pregunta sirve de latido. Si un lector deja de preguntar, se
--      sabe que está muerto sin esperar a que se queje un cliente.
--  --------------------------------------------------------------------------
-- =============================================================================

-- =============================================================================
--  0. Resguardo
--
--  Esta migración rehace `pool_sessions`, que en la 003 era una bitácora de
--  eventos sueltos. Si alguna vez llegó a haber datos reales, mejor frenar y
--  mirarlos antes que perderlos.
-- =============================================================================
do $$
begin
  if to_regclass('public.pool_sessions') is not null
     and exists (select 1 from public.pool_sessions)
  then
    raise exception
      'pool_sessions tiene datos: esta migración la rehace. Revisalos y vaciala a mano antes de correrla.';
  end if;
end
$$;

-- =============================================================================
--  1. POOL_TABLES — qué mesas son de pool
--
--  Extiende `tables` en vez de meterle columnas: una mesa de pool sigue siendo
--  una mesa —está en el plano y tiene su propia cuenta— y además tiene un
--  aparato que la habilita y un paño que se gasta. Tener fila acá es lo que la
--  hace mesa de pool; no hace falta otra bandera.
-- =============================================================================
create table if not exists public.pool_tables (
  table_id  uuid primary key references public.tables (id) on delete cascade,

  -- Identificador del aparato. La firmware manda esto y el sistema resuelve a
  -- qué mesa corresponde: si mañana se cambia un ESP32 quemado, se corrige acá
  -- y no hay que reprogramar nada.
  device_id text not null unique check (length(trim(device_id)) > 0),

  -- A cuántos minutos del final avisar en pantalla.
  warning_minutes integer not null default 5
    check (warning_minutes between 0 and 60),

  -- Tope de una venta suelta. No es una regla de negocio: es el seguro contra
  -- el cero de más al escribir los minutos.
  max_block_minutes integer not null default 240
    check (max_block_minutes between 5 and 1440),

  -- Horas de juego a partir de las cuales avisar que toca cambiar el paño.
  felt_threshold_hours integer not null default 300
    check (felt_threshold_hours > 0),

  -- Último contacto del aparato, y lo que dijo del relé. Sirve para saber si
  -- está vivo y si la mesa quedó realmente habilitada.
  last_seen_at timestamptz,
  relay_on     boolean,

  active     boolean     not null default true,
  created_at timestamptz not null default now()
);

create index if not exists pool_tables_device_idx on public.pool_tables (device_id);

-- =============================================================================
--  2. POOL_SESSIONS — una fila por partida
--
--  `ends_at` es la hora en que la mesa se apaga. Es lo único que necesitan
--  saber el aparato y las pantallas: el tiempo que falta lo calcula cada uno.
--
--  Un contador guardado como número que baja se desincroniza entre pantallas y
--  se pierde al recargar. La hora de corte no.
-- =============================================================================
drop table if exists public.pool_purchases cascade;
drop table if exists public.pool_sessions cascade;

create table public.pool_sessions (
  id         uuid primary key default gen_random_uuid(),
  table_id   uuid not null references public.tables (id) on delete restrict,

  started_at timestamptz not null default now(),
  -- Hora de corte. Se corre hacia adelante cada vez que compran más tiempo.
  ends_at    timestamptz not null,

  status     text not null default 'activa'
             check (status in ('activa', 'terminada', 'cancelada')),

  -- Cuándo terminó de verdad. Coincide con `ends_at` si se dejó correr, y es
  -- anterior si alguien la cortó antes.
  ended_at   timestamptz,
  -- Minutos que la mesa estuvo efectivamente habilitada. Es lo que gasta el
  -- paño, y puede ser menos que lo vendido si se cortó antes.
  minutes_played integer check (minutes_played is null or minutes_played >= 0),

  -- La cuenta de la mesa de pool. Separada de la del salón a propósito: hay
  -- quien viene solo a jugar y no consume nada.
  order_id   uuid references public.orders (id) on delete set null,

  opened_by  uuid references public.profiles (id) on delete set null,
  closed_by  uuid references public.profiles (id) on delete set null,
  closed_by_source text check (
    closed_by_source is null or closed_by_source in ('plazo', 'panel')
  ),

  created_at timestamptz not null default now(),

  constraint pool_sessions_orden check (ends_at >= started_at),
  constraint pool_sessions_fin   check (ended_at is null or ended_at >= started_at)
);

-- Una sola partida activa por mesa. Dos relojes sobre la misma mesa es vender
-- el mismo rato dos veces.
create unique index pool_sessions_una_activa
  on public.pool_sessions (table_id)
  where status = 'activa';

create index pool_sessions_activas_idx
  on public.pool_sessions (ends_at)
  where status = 'activa';

create index pool_sessions_historial_idx
  on public.pool_sessions (table_id, started_at desc);

-- =============================================================================
--  3. POOL_PURCHASES — cada bloque de tiempo vendido
--
--  Una partida puede tener varias compras: se vende una hora y al rato media
--  más. Cada una deja su línea en la cuenta y queda registrada por separado,
--  que es lo que permite responder "yo compré una hora, no hora y media".
-- =============================================================================
create table public.pool_purchases (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references public.pool_sessions (id) on delete cascade,
  table_id      uuid not null references public.tables (id) on delete restrict,
  minutes       integer not null check (minutes > 0),
  amount        numeric(10,2) not null check (amount >= 0),
  order_item_id uuid references public.order_items (id) on delete set null,
  sold_by       uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now()
);

create index pool_purchases_session_idx
  on public.pool_purchases (session_id, created_at);

-- =============================================================================
--  4. POOL_EVENTS — la bitácora cruda del hardware
--
--  Todo lo que manda un aparato queda acá, aunque se rechace: si mañana un
--  ESP32 manda algo raro se puede ver exactamente qué llegó, sin depender de
--  logs que se borran solos.
-- =============================================================================
create table if not exists public.pool_events (
  id         uuid primary key default gen_random_uuid(),
  device_id  text not null,
  event      text not null,
  table_id   uuid references public.tables (id) on delete set null,
  session_id uuid references public.pool_sessions (id) on delete set null,
  rejected   text,
  payload    jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists pool_events_device_idx
  on public.pool_events (device_id, created_at desc);

create index if not exists pool_events_rechazados_idx
  on public.pool_events (created_at desc)
  where rejected is not null;

-- =============================================================================
--  5. POOL_MAINTENANCE — la bitácora del paño
--
--  El paño se gasta por horas jugadas, no por meses. Cada mantenimiento deja
--  registrado con cuántas horas se hizo, y el contador arranca de nuevo.
-- =============================================================================
create table if not exists public.pool_maintenance (
  id       uuid primary key default gen_random_uuid(),
  table_id uuid not null references public.tables (id) on delete cascade,
  kind     text not null default 'paño'
           check (kind in ('paño', 'gomas', 'nivelación', 'otro')),
  done_at  timestamptz not null default now(),
  done_by  uuid references public.profiles (id) on delete set null,
  -- Horas acumuladas al momento del cambio. Se guarda el número: recalcularlo
  -- después obligaría a conservar para siempre cada partida.
  hours_at_change numeric(10,2),
  notes    text,
  created_at timestamptz not null default now()
);

create index if not exists pool_maintenance_tabla_idx
  on public.pool_maintenance (table_id, done_at desc);

-- =============================================================================
--  6. Vender tiempo
--
--  Todo junto y en una sola operación: abre la cuenta de la mesa, carga la
--  línea, crea o estira la partida y deja registrada la compra. Si algo falla,
--  no queda ni media venta hecha.
--
--  La tarifa sale del producto marcado como tarifa de pool, así el encargado
--  la cambia desde el catálogo sin tocar código.
-- =============================================================================
create or replace function public.pool_sell_time(
  p_table_id uuid,
  p_minutes  integer
)
returns public.pool_sessions
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_pool     public.pool_tables;
  v_rate     public.products;
  v_session  public.pool_sessions;
  v_order_id uuid;
  v_item_id  uuid;
  v_amount   numeric(10,2);
  v_desde    timestamptz;
begin
  if not public.is_staff() then
    raise exception 'Solo el personal puede vender tiempo de pool';
  end if;

  select * into v_pool from public.pool_tables where table_id = p_table_id;
  if v_pool.table_id is null then
    raise exception 'Esa mesa no es una mesa de pool';
  end if;
  if not v_pool.active then
    raise exception 'La mesa de pool está fuera de servicio';
  end if;

  if p_minutes is null or p_minutes <= 0 then
    raise exception 'Los minutos tienen que ser un número positivo';
  end if;
  if p_minutes > v_pool.max_block_minutes then
    raise exception 'No se pueden vender más de % minutos de una vez', v_pool.max_block_minutes;
  end if;

  select * into v_rate from public.products where is_pool_rate limit 1;
  if v_rate.id is null then
    raise exception 'No hay ningún producto marcado como tarifa de pool en el catálogo';
  end if;

  v_amount := round((p_minutes::numeric / 60) * v_rate.price, 2);

  -- La cuenta de la mesa de pool, separada de la del salón.
  v_order_id := public.open_table_order(p_table_id);

  insert into public.order_items (order_id, product_id, quantity, unit_price, unit_cost, subtotal)
  values (v_order_id, v_rate.id, 1, v_amount, 0, 0)
  returning id into v_item_id;

  select * into v_session
    from public.pool_sessions
   where table_id = p_table_id and status = 'activa'
   limit 1;

  if v_session.id is null then
    insert into public.pool_sessions (table_id, ends_at, order_id, opened_by)
    values (p_table_id, now() + make_interval(mins => p_minutes), v_order_id, auth.uid())
    returning * into v_session;
  else
    -- Comprar más tiempo estira la partida. Si el plazo ya venció, se cuenta
    -- desde ahora: nadie compra media hora para que arranque en el pasado.
    v_desde := greatest(v_session.ends_at, now());

    update public.pool_sessions
       set ends_at = v_desde + make_interval(mins => p_minutes)
     where id = v_session.id
    returning * into v_session;
  end if;

  insert into public.pool_purchases
    (session_id, table_id, minutes, amount, order_item_id, sold_by)
  values
    (v_session.id, p_table_id, p_minutes, v_amount, v_item_id, auth.uid());

  return v_session;
end;
$$;

-- =============================================================================
--  7. Terminar una partida
--
--  Se llama sola cuando vence el plazo, o a mano desde el panel si el grupo se
--  va antes. El tiempo vendido no se devuelve: se registra cuánto se jugó de
--  verdad, que es lo que gasta el paño.
-- =============================================================================
create or replace function public.pool_end_session(
  p_session_id uuid,
  p_source     text default 'panel'
)
returns public.pool_sessions
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_session public.pool_sessions;
  v_fin     timestamptz;
begin
  if not public.is_staff() then
    raise exception 'Solo el personal puede terminar una partida';
  end if;

  select * into v_session
    from public.pool_sessions
   where id = p_session_id and status = 'activa';

  if v_session.id is null then
    raise exception 'La partida no existe o ya está terminada';
  end if;

  -- Si venció el plazo, terminó cuando venció, no cuando alguien se acordó de
  -- tocar el botón.
  v_fin := least(now(), v_session.ends_at);

  update public.pool_sessions
     set status           = case when p_source = 'plazo' then 'terminada' else 'cancelada' end,
         ended_at         = v_fin,
         -- Ídem: se mide, no se factura. Ver la nota en pool_expire_due().
         minutes_played   = round(extract(epoch from (v_fin - v_session.started_at)) / 60)::integer,
         closed_by        = auth.uid(),
         closed_by_source = case when p_source = 'plazo' then 'plazo' else 'panel' end
   where id = v_session.id
  returning * into v_session;

  return v_session;
end;
$$;

-- =============================================================================
--  7 bis. Cerrar lo que ya venció
--
--  Nadie corre una tarea programada en este sistema. Las partidas vencidas las
--  cierra quien pase por acá: el aparato cuando pregunta, o una pantalla al
--  cargar. Como solo toca lo que YA venció, llamarla de más no hace nada y no
--  hace falta ningún permiso especial para invocarla.
-- =============================================================================
create or replace function public.pool_expire_due()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cerradas integer;
begin
  with vencidas as (
    update public.pool_sessions
       set status           = 'terminada',
           ended_at         = ends_at,
           -- Redondeo al minuto más cercano, no hacia arriba: esto MIDE cuánto
           -- estuvo la mesa encendida para el desgaste del paño, no factura.
           -- Con ceil, cada partida sumaría hasta un minuto de más.
           minutes_played   = round(extract(epoch from (ends_at - started_at)) / 60)::integer,
           closed_by_source = 'plazo'
     where status = 'activa'
       and ends_at <= now()
    returning 1
  )
  select count(*) into v_cerradas from vencidas;

  return v_cerradas;
end;
$$;

-- =============================================================================
--  8. Estado en vivo
--
--  Lo que consumen el panel y la pantalla del salón. Devuelve `ends_at` y no un
--  contador ya calculado: el reloj lo corre cada pantalla, así no hay dos
--  verdades sobre cuánto falta.
-- =============================================================================
create or replace function public.pool_status()
returns table (
  table_id             uuid,
  table_number         integer,
  device_id            text,
  session_id           uuid,
  started_at           timestamptz,
  ends_at              timestamptz,
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
    -- Horas jugadas desde el último cambio de paño.
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
--  9. ROW LEVEL SECURITY
--
--  El personal mira y opera las partidas; el encargado configura las mesas. El
--  aparato entra con service_role —no hay ningún humano del otro lado— y por
--  eso no necesita policies.
-- =============================================================================
alter table public.pool_tables      enable row level security;
alter table public.pool_sessions    enable row level security;
alter table public.pool_purchases   enable row level security;
alter table public.pool_events      enable row level security;
alter table public.pool_maintenance enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'pool_tables', 'pool_sessions', 'pool_purchases', 'pool_events', 'pool_maintenance'
  ] loop
    execute format('drop policy if exists "%s_staff_read" on public.%I', t, t);
    execute format(
      'create policy "%s_staff_read" on public.%I for select to authenticated using (public.is_staff())',
      t, t
    );

    execute format('drop policy if exists "%s_admin_write" on public.%I', t, t);
    execute format(
      'create policy "%s_admin_write" on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())',
      t, t
    );
  end loop;
end
$$;

-- Vender tiempo y cerrar partidas es trabajo de salón, no configuración: los
-- RPC corren con la sesión de quien opera y necesitan poder escribir.
drop policy if exists "pool_sessions_staff_write" on public.pool_sessions;
create policy "pool_sessions_staff_write"
  on public.pool_sessions for all
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

drop policy if exists "pool_purchases_staff_write" on public.pool_purchases;
create policy "pool_purchases_staff_write"
  on public.pool_purchases for all
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());

-- =============================================================================
--  10. REALTIME
--
--  Que las pantallas se enteren de que una mesa arrancó o se apagó sin
--  preguntar cada segundo.
-- =============================================================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and tablename = 'pool_sessions'
  ) then
    alter publication supabase_realtime add table public.pool_sessions;
  end if;

  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and tablename = 'pool_tables'
  ) then
    alter publication supabase_realtime add table public.pool_tables;
  end if;
end
$$;
