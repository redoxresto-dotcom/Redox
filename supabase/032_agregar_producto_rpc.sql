-- =============================================================================
--  NexoRestUy — Redox, Punta Carretas
--  Migración 032: agrega un producto a la mesa en un solo viaje a la base
--
--  Ejecutar DESPUÉS de 031_ventas_manuales.sql, en:
--    Supabase Dashboard → SQL Editor → New query → Run
--  Es idempotente.
--
--  `addProductToTable` (app/admin/actions.ts) hacía 4 llamadas a Supabase en
--  serie para cargar un consumo: abrir la cuenta, traer el producto, buscar
--  la línea existente y recién ahí insertar o sumar. Cada viaje paga la ida y
--  vuelta completa entre el servidor y la base, así que un simple "+1" tardaba
--  varios cientos de milisegundos. Este RPC hace las cuatro cosas en una sola
--  llamada, igual que ya se hizo con open_table_order/cancel_table_order.
-- =============================================================================

create or replace function public.add_product_to_table(
  p_table_id   uuid,
  p_product_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_order_id     uuid;
  v_product      public.products;
  v_hoy          date := (now() at time zone 'America/Montevideo')::date;
  v_existing_id  uuid;
  v_existing_qty integer;
begin
  v_order_id := public.open_table_order(p_table_id);

  select * into v_product
    from public.products
   where id = p_product_id;

  if v_product.id is null then
    raise exception 'Producto no encontrado';
  end if;

  if v_product.is_combo
     and (
       (v_product.combo_valid_from  is not null and v_product.combo_valid_from  > v_hoy)
       or
       (v_product.combo_valid_until is not null and v_product.combo_valid_until < v_hoy)
     )
  then
    raise exception 'Ese combo está fuera de vigencia';
  end if;

  -- Se suma sobre una línea existente solo si la estación todavía no la tomó.
  -- Si el trago ya está en preparación o servido, la unidad nueva va en una
  -- línea aparte: sumando sobre la vieja, la barra nunca se entera de que le
  -- pidieron otro.
  select id, quantity into v_existing_id, v_existing_qty
    from public.order_items
   where order_id = v_order_id
     and product_id = p_product_id
     and status = 'pedido'
   order by created_at
   limit 1;

  if v_existing_id is not null then
    update public.order_items
       set quantity = v_existing_qty + 1
     where id = v_existing_id;
  else
    insert into public.order_items (
      order_id, product_id, quantity, unit_price, unit_cost, subtotal, created_by
    ) values (
      v_order_id, p_product_id, 1, v_product.price, v_product.cost, 0, auth.uid()
    );
  end if;

  return v_order_id;
end;
$$;

grant execute on function public.add_product_to_table(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
