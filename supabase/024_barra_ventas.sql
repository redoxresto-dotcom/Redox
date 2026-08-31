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
--  Una "mesa de barra" es una mesa del salón marcada con is_bar. Queda fuera
--  del tablero del salón (igual que las de pool) y solo aparece en /barra.
--  No hacen falta policies nuevas: orders / order_items / tables ya permiten
--  todo al personal activo (is_staff()), y "barra" es personal.
-- =============================================================================

alter table public.tables
  add column if not exists is_bar boolean not null default false;

create index if not exists tables_is_bar_idx
  on public.tables (is_bar) where is_bar;

-- Siembra un puñado de mesas de barra la primera vez. Si ya hay alguna (o el
-- dueño las creó a mano), no toca nada.
do $$
declare
  v_base integer;
begin
  if not exists (select 1 from public.tables where is_bar) then
    select coalesce(max(number), 0) into v_base from public.tables;

    insert into public.tables (number, name, is_bar)
    values
      (v_base + 1, 'Barra 1', true),
      (v_base + 2, 'Barra 2', true),
      (v_base + 3, 'Barra 3', true),
      (v_base + 4, 'Barra 4', true);
  end if;
end
$$;
