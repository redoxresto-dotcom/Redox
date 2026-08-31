-- =============================================================================
--  NexoRestUy — Redox, Punta Carretas
--  Migración 024: pantalla de ventas de la barra
--
--  Ejecutar DESPUÉS de 023_pool_nombre_mesa.sql, en:
--    Supabase Dashboard → SQL Editor → New query → Run
--  Es idempotente.
--
--  El usuario con rol "barra" pasa a atender por su cuenta al cliente que solo
--  toma algo: carga bebidas, cierra la venta y cobra desde /barra. Esas ventas
--  entran a la caja general como cualquier otra (mismo `orders` / mismo RPC de
--  cobro), así que el arqueo del día las toma sin cambios.
--
--  La barra vende directo desde el menú, sin elegir mesa. Por debajo la cuenta
--  necesita igual una fila en `tables` (la FK de orders), así que existe una
--  única mesa interna "Barra" marcada con is_bar. Queda fuera del tablero del
--  salón (igual que las de pool) y solo la usa /barra.
--  No hacen falta policies nuevas: orders / order_items / tables ya permiten
--  todo al personal activo (is_staff()), y "barra" es personal.
--
--  (La siembra vive en 027_barra_mesa_unica.sql, que además se basta solo si
--  esta migración no llegó a correr.)
-- =============================================================================

alter table public.tables
  add column if not exists is_bar boolean not null default false;

create index if not exists tables_is_bar_idx
  on public.tables (is_bar) where is_bar;
