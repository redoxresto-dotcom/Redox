-- =============================================================================
--  POS VENTA — Punta Carretas
--  Migración 012: el estado «entregado» y el pedido completo
--
--  Ejecutar DESPUÉS de 011_estaciones_usuario.sql, en:
--    Supabase Dashboard → SQL Editor → New query → Run
--  Es idempotente.
--
--  La cadena pasa a tener cuatro estados:
--
--    pedido → preparando → listo → entregado
--            └ la estación ────┘   └ el mozo ┘
--
--  «listo» dejó de significar "terminado": significa que está pronto sobre la
--  barra esperando que alguien lo lleve. Sin ese corte, el cartel de pedido
--  completo no se apaga nunca y la mesa queda pronta para siempre.
--
--  Y deja un dato que hoy no existe: cuánto tarda un plato entre que está
--  pronto y que llega a la mesa. Es la comida que se enfría esperando al mozo.
-- =============================================================================

-- =============================================================================
--  1. El estado nuevo
-- =============================================================================
alter table public.order_items drop constraint if exists order_items_status_check;
alter table public.order_items
  add constraint order_items_status_check
  check (status in ('pedido', 'preparando', 'listo', 'entregado'));

alter table public.order_items
  add column if not exists delivered_at timestamptz,
  add column if not exists delivered_by uuid references public.profiles (id) on delete set null;

-- Lo que ya estaba vendido y cobrado se da por entregado: si no, todas las
-- cuentas viejas aparecerían esperando que alguien las lleve a la mesa.
--
-- Sin fecha de entrega, a propósito. Ver la nota del final: de esas líneas no
-- sabemos cuándo llegaron a la mesa, y cualquier fecha que les pongamos es un
-- número inventado que después se lee como si fuera una medición.
update public.order_items oi
   set status = 'entregado'
  from public.orders o
 where o.id = oi.order_id
   and o.status = 'cobrada'
   and oi.status = 'listo';

-- Lo pendiente de entregar, que es lo que mira el salón.
create index if not exists order_items_por_entregar_idx
  on public.order_items (order_id)
  where status = 'listo';

-- =============================================================================
--  2. Sellos de cada avance
--
--  Reemplaza la versión de la 004: agrega 'entregado' y conserva el resto.
-- =============================================================================
create or replace function public.fn_order_item_status_stamps()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'preparando' then
      new.started_at := coalesce(new.started_at, now());
      new.started_by := coalesce(new.started_by, auth.uid());
      -- Volver de 'listo' a 'preparando' es deshacer: se borra el sello.
      new.ready_at     := null;
      new.ready_by     := null;
      new.delivered_at := null;
      new.delivered_by := null;

    elsif new.status = 'listo' then
      new.ready_at := now();
      new.ready_by := coalesce(auth.uid(), new.ready_by);
      -- Desmarcar una entrega devuelve la línea a la barra.
      new.delivered_at := null;
      new.delivered_by := null;

    elsif new.status = 'entregado' then
      new.delivered_at := now();
      new.delivered_by := coalesce(auth.uid(), new.delivered_by);
      -- ready_at NO se inventa. Si la línea nunca pasó por 'listo' —porque se
      -- cobró la mesa con la comanda a medias— no hay tiempo de entrega que
      -- medir, y rellenarlo con now() metería una entrega de cero minutos que
      -- baja el promedio del reporte sin que haya pasado nada bueno.

    elsif new.status = 'pedido' then
      new.started_at   := null;
      new.started_by   := null;
      new.ready_at     := null;
      new.ready_by     := null;
      new.delivered_at := null;
      new.delivered_by := null;
    end if;
  end if;

  return new;
end;
$$;

-- =============================================================================
--  3. Lo que no pasa por una estación nace entregado
--
--  Reemplaza la versión de la 004. La hora de pool no la prepara nadie y nadie
--  la lleva a la mesa: si naciera 'listo', dejaría la mesa reclamando una
--  entrega que no existe.
-- =============================================================================
create or replace function public.fn_order_item_station()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_station text;
begin
  select p.station into v_station
    from public.products p
   where p.id = new.product_id;

  new.station := coalesce(v_station, 'barra');

  if new.station = 'ninguna' then
    new.status       := 'entregado';
    new.ready_at     := coalesce(new.ready_at, now());
    new.delivered_at := coalesce(new.delivered_at, now());
  end if;

  return new;
end;
$$;

-- Las líneas sin estación que quedaron en 'listo' de antes.
update public.order_items
   set status       = 'entregado',
       delivered_at = coalesce(delivered_at, ready_at, created_at)
 where station = 'ninguna'
   and status = 'listo';

-- =============================================================================
--  3 bis. Las entregas que nadie midió no tienen fecha
--
--  El relleno de arriba marcó como entregado todo lo que estaba en cuentas ya
--  cobradas. De esas líneas no sabemos cuándo llegaron a la mesa: el estado no
--  existía cuando se sirvieron.
--
--  Ponerles `delivered_at = ready_at` —como hacía la primera versión de esta
--  migración— le mete al reporte una entrega de CERO minutos por cada una, y
--  eso se lee como "entregamos al instante". Ponerles `now()` es igual de
--  falso al revés: esperas de días. Van sin fecha y quedan fuera del reporte.
--
--  Se reconocen porque no tienen responsable: las entregas de verdad guardan
--  quién las hizo.
-- =============================================================================
update public.order_items oi
   set delivered_at = null
  from public.orders o
 where o.id = oi.order_id
   and o.status = 'cobrada'
   and oi.delivered_by is null
   and oi.delivered_at is not null;

-- =============================================================================
--  4. Cobrar da por entregado lo que quedaba
--
--  Se puede cobrar una mesa con comandas sin marcar: pasa cuando la cocina se
--  olvida de tocar «listo» y el cliente igual pagó y se fue. Esas líneas
--  quedaban colgadas en 'pedido' para siempre dentro de una cuenta cerrada.
--
--  Reemplaza la versión de la 005: agrega el cierre de comandas y conserva el
--  medio de pago y el turno.
-- =============================================================================
create or replace function public.close_table_order(
  p_order_id       uuid,
  p_payment_method text
)
returns public.orders
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_order    public.orders;
  v_shift_id uuid;
begin
  if p_payment_method is null or p_payment_method not in
     ('efectivo', 'debito', 'credito', 'transferencia', 'otro') then
    raise exception 'Medio de pago inválido: %', p_payment_method;
  end if;

  select id into v_shift_id
    from public.cash_shifts
   where closed_at is null
   limit 1;

  if v_shift_id is null then
    raise exception 'No hay un turno de caja abierto';
  end if;

  update public.orders
     set status         = 'cobrada',
         closed_at      = now(),
         closed_by      = auth.uid(),
         payment_method = p_payment_method,
         shift_id       = v_shift_id
   where id = p_order_id and status = 'abierta'
  returning * into v_order;

  if v_order.id is null then
    raise exception 'La cuenta % no existe o ya fue cobrada', p_order_id;
  end if;

  -- Si se cobró, se sirvió. Lo que la estación no llegó a marcar se cierra acá
  -- para que no quede una comanda viva dentro de una cuenta cerrada.
  update public.order_items
     set status = 'entregado'
   where order_id = v_order.id
     and status <> 'entregado';

  update public.tables
     set status = 'libre', assigned_waiter = null
   where id = v_order.table_id;

  update public.alerts
     set status = 'resuelta', resolved_by = auth.uid()
   where table_id = v_order.table_id and status = 'pendiente';

  return v_order;
end;
$$;

-- Las que ya quedaron colgadas de antes.
update public.order_items oi
   set status = 'entregado'
  from public.orders o
 where o.id = oi.order_id
   and o.status = 'cobrada'
   and oi.status <> 'entregado';

-- =============================================================================
--  5. Cuánto tarda un plato entre que está pronto y que llega a la mesa
--
--  El promedio y la peor espera del período, abierto por estación. Es el dato
--  que justifica el estado: mide la comida que se enfría en la barra.
-- =============================================================================
create or replace function public.report_delivery_times(
  p_from timestamptz,
  p_to   timestamptz
)
returns table (
  station      text,
  entregas     bigint,
  promedio_min numeric,
  peor_min     numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    oi.station,
    count(*)::bigint as entregas,
    round(avg(extract(epoch from (oi.delivered_at - oi.ready_at)) / 60)::numeric, 1)
      as promedio_min,
    round(max(extract(epoch from (oi.delivered_at - oi.ready_at)) / 60)::numeric, 1)
      as peor_min
  from public.order_items oi
  join public.orders o on o.id = oi.order_id
  where oi.station <> 'ninguna'
    and oi.delivered_at is not null
    and oi.ready_at is not null
    and oi.delivered_at >= p_from
    and oi.delivered_at <  p_to
    and o.status = 'cobrada'
  group by oi.station
  order by oi.station;
$$;
