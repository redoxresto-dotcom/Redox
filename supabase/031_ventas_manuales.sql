-- =============================================================================
--  NexoRestUy — Redox, Punta Carretas
--  Migración 031: ventas cargadas a mano (corte de luz / sin internet)
--
--  Ejecutar DESPUÉS de 030_alertas_sin_mesa_abierta.sql, en:
--    Supabase Dashboard → SQL Editor → New query → Run
--  Es idempotente.
--
--  Cuando el POS está offline, el bar anota las ventas en papel. Después el
--  gerente las sube desde Reportes con un CSV. Cada ticket importado se guarda
--  como una venta real (orders 'cobrada' + order_items), fechada con la hora
--  del corte y marcada con origin='manual'. Como los reportes se calculan
--  filtrando orders por status='cobrada' y closed_at, esas ventas entran solas
--  en todos los cuadros sin tocar ninguna RPC.
--
--  NO entran al arqueo de caja: se guardan con shift_id = NULL y
--  close_cash_shift solo suma las cobradas con shift_id del turno.
--
--  Se cuelgan de una mesa de sistema oculta ('Ventas sin conexión') que no
--  aparece en el plano del salón ni en los QR.
-- =============================================================================

alter table public.orders
  add column if not exists origin text not null default 'pos'
    check (origin in ('pos', 'manual'));

alter table public.tables
  add column if not exists is_system boolean not null default false;

create index if not exists tables_is_system_idx
  on public.tables (is_system) where is_system;

-- Mesa interna para colgar las ventas manuales (la FK de orders la exige).
do $$
begin
  if not exists (select 1 from public.tables where is_system) then
    insert into public.tables (number, name, is_system)
    values (
      (select coalesce(max(number), 0) + 1 from public.tables),
      'Ventas sin conexión',
      true
    );
  end if;
end
$$;

notify pgrst, 'reload schema';
