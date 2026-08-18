-- =============================================================================
--  POS VENTA — Punta Carretas
--  Migración 011: usuarios de barra y de cocina
--
--  Ejecutar DESPUÉS de 010_mesas_mozo.sql, en:
--    Supabase Dashboard → SQL Editor → New query → Run
--  Es idempotente.
--
--  Hasta acá la cocina entraba con un usuario de mozo, que es lo que hacía
--  imposible filtrar mesas por dueño: el mismo nivel necesitaba ver todas las
--  mesas para la pantalla de comandas y solo las suyas para el salón.
--
--  Con usuarios propios cada uno hace una cosa sola:
--
--    barra / cocina  →  su pantalla de comandas, con TODAS las mesas
--    mozo            →  el salón, con las mesas libres y las suyas
--
--  'barra' y 'cocina' NO son un escalón más de la jerarquía: son otro trabajo.
--  Por eso pesan lo mismo que un mozo —rango 1, sin mando sobre nadie— y lo
--  único que cambia es a qué pantalla entran.
-- =============================================================================

-- =============================================================================
--  1. Los roles nuevos
-- =============================================================================
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('mozo', 'barra', 'cocina', 'admin', 'gerente'));

-- =============================================================================
--  2. Rango
--
--  Los tres de abajo valen 1: ninguno manda sobre otro. El encargado (2) y el
--  gerente (3) siguen mandando sobre los tres.
-- =============================================================================
create or replace function public.role_rank(p_role text)
returns integer
language sql
immutable
parallel safe
as $$
  select case p_role
           when 'gerente' then 3
           when 'admin'   then 2
           when 'mozo'    then 1
           when 'barra'   then 1
           when 'cocina'  then 1
           else 0
         end;
$$;

-- =============================================================================
--  3. La estación de cada usuario
--
--  Devuelve 'barra' o 'cocina' para quien tiene ese rol, y null para el resto.
--  Se usa para mandar a cada uno a su pantalla al entrar.
-- =============================================================================
create or replace function public.my_station()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case p.role when 'barra' then 'barra' when 'cocina' then 'cocina' end
    from public.profiles p
   where p.id = auth.uid() and p.active;
$$;

-- =============================================================================
--  4. El alta automática acepta los roles nuevos
--
--  Sin esto, un usuario creado como 'cocina' entraba como mozo y terminaba
--  mirando un salón que no le sirve.
-- =============================================================================
create or replace function public.fn_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  if not exists (select 1 from public.profiles) then
    v_role := 'gerente';
  else
    v_role := coalesce(new.raw_user_meta_data ->> 'role', 'mozo');
    if v_role not in ('mozo', 'barra', 'cocina', 'admin', 'gerente') then
      v_role := 'mozo';
    end if;
  end if;

  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
      split_part(new.email, '@', 1)
    ),
    v_role
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

-- =============================================================================
--  5. Una mesa no se le pasa a la cocina
--
--  El trigger de la 010 ya exigía que el destino fuera personal activo; ahora
--  además exige que atienda mesas. Transferirle una mesa a la barra dejaría la
--  cuenta a nombre de alguien que no va a ir a buscarla.
--
--  Y ese control pasa ANTES del corte por "no hay usuario detrás": que una mesa
--  esté a nombre de alguien que la pueda atender no es un permiso, es una regla
--  del dato. Tiene que valer también para un script o para el editor SQL.
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
  if new.assigned_waiter is not distinct from old.assigned_waiter then
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
    return new;
  end if;

  raise exception 'La mesa está tomada por otro mozo';
end;
$$;

-- =============================================================================
--  6. Nadie deja mesas huérfanas al cambiar de puesto
--
--  Pasar un mozo a cocina, o darlo de baja, mientras tiene mesas a su nombre
--  las dejaba a nombre de alguien que ya no las va a atender: no aparecen en el
--  salón de nadie —no están libres— ni en «Mis mesas» de nadie.
--
--  Reemplaza la versión de la 009: agrega este control y conserva todo lo de
--  la jerarquía.
-- =============================================================================
create or replace function public.fn_profiles_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor  uuid    := auth.uid();
  v_rank   integer := public.my_rank();
  v_mesas  integer;
begin
  -- --- Regla del dato: vale siempre --------------------------------------
  if tg_op = 'UPDATE'
     and (
       (new.role <> old.role and new.role in ('barra', 'cocina'))
       or (old.active and not new.active)
     )
  then
    select count(*) into v_mesas
      from public.tables t
     where t.assigned_waiter = old.id;

    if v_mesas > 0 then
      raise exception
        'Tiene % mesa(s) a su nombre: hay que transferirlas antes de sacarlo del salón',
        v_mesas;
    end if;
  end if;

  -- --- Permisos: solo si hay alguien operando ----------------------------
  if v_actor is null then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    if old.id = v_actor then
      raise exception 'No podés borrar tu propio usuario';
    end if;
    if v_rank <= public.role_rank(old.role) then
      raise exception 'Solo se puede dar de baja a alguien de nivel inferior al propio';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if v_rank <= public.role_rank(new.role) then
      raise exception 'No podés crear un usuario de tu mismo nivel o superior';
    end if;
    return new;
  end if;

  if new.role is distinct from old.role then
    if new.id = v_actor then
      raise exception 'No podés cambiarte el rol a vos mismo';
    end if;
    if v_rank <= public.role_rank(old.role) or v_rank <= public.role_rank(new.role) then
      raise exception 'Solo se puede cambiar el rol de alguien de nivel inferior, y a un nivel inferior al propio';
    end if;
  end if;

  if new.active is distinct from old.active
     and new.id <> v_actor
     and v_rank <= public.role_rank(old.role) then
    raise exception 'Solo se puede activar o desactivar a alguien de nivel inferior al propio';
  end if;

  return new;
end;
$$;
