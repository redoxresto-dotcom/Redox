-- =============================================================================
--  NexoRestUy — Redox, Punta Carretas
--  Migración 018: cancelar un pedido también es del mozo
--
--  Ejecutar DESPUÉS de 017_cancelar_pedido.sql, en:
--    Supabase Dashboard → SQL Editor → New query → Run
--  Es idempotente.
--
--  La 017 dejó `cancel_table_order` reservada al encargado, igual que
--  `release_table`. En la práctica es el mozo quien está con el cliente
--  cuando se arrepiente o se va, y no siempre hay un encargado a mano para
--  pedírselo. A diferencia de soltar una mesa vacía —que puede tapar una
--  cuenta abierta por error—, acá siempre queda el registro completo: quién
--  canceló, cuándo y el motivo, visible en el reporte de pedidos cancelados.
--  Esa trazabilidad es lo que hace seguro abrirlo a todo el personal.
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
  if not public.is_staff() then
    raise exception 'Cancelar un pedido es del personal';
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
