-- =============================================================================
--  NexoRestUy — Redox, Punta Carretas
--  Migración 025: login por documento (C.I.)
--
--  Ejecutar DESPUÉS de 024_barra_ventas.sql, en:
--    Supabase Dashboard → SQL Editor → New query → Run
--  Es idempotente.
--
--  El personal deja de entrar con un correo y pasa a entrar con su número de
--  documento. Supabase Auth necesita igual un email, así que por detrás se usa
--  un email sintético `<documento>@<dominio>` (el dominio lo fija la app con
--  AUTH_EMAIL_DOMAIN; por defecto redox.local). El alta de usuario ya manda el
--  documento en user_metadata.
--
--  Las cuentas viejas (con correo real) siguen entrando con ese correo hasta
--  que el gerente les cargue el documento desde Usuarios.
-- =============================================================================

alter table public.profiles
  add column if not exists document text;

alter table public.profiles
  drop constraint if exists profiles_document_chk;
alter table public.profiles
  add constraint profiles_document_chk
    check (document is null or document ~ '^\d{6,8}$');

-- Un documento no puede repetirse entre usuarios. Parcial: las cuentas viejas
-- sin documento conviven sin chocar.
create unique index if not exists profiles_document_uq
  on public.profiles (document) where document is not null;

-- El trigger de alta ahora también copia el documento que viene en el metadata.
-- (Resto igual que en 009_gerente.sql.)
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

  insert into public.profiles (id, full_name, role, document)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
      split_part(new.email, '@', 1)
    ),
    v_role,
    nullif(trim(new.raw_user_meta_data ->> 'document'), '')
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

notify pgrst, 'reload schema';
