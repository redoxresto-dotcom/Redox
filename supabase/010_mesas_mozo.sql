-- =============================================================================
--  POS VENTA — Punta Carretas
--  Migración 010: quién puede tomar, transferir y soltar una mesa
--
--  Ejecutar DESPUÉS de 009_gerente.sql, en:
--    Supabase Dashboard → SQL Editor → New query → Run
--  Es idempotente.
--
--  Reglas de la operación:
--
--    · El mozo toma una mesa libre, y la toma para sí mismo.
--    · Una mesa tomada por otro mozo no se le puede sacar.
--    · El mozo NO suelta mesas: si termina el turno, la TRANSFIERE a otro.
--    · Soltar una mesa —dejarla sin dueño— es del encargado.
--    · Cobrar libera la mesa, y eso lo puede hacer cualquiera del personal:
--      el cliente quiere pagar y no siempre está el mozo que lo atendió.
--
--  El filtro de qué mesas ve cada uno vive en la pantalla y no acá: las
--  pantallas de barra y cocina necesitan leer todas las mesas para mostrar el
--  número de cada comanda, y quien opera la cocina entra con nivel mozo.
-- =============================================================================

-- =============================================================================
--  1. El trigger que gobierna la asignación
-- =============================================================================
create or replace function public.fn_tables_guard_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid    := auth.uid();
  v_rank  integer := public.my_rank();
begin
  -- Sin usuario detrás (service_role, editor SQL) no se aplica.
  if v_actor is null then
    return new;
  end if;

  -- Si la asignación no cambia, no hay nada que revisar.
  if new.assigned_waiter is not distinct from old.assigned_waiter then
    return new;
  end if;

  -- Quien recibe la mesa tiene que ser personal activo. Vale para todos: una
  -- mesa a nombre de alguien dado de baja no la ve nadie en su lista.
  if new.assigned_waiter is not null
     and not exists (
       select 1 from public.profiles p
        where p.id = new.assigned_waiter and p.active
     ) then
    raise exception 'La mesa solo se puede asignar a alguien del personal activo';
  end if;

  -- Encargado y gerente mueven mesas sin restricción.
  if v_rank >= 2 then
    return new;
  end if;

  -- --- De acá para abajo, mozo -------------------------------------------
  if new.assigned_waiter is null then
    -- Cobrar libera la mesa: la misma sentencia la pasa a 'libre'. Es la única
    -- forma en que un mozo deja una mesa sin dueño.
    if new.status = 'libre' and old.status = 'ocupada' then
      return new;
    end if;

    raise exception 'Soltar una mesa es del encargado. Si terminás el turno, transferila a otro mozo.';
  end if;

  if old.assigned_waiter is null then
    if new.assigned_waiter <> v_actor then
      raise exception 'Una mesa libre solo la podés tomar para vos';
    end if;
    return new;
  end if;

  if old.assigned_waiter = v_actor then
    -- Transferencia: la mesa es suya y la entrega.
    return new;
  end if;

  raise exception 'La mesa está tomada por otro mozo';
end;
$$;

drop trigger if exists trg_tables_guard_assignment on public.tables;
create trigger trg_tables_guard_assignment
  before update of assigned_waiter on public.tables
  for each row execute function public.fn_tables_guard_assignment();

-- =============================================================================
--  2. Soltar una mesa abierta por error: del encargado
--
--  Pasa a ser un RPC en vez de un update suelto. Es la operación que borra una
--  cuenta, así que conviene que la regla —y el borrado— vivan juntos y en la
--  base, no repartidos entre la pantalla y una policy.
-- =============================================================================
create or replace function public.release_table(p_table_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_order_id uuid;
  v_items    integer;
begin
  if not public.is_admin() then
    raise exception 'Soltar una mesa sin cobrar es del encargado';
  end if;

  select o.id into v_order_id
    from public.orders o
   where o.table_id = p_table_id and o.status = 'abierta'
   limit 1;

  if v_order_id is not null then
    select count(*) into v_items
      from public.order_items oi
     where oi.order_id = v_order_id;

    if v_items > 0 then
      raise exception 'La mesa tiene consumos: hay que cobrarla, no liberarla';
    end if;

    -- La cuenta vacía se borra en vez de cobrarse en $0, para no dejar tickets
    -- fantasma en el histórico de ventas.
    delete from public.orders where id = v_order_id;
  end if;

  update public.tables
     set status = 'libre', assigned_waiter = null
   where id = p_table_id;
end;
$$;
