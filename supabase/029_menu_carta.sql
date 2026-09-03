-- =============================================================================
--  NexoRestUy — Redox, Punta Carretas
--  Migración 029: repara la vista `menu` (foto + combo + vigencia)
--
--  Ejecutar DESPUÉS de 028_barra_open_table.sql, en:
--    Supabase Dashboard → SQL Editor → New query → Run
--  Es idempotente.
--
--  La migración 026 recreó `menu` copiando la forma vieja de la 008 y se comió
--  las columnas image_url e is_combo que había agregado la 019. La carta del
--  cliente (/table/[id]) las pide, así que quedaba sin cargar.
--
--  Esta vista es la definitiva: las 5 columnas de siempre + foto + combo, con
--  el filtro de vigencia de combos de la 026 adentro.
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
    p.is_combo
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
