-- =============================================================================
--  NexoRestUy — Redox, Punta Carretas
--  Migración 028: abrir cuenta de barra sin mozo
--
--  Ejecutar DESPUÉS de 027_barra_mesa_unica.sql, en:
--    Supabase Dashboard → SQL Editor → New query → Run
--  Es idempotente.
--
--  Al cargar la primera bebida, /barra llama a open_table_order, que ponía la
--  mesa a nombre de quien la abre. El usuario "barra" no atiende mesas, así que
--  el guardián de asignación lo rechazaba con:
--    "La mesa solo se puede asignar a alguien activo que atienda mesas".
--
--  La mesa interna de barra no necesita mozo: se autogestiona desde /barra.
--  Esta migración deja que las mesas is_bar queden sin asignar y exime a esas
--  filas del guardián.
-- =============================================================================

-- open_table_order: no toca assigned_waiter en las mesas de barra.
create or replace function public.open_table_order(p_table_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_order_id uuid;
begin
  select id into v_order_id
    from public.orders
   where table_id = p_table_id and status = 'abierta'
   limit 1;

  if v_order_id is null then
    insert into public.orders (table_id, opened_by)
    values (p_table_id, auth.uid())
    returning id into v_order_id;
  end if;

  update public.tables
     set status = 'ocupada',
         assigned_waiter = case
           when is_bar then assigned_waiter
           else coalesce(assigned_waiter, auth.uid())
         end
   where id = p_table_id;

  return v_order_id;
end;
$$;

-- fn_tables_guard_assignment: las mesas de barra no llevan mozo, así que no las
-- alcanza la regla de "tiene que atender mesas". El resto, igual que en la 011.
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
  if new.assigned_waiter is not distinct from old.assigned_waiter then
    return new;
  end if;

  -- Mesa de barra: se autogestiona desde /barra, nunca lleva mozo.
  if coalesce(new.is_bar, false) then
    return new;
  end if;

  -- --- Regla del dato: vale siempre, haya o no usuario detrás -------------
  if new.assigned_waiter is not null
     and not exists (
       select 1 from public.profiles p
        where p.id = new.assigned_waiter
          and p.active
          and p.role in ('mozo', 'admin', 'gerente')
     ) then
    raise exception 'La mesa solo se puede asignar a alguien activo que atienda mesas';
  end if;

  -- --- Permisos: solo si hay alguien operando ----------------------------
  if v_actor is null then
    return new;
  end if;

  if v_rank >= 2 then
    return new;
  end if;

  if new.assigned_waiter is null then
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
    return new;
  end if;

  raise exception 'La mesa está tomada por otro mozo';
end;
$$;
