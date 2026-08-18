-- =============================================================================
--  POS VENTA — Punta Carretas
--  Migración 006: reportes de venta
--
--  Ejecutar DESPUÉS de 005_caja.sql, en:
--    Supabase Dashboard → SQL Editor → New query → Run
--  Es idempotente.
--
--  Todo agregado en la base. Traer las líneas crudas al servidor para sumarlas
--  en JavaScript funciona el primer mes y se cae solo el día que el bar lleve
--  un año de ventas.
--
--  Alcance: son reportes de VENTA. No calculan rentabilidad por trago aunque el
--  costo esté guardado, porque el costo del catálogo es el que cargó el
--  encargado a mano, no el de la última compra al proveedor. Eso llega con el
--  módulo de stock.
--
--  El período se filtra por closed_at: la venta cuenta cuando se cobró.
-- =============================================================================

-- Todo lo horario se calcula en hora de Montevideo. Si no, una venta de la
-- 1 de la mañana del sábado aparece como domingo en UTC y el reporte por día
-- de la semana miente justo en la franja que más factura.

-- =============================================================================
--  1. Resumen del período
-- =============================================================================
create or replace function public.report_summary(
  p_from timestamptz,
  p_to   timestamptz
)
returns table (
  tickets      bigint,
  total        numeric,
  ticket_avg   numeric,
  items_units  bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    count(*)::bigint                                        as tickets,
    coalesce(sum(o.total), 0)                               as total,
    case when count(*) = 0 then 0
         else round(coalesce(sum(o.total), 0) / count(*), 2)
    end                                                     as ticket_avg,
    coalesce((
      select sum(oi.quantity)
        from public.order_items oi
       where oi.order_id in (
         select o2.id from public.orders o2
          where o2.status = 'cobrada'
            and o2.closed_at >= p_from and o2.closed_at < p_to
       )
    ), 0)::bigint                                           as items_units
  from public.orders o
  where o.status = 'cobrada'
    and o.closed_at >= p_from and o.closed_at < p_to;
$$;

-- =============================================================================
--  2. Venta por medio de pago
-- =============================================================================
create or replace function public.report_by_payment(
  p_from timestamptz,
  p_to   timestamptz
)
returns table (
  payment_method text,
  tickets        bigint,
  total          numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    coalesce(o.payment_method, 'otro') as payment_method,
    count(*)::bigint                   as tickets,
    coalesce(sum(o.total), 0)          as total
  from public.orders o
  where o.status = 'cobrada'
    and o.closed_at >= p_from and o.closed_at < p_to
  group by 1
  order by 3 desc;
$$;

-- =============================================================================
--  3. Venta por producto — el ranking sale de acá, ordenando por unidades
-- =============================================================================
create or replace function public.report_by_product(
  p_from timestamptz,
  p_to   timestamptz
)
returns table (
  product_id uuid,
  name       text,
  category   text,
  station    text,
  units      bigint,
  total      numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    p.id                              as product_id,
    p.name                            as name,
    p.category                        as category,
    p.station                         as station,
    sum(oi.quantity)::bigint          as units,
    coalesce(sum(oi.subtotal), 0)     as total
  from public.order_items oi
  join public.orders   o on o.id = oi.order_id
  join public.products p on p.id = oi.product_id
  where o.status = 'cobrada'
    and o.closed_at >= p_from and o.closed_at < p_to
  group by p.id, p.name, p.category, p.station
  order by units desc, total desc;
$$;

-- =============================================================================
--  4. Venta por franja horaria (0–23, hora de Montevideo)
-- =============================================================================
create or replace function public.report_by_hour(
  p_from timestamptz,
  p_to   timestamptz
)
returns table (
  hour    int,
  tickets bigint,
  total   numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    extract(hour from (o.closed_at at time zone 'America/Montevideo'))::int as hour,
    count(*)::bigint          as tickets,
    coalesce(sum(o.total), 0) as total
  from public.orders o
  where o.status = 'cobrada'
    and o.closed_at >= p_from and o.closed_at < p_to
  group by 1
  order by 1;
$$;

-- =============================================================================
--  5. Venta por día de la semana (1 = lunes … 7 = domingo)
-- =============================================================================
create or replace function public.report_by_weekday(
  p_from timestamptz,
  p_to   timestamptz
)
returns table (
  weekday int,
  tickets bigint,
  total   numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    extract(isodow from (o.closed_at at time zone 'America/Montevideo'))::int as weekday,
    count(*)::bigint          as tickets,
    coalesce(sum(o.total), 0) as total
  from public.orders o
  where o.status = 'cobrada'
    and o.closed_at >= p_from and o.closed_at < p_to
  group by 1
  order by 1;
$$;

-- =============================================================================
--  6. Venta por día — la serie que se exporta para el contador
-- =============================================================================
create or replace function public.report_by_day(
  p_from timestamptz,
  p_to   timestamptz
)
returns table (
  day           date,
  tickets       bigint,
  total         numeric,
  efectivo      numeric,
  debito        numeric,
  credito       numeric,
  transferencia numeric,
  otro          numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    (o.closed_at at time zone 'America/Montevideo')::date as day,
    count(*)::bigint                                      as tickets,
    coalesce(sum(o.total), 0)                             as total,
    coalesce(sum(o.total) filter (where o.payment_method = 'efectivo'), 0)      as efectivo,
    coalesce(sum(o.total) filter (where o.payment_method = 'debito'), 0)        as debito,
    coalesce(sum(o.total) filter (where o.payment_method = 'credito'), 0)       as credito,
    coalesce(sum(o.total) filter (where o.payment_method = 'transferencia'), 0) as transferencia,
    coalesce(sum(o.total) filter (where o.payment_method is null
                                     or o.payment_method = 'otro'), 0)          as otro
  from public.orders o
  where o.status = 'cobrada'
    and o.closed_at >= p_from and o.closed_at < p_to
  group by 1
  order by 1;
$$;
