-- =============================================================================
--  NexoRestUy — Redox, Punta Carretas
--  Migración 036: la carta separa bebidas con y sin alcohol
--
--  Ejecutar DESPUÉS de 035_pool_reserva_contacto_libre.sql, en:
--    Supabase Dashboard → SQL Editor → New query → Run
--  Es idempotente.
--
--  No se toca la categoría `bebida`: seguiría rompiendo /barra, que filtra
--  por `category = 'bebida'` a rajatabla (app/barra/page.tsx y actions.ts).
--  En cambio, se agrega un campo aparte y ortogonal a la categoría: una
--  bebida puede o no contener alcohol, pero sigue siendo una "bebida" para
--  todo lo demás del sistema. La carta pública lo usa para ofrecer, dentro
--  de Bebidas, un sub-filtro "Sin alcohol / Con alcohol / Ver todos".
-- =============================================================================

alter table public.products
  add column if not exists contains_alcohol boolean not null default false;

-- =============================================================================
--  La vista pública `menu` suma la columna nueva. Sin costo, sin más: sigue
--  siendo la misma proyección seleccionable por `anon`, solo con un campo más.
-- =============================================================================
drop view if exists public.menu;

create view public.menu
with (security_invoker = false)
as
  select
    p.id,
    p.name,
    p.price,
    p.description,
    p.category,
    p.image_url,
    p.is_combo,
    p.contains_alcohol
  from public.products p
  where p.active
    and p.in_menu
    and (
      p.combo_valid_from is null
      or p.combo_valid_from <= (now() at time zone 'America/Montevideo')::date
    )
    and (
      p.combo_valid_until is null
      or p.combo_valid_until >= (now() at time zone 'America/Montevideo')::date
    );

revoke all on public.menu from anon, authenticated;
grant select on public.menu to anon, authenticated;

notify pgrst, 'reload schema';
