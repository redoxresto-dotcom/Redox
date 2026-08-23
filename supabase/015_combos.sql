-- =============================================================================
--  NexoRestUy — Redox, Punta Carretas
--  Migración 015: combos y promociones
--
--  Ejecutar DESPUÉS de 014_pool_jugadores.sql, en:
--    Supabase Dashboard → SQL Editor → New query → Run
--  Es idempotente.
--
--  Un combo es un producto más: se agrega a una mesa, pasa por su estación y
--  se cobra igual que cualquier otro, porque bajo el capote lo es. Lo único
--  que suma esta migración es la lista de qué productos lo componen, para
--  que el catálogo pueda armarlo desde ahí en vez de tipearlo en la
--  descripción a mano. El precio se sigue cargando a mano, como siempre: acá
--  no se calcula ningún descuento, el dueño decide cuánto vale la promoción
--  del día.
-- =============================================================================

alter table public.products
  add column if not exists is_combo boolean not null default false;

create table if not exists public.combo_items (
  id           uuid primary key default gen_random_uuid(),
  combo_id     uuid not null references public.products (id) on delete cascade,
  component_id uuid not null references public.products (id) on delete restrict,
  quantity     integer not null default 1 check (quantity > 0),
  created_at   timestamptz not null default now(),
  check (combo_id <> component_id),
  unique (combo_id, component_id)
);

-- No se anidan combos: si hiciera falta, el trigger avisa con un mensaje que
-- se entiende en vez de dejar que lo frene una FK cualquiera.
create or replace function public.fn_combo_items_guard()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.products where id = new.combo_id and is_combo
  ) then
    raise exception 'El producto no está marcado como combo.';
  end if;

  if exists (
    select 1 from public.products where id = new.component_id and is_combo
  ) then
    raise exception 'Un combo no puede tener otro combo adentro.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_combo_items_guard on public.combo_items;
create trigger trg_combo_items_guard
  before insert or update on public.combo_items
  for each row execute function public.fn_combo_items_guard();

alter table public.combo_items enable row level security;

-- Solo admin y gerente arman combos: ni el mozo ni las estaciones necesitan
-- ver de qué está hecho, la comanda ya les llega con el producto resuelto.
drop policy if exists "combo_items_admin_all" on public.combo_items;
create policy "combo_items_admin_all"
  on public.combo_items for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Reemplaza de una vez la lista de componentes de un combo. Va en una función
-- y no en dos llamadas sueltas (delete + insert) desde la aplicación para que
-- no quede a mitad de camino si la segunda falla.
create or replace function public.set_combo_items(p_combo_id uuid, p_items jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.products where id = p_combo_id and is_combo
  ) then
    raise exception 'El producto no está marcado como combo.';
  end if;

  delete from public.combo_items where combo_id = p_combo_id;

  insert into public.combo_items (combo_id, component_id, quantity)
  select
    p_combo_id,
    (item ->> 'product_id')::uuid,
    greatest(1, coalesce((item ->> 'quantity')::integer, 1))
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as item;
end;
$$;

grant execute on function public.set_combo_items(uuid, jsonb) to authenticated;
