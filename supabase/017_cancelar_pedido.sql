-- =============================================================================
--  NexoRestUy — Redox, Punta Carretas
--  Migración 017: cancelar un pedido
--
--  Ejecutar DESPUÉS de 016_nombre_mesa.sql, en:
--    Supabase Dashboard → SQL Editor → New query → Run
--  Es idempotente.
--
--  Hasta ahora una cuenta abierta solo tenía dos finales: se cobra, o el
--  encargado la suelta vacía porque se abrió por error (`release_table`).
--  Falta el caso del medio: el cliente pidió, cargó consumo, y por lo que sea
--  —se fue, se arrepintió, no vino nunca la comida que había que servir en el
--  local— no se le cobra. Esa cuenta no puede desaparecer como la vacía: tiene
--  productos reales, algunos ya en camino a la cocina. Se cancela, no se borra:
--  queda en el histórico para que el reporte de cancelados cuente qué se
--  perdió y por qué.
-- =============================================================================

-- =============================================================================
--  1. El estado nuevo y el motivo
-- =============================================================================
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders
  add constraint orders_status_check
  check (status in ('abierta', 'cobrada', 'cancelada'));

alter table public.orders
  add column if not exists cancel_reason text;

alter table public.orders
  drop constraint if exists orders_cancel_reason_length;
alter table public.orders
  add constraint orders_cancel_reason_length check (length(cancel_reason) <= 200);

-- Reportes por período: mismo criterio que orders_cobradas_idx, para cancelada.
create index if not exists orders_canceladas_idx
  on public.orders (closed_at desc)
  where status = 'cancelada';

-- =============================================================================
--  2. RPC: cancelar la cuenta
--
--  Del encargado, igual que soltar una mesa sin cobrar: un mozo que cancela
--  sus propias cuentas podría maquillar ventas que no quiere declarar. La
--  diferencia con `release_table` es que acá SÍ puede haber consumo cargado:
--  no se borra nada, se deja constancia de que se perdió.
-- =============================================================================
create or replace function public.cancel_table_order(
  p_order_id uuid,
  p_reason   text default null
)
returns public.orders
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_order public.orders;
begin
  if not public.is_admin() then
    raise exception 'Cancelar un pedido es del encargado';
  end if;

  update public.orders
     set status        = 'cancelada',
         closed_at     = now(),
         closed_by     = auth.uid(),
         cancel_reason = nullif(trim(left(coalesce(p_reason, ''), 200)), '')
   where id = p_order_id and status = 'abierta'
  returning * into v_order;

  if v_order.id is null then
    raise exception 'La cuenta % no existe o ya fue cerrada', p_order_id;
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

-- =============================================================================
--  3. Reportes: qué se canceló y cuánto representaba
-- =============================================================================
create or replace function public.report_cancelled_summary(
  p_from timestamptz,
  p_to   timestamptz
)
returns table (
  pedidos bigint,
  total   numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    count(*)::bigint          as pedidos,
    coalesce(sum(o.total), 0) as total
  from public.orders o
  where o.status = 'cancelada'
    and o.closed_at >= p_from and o.closed_at < p_to;
$$;

create or replace function public.report_cancelled(
  p_from timestamptz,
  p_to   timestamptz
)
returns table (
  order_id     uuid,
  table_number integer,
  table_name   text,
  total        numeric,
  cancelled_at timestamptz,
  cancelled_by text,
  reason       text
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    o.id          as order_id,
    t.number      as table_number,
    t.name        as table_name,
    o.total       as total,
    o.closed_at   as cancelled_at,
    pr.full_name  as cancelled_by,
    o.cancel_reason as reason
  from public.orders o
  join public.tables t on t.id = o.table_id
  left join public.profiles pr on pr.id = o.closed_by
  where o.status = 'cancelada'
    and o.closed_at >= p_from and o.closed_at < p_to
  order by o.closed_at desc;
$$;
