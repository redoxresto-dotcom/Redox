-- =============================================================================
--  POS VENTA — Punta Carretas
--  Migración 020: reporte de ventas por mozo
--
--  Ejecutar DESPUÉS de 017_cancelar_pedido.sql, en:
--    Supabase Dashboard → SQL Editor → New query → Run
--  Es idempotente.
--
--  Se atribuye la venta a quien ABRIÓ la cuenta (orders.opened_by), no a quien
--  la cobró (closed_by): abrir la mesa es lo que hace el mozo que la atendió,
--  mientras que cobrar muchas veces lo hace el encargado o quien esté en caja.
--  Igual que el resto de los reportes, solo cuenta lo cobrado en el período.
-- =============================================================================

create or replace function public.report_by_waiter(
  p_from timestamptz,
  p_to   timestamptz
)
returns table (
  waiter_id   uuid,
  waiter_name text,
  tickets     bigint,
  total       numeric,
  ticket_avg  numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    o.opened_by                                  as waiter_id,
    coalesce(pr.full_name, 'Sin mozo asignado')   as waiter_name,
    count(*)::bigint                              as tickets,
    coalesce(sum(o.total), 0)                     as total,
    case when count(*) = 0 then 0
         else round(coalesce(sum(o.total), 0) / count(*), 2)
    end                                            as ticket_avg
  from public.orders o
  left join public.profiles pr on pr.id = o.opened_by
  where o.status = 'cobrada'
    and o.closed_at >= p_from and o.closed_at < p_to
  group by o.opened_by, pr.full_name
  order by total desc;
$$;
