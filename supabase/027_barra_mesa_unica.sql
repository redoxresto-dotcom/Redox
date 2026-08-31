-- =============================================================================
--  NexoRestUy — Redox, Punta Carretas
--  Migración 027: la barra vende directo, sin elegir mesa
--
--  Ejecutar DESPUÉS de 026_combo_vigencia.sql, en:
--    Supabase Dashboard → SQL Editor → New query → Run
--  Es idempotente.
--
--  La barra atiende al que solo toma algo: no hay "mesa", hay una venta que se
--  arma con el menú y se cobra de una. Por debajo la cuenta necesita igual una
--  fila en `tables` (la FK de orders), así que existe una única mesa interna
--  "Barra" marcada con is_bar. La pantalla /barra la usa siempre y no la
--  muestra.
--
--  Reincluye el ALTER de is_bar por si la 024 no llegó a correr: así esta
--  migración se basta sola.
-- =============================================================================

alter table public.tables
  add column if not exists is_bar boolean not null default false;

create index if not exists tables_is_bar_idx
  on public.tables (is_bar) where is_bar;

-- Garantiza una mesa interna de barra. Si ya sembraste varias a mano, no toca
-- nada: la pantalla usa la primera por número.
do $$
begin
  if not exists (select 1 from public.tables where is_bar) then
    insert into public.tables (number, name, is_bar)
    values (
      (select coalesce(max(number), 0) + 1 from public.tables),
      'Barra',
      true
    );
  end if;
end
$$;
