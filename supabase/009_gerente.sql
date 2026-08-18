-- =============================================================================
--  POS VENTA — Punta Carretas
--  Migración 009: rol gerente y jerarquía de permisos
--
--  Ejecutar DESPUÉS de 008_carta.sql, en:
--    Supabase Dashboard → SQL Editor → New query → Run
--  Es idempotente.
--
--  Tres niveles, de menor a mayor:  mozo (1) < admin (2) < gerente (3).
--
--  La regla es una sola y vale para todo: se manda sobre quien tiene rango
--  ESTRICTAMENTE menor. Un gerente crea, edita y da de baja admins y mozos;
--  un admin, solo mozos; nadie se toca a sí mismo el rol.
--
--  El gerente hereda todo lo del admin sin duplicar una sola policy: is_admin()
--  pasa a preguntar por el rango y no por el nombre del rol, así que las 17
--  reglas que ya la usaban aceptan gerente sin tocarlas.
--
--  --------------------------------------------------------------------------
--  De paso cierra una escalada de privilegios.
--
--  La policy `profiles_update_own_name` dejaba actualizar la fila propia sin
--  restringir columnas —la RLS filtra filas, no columnas—, así que un mozo
--  podía correr `update profiles set role = 'admin' where id = auth.uid()`
--  y ascenderse solo. Ahora el cambio de rol lo gobierna un trigger, que sí
--  puede mirar qué columna cambió.
--  --------------------------------------------------------------------------
-- =============================================================================

-- =============================================================================
--  1. El rol nuevo
-- =============================================================================
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check check (role in ('mozo', 'admin', 'gerente'));

-- =============================================================================
--  2. Rango: el número con el que se comparan los permisos
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
           else 0
         end;
$$;

-- Rango de quien está haciendo la operación. Un usuario inactivo vale 0: dar de
-- baja a alguien le saca todos los permisos sin borrarle el historial.
create or replace function public.my_rank()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select public.role_rank(p.role)
       from public.profiles p
      where p.id = auth.uid() and p.active),
    0
  );
$$;

-- =============================================================================
--  3. Los helpers pasan a ser por rango
--
--  is_admin() sigue llamándose igual a propósito: así las policies y los RPC
--  de las migraciones anteriores aceptan gerente sin editar ninguno.
-- =============================================================================
create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select public.my_rank() >= 1; $$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select public.my_rank() >= 2; $$;

create or replace function public.is_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select public.my_rank() >= 3; $$;

-- =============================================================================
--  4. El trigger que gobierna la jerarquía
--
--  Va en un trigger y no en una policy porque acá sí se puede mirar QUÉ columna
--  cambió: la RLS solo sabe si la fila se puede tocar o no.
-- =============================================================================
create or replace function public.fn_profiles_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_rank  integer := public.my_rank();
begin
  -- Sin usuario detrás (service_role, el editor SQL, el trigger de alta) no se
  -- aplica: es la única forma de crear el primer gerente y de que el sistema
  -- pueda arrancar de cero.
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

  -- UPDATE
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

drop trigger if exists trg_profiles_guard on public.profiles;
create trigger trg_profiles_guard
  before insert or update or delete on public.profiles
  for each row execute function public.fn_profiles_guard();

-- =============================================================================
--  5. Que no quede el sistema sin gerente
--
--  Si el último gerente activo se borra o se degrada, no queda nadie que pueda
--  volver a nombrar uno: habría que entrar por el editor SQL a arreglarlo.
-- =============================================================================
create or replace function public.fn_profiles_keep_manager()
returns trigger
language plpgsql
as $$
begin
  if (tg_op = 'DELETE' and old.role = 'gerente' and old.active)
     or (tg_op = 'UPDATE' and old.role = 'gerente' and old.active
         and (new.role <> 'gerente' or not new.active))
  then
    if not exists (
      select 1 from public.profiles where role = 'gerente' and active
    ) then
      raise exception 'Tiene que quedar al menos un gerente activo';
    end if;
  end if;

  return null;
end;
$$;

drop trigger if exists trg_profiles_keep_manager on public.profiles;
create trigger trg_profiles_keep_manager
  after update or delete on public.profiles
  for each row execute function public.fn_profiles_keep_manager();

-- =============================================================================
--  6. Policies de profiles, por rango
-- =============================================================================
drop policy if exists "profiles_update_own_name" on public.profiles;
drop policy if exists "profiles_admin_write" on public.profiles;
drop policy if exists "profiles_admin_delete" on public.profiles;

-- Leer: todo el personal se ve entre sí (el salón muestra quién atiende cada mesa).
drop policy if exists "profiles_select_self" on public.profiles;
create policy "profiles_select_self"
  on public.profiles for select
  to authenticated
  using (id = auth.uid() or public.is_staff());

-- Crear: solo por debajo del propio nivel.
create policy "profiles_insert_lower"
  on public.profiles for insert
  to authenticated
  with check (public.my_rank() > public.role_rank(role));

-- Editar: la fila propia (el trigger impide el autoascenso), o alguien de
-- nivel inferior.
create policy "profiles_update_lower"
  on public.profiles for update
  to authenticated
  using (id = auth.uid() or public.my_rank() > public.role_rank(role))
  with check (id = auth.uid() or public.my_rank() > public.role_rank(role));

create policy "profiles_delete_lower"
  on public.profiles for delete
  to authenticated
  using (public.my_rank() > public.role_rank(role));

-- =============================================================================
--  7. El primer usuario del sistema nace gerente
--
--  Antes nacía admin. En una instalación nueva, si el primero fuera admin no
--  habría forma de crear un gerente desde la aplicación.
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
    if v_role not in ('mozo', 'admin', 'gerente') then
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
