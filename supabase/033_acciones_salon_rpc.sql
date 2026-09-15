-- =============================================================================
--  NexoRestUy — Redox, Punta Carretas
--  Migración 033: menos viajes a la base en las acciones del salón
--
--  Ejecutar DESPUÉS de 032_agregar_producto_rpc.sql, en:
--    Supabase Dashboard → SQL Editor → New query → Run
--  Es idempotente.
--
--  Dos cosas se venían pagando en cada toque del mozo/admin/gerente:
--
--  1. Cada acción en app/admin/actions.ts arrancaba con requireStaff() (o
--     requireAdmin()), que hace DOS viajes de red antes de tocar un dato:
--     supabase.auth.getUser() (valida el JWT contra el servidor de Auth) y
--     después un select a profiles. La RLS y los RPC ya son la barrera real
--     de seguridad (ver la migración 020 y el resto de este archivo: todos
--     usan auth.uid() adentro, o comprueban is_admin()/is_staff()), así que
--     ese chequeo del lado de la app era una segunda validación redundante,
--     no la que de verdad protege el dato.
--
--  2. change_order_item_quantity (el +/- de cantidad, lo más tocado de toda
--     la pantalla) hacía un select para leer la línea y después un segundo
--     viaje para insertar/actualizar/borrar. Se junta en un solo RPC, igual
--     que ya se hizo con add_product_to_table en la 032.
--
--  take_table también pasa a RPC: usaba auth.getUser() solo para tener el id
--  y mandarlo como assigned_waiter; el mismo dato ya está en auth.uid() dentro
--  de la base.
-- =============================================================================

create or replace function public.change_order_item_quantity(
  p_item_id uuid,
  p_delta   integer
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_item public.order_items;
  v_next integer;
begin
  select * into v_item from public.order_items where id = p_item_id;

  if v_item.id is null then
    raise exception 'La línea ya no existe';
  end if;

  -- Sumar sobre una línea que la estación ya preparó la dejaría invisible
  -- para la pantalla: la unidad nueva abre su propia comanda, al mismo
  -- precio que el resto de la vuelta.
  if p_delta > 0 and v_item.status <> 'pedido' then
    insert into public.order_items (
      order_id, product_id, quantity, unit_price, unit_cost, subtotal, created_by
    ) values (
      v_item.order_id, v_item.product_id, p_delta,
      v_item.unit_price, v_item.unit_cost, 0, auth.uid()
    );
    return;
  end if;

  v_next := v_item.quantity + p_delta;

  if v_next <= 0 then
    delete from public.order_items where id = p_item_id;
  else
    update public.order_items set quantity = v_next where id = p_item_id;
  end if;
end;
$$;

grant execute on function public.change_order_item_quantity(uuid, integer) to authenticated;

create or replace function public.take_table(p_table_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.tables
     set assigned_waiter = auth.uid()
   where id = p_table_id;
end;
$$;

grant execute on function public.take_table(uuid) to authenticated;

notify pgrst, 'reload schema';
