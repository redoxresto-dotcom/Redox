-- =============================================================================
--  NexoRestUy — Redox, Punta Carretas
--  Migración 026: vigencia de combos
--
--  Ejecutar DESPUÉS de 025_login_documento.sql, en:
--    Supabase Dashboard → SQL Editor → New query → Run
--  Es idempotente.
--
--  Una promoción ahora puede tener fecha de inicio y de fin. Fuera de esa
--  ventana el combo no se ofrece: sale de la carta pública (esta vista) y el
--  POS lo filtra del mismo modo. El catálogo lo sigue mostrando, con un aviso
--  de "último día" y otro de "vencido", para poder reactivarlo cambiando la
--  fecha sin recrearlo.
--
--  Las fechas se comparan contra el día de Montevideo, igual que el resto de
--  los cortes por día del sistema.
-- =============================================================================

alter table public.products
  add column if not exists combo_valid_from  date,
  add column if not exists combo_valid_until date;

-- La vista pública de la carta (ver 008_carta.sql), ahora con el filtro de
-- vigencia adentro para que no dependa de que quien consulta se acuerde.
drop view if exists public.menu;

create view public.menu
with (security_invoker = false)
as
  select
    p.id,
    p.name,
    p.price,
    p.description,
    p.category
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
