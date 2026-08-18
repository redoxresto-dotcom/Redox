-- =============================================================================
--  POS VENTA — Punta Carretas
--  Migración 005: medios de pago, turnos de caja y arqueo
--
--  Ejecutar DESPUÉS de 004_estaciones.sql, en:
--    Supabase Dashboard → SQL Editor → New query → Run
--  Es idempotente.
--
--  Cada cuenta se cobra con un medio de pago y queda pegada al turno de caja
--  que estaba abierto. Al cerrar el turno se cuenta el efectivo y el sistema
--  dice si sobra o falta.
-- =============================================================================

-- =============================================================================
--  1. CASH_SHIFTS — turnos de caja
-- =============================================================================
create table if not exists public.cash_shifts (
  id             uuid primary key default gen_random_uuid(),
  opened_at      timestamptz not null default now(),
  opened_by      uuid references public.profiles (id) on delete set null,
  -- Fondo de cambio con el que arranca la caja.
  opening_float  numeric(10,2) not null default 0 check (opening_float >= 0),

  closed_at      timestamptz,
  closed_by      uuid references public.profiles (id) on delete set null,
  -- Lo que se contó de la caja al cerrar.
  counted_cash   numeric(10,2) check (counted_cash is null or counted_cash >= 0),
  -- Fondo + ventas en efectivo del turno, congelado al momento del cierre:
  -- lo que debería haber en la caja. Se guarda calculado para que un cambio
  -- posterior en una cuenta vieja no reescriba un arqueo ya firmado.
  expected_cash  numeric(10,2),
  -- counted_cash - expected_cash. Positivo sobra, negativo falta.
  difference     numeric(10,2),
  notes          text,
  created_at     timestamptz not null default now()
);

-- Una sola caja abierta a la vez. La expresión es constante a propósito:
-- dentro del índice parcial todas las filas valen lo mismo, así que solo
-- entra una.
create unique index if not exists cash_shifts_one_open
  on public.cash_shifts ((closed_at is null))
  where closed_at is null;

create index if not exists cash_shifts_opened_idx
  on public.cash_shifts (opened_at desc);

-- =============================================================================
--  2. ORDERS — con qué se pagó y a qué turno pertenece
-- =============================================================================
alter table public.orders
  add column if not exists payment_method text
    check (payment_method is null or payment_method in
      ('efectivo', 'debito', 'credito', 'transferencia', 'otro')),
  add column if not exists shift_id uuid references public.cash_shifts (id) on delete set null;

create index if not exists orders_shift_idx on public.orders (shift_id);

-- Reportes por medio de pago y por período.
create index if not exists orders_cobradas_idx
  on public.orders (closed_at desc)
  where status = 'cobrada';

-- =============================================================================
--  3. RPC de caja
-- =============================================================================

-- Abre la caja. Lo puede hacer cualquiera del personal: si abrir dependiera del
-- encargado, un sábado sin él en el local nadie podría cobrar.
create or replace function public.open_cash_shift(p_float numeric default 0)
returns public.cash_shifts
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_shift public.cash_shifts;
begin
  if not public.is_staff() then
    raise exception 'Solo el personal puede abrir la caja';
  end if;

  select * into v_shift from public.cash_shifts where closed_at is null limit 1;
  if v_shift.id is not null then
    raise exception 'Ya hay un turno de caja abierto';
  end if;

  insert into public.cash_shifts (opened_by, opening_float)
  values (auth.uid(), greatest(coalesce(p_float, 0), 0))
  returning * into v_shift;

  return v_shift;
end;
$$;

-- Cierra la caja contra lo contado. El arqueo es responsabilidad del encargado,
-- así que este sí pide admin.
create or replace function public.close_cash_shift(
  p_shift_id uuid,
  p_counted   numeric,
  p_notes     text default null
)
returns public.cash_shifts
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_shift    public.cash_shifts;
  v_efectivo numeric(10,2);
  v_esperado numeric(10,2);
begin
  if not public.is_admin() then
    raise exception 'Solo un encargado puede cerrar la caja';
  end if;

  select * into v_shift
    from public.cash_shifts
   where id = p_shift_id and closed_at is null;

  if v_shift.id is null then
    raise exception 'El turno no existe o ya fue cerrado';
  end if;

  select coalesce(sum(o.total), 0) into v_efectivo
    from public.orders o
   where o.shift_id = v_shift.id
     and o.status = 'cobrada'
     and o.payment_method = 'efectivo';

  v_esperado := v_shift.opening_float + v_efectivo;

  update public.cash_shifts
     set closed_at     = now(),
         closed_by     = auth.uid(),
         counted_cash  = greatest(coalesce(p_counted, 0), 0),
         expected_cash = v_esperado,
         difference    = greatest(coalesce(p_counted, 0), 0) - v_esperado,
         notes         = nullif(trim(coalesce(p_notes, '')), '')
   where id = v_shift.id
  returning * into v_shift;

  return v_shift;
end;
$$;

-- =============================================================================
--  4. Cobrar exige medio de pago y turno abierto
--
--  Sin turno no se puede cobrar: una venta sin caja abierta no cae en ningún
--  arqueo y el cierre del día deja de cerrar. La pantalla del salón avisa
--  antes, para que nadie se entere en la mitad de un cobro.
-- =============================================================================
drop function if exists public.close_table_order(uuid);

create or replace function public.close_table_order(
  p_order_id       uuid,
  p_payment_method text
)
returns public.orders
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_order    public.orders;
  v_shift_id uuid;
begin
  if p_payment_method is null or p_payment_method not in
     ('efectivo', 'debito', 'credito', 'transferencia', 'otro') then
    raise exception 'Medio de pago inválido: %', p_payment_method;
  end if;

  select id into v_shift_id
    from public.cash_shifts
   where closed_at is null
   limit 1;

  if v_shift_id is null then
    raise exception 'No hay un turno de caja abierto';
  end if;

  update public.orders
     set status         = 'cobrada',
         closed_at      = now(),
         closed_by      = auth.uid(),
         payment_method = p_payment_method,
         shift_id       = v_shift_id
   where id = p_order_id and status = 'abierta'
  returning * into v_order;

  if v_order.id is null then
    raise exception 'La cuenta % no existe o ya fue cobrada', p_order_id;
  end if;

  update public.tables
     set status = 'libre', assigned_waiter = null
   where id = v_order.table_id;

  update public.alerts
     set status = 'resuelta', resolved_by = auth.uid()
   where table_id = v_order.table_id and status = 'pendiente';

  return v_order;
end;
$$;

-- =============================================================================
--  5. ROW LEVEL SECURITY
--
--  El personal ve y abre turnos; cerrarlos y corregirlos es de admin, y eso lo
--  aplica el propio RPC (security invoker + is_admin()).
-- =============================================================================
alter table public.cash_shifts enable row level security;

drop policy if exists "cash_shifts_staff_read" on public.cash_shifts;
create policy "cash_shifts_staff_read"
  on public.cash_shifts for select
  to authenticated
  using (public.is_staff());

-- Abrir la caja: cualquiera del personal (el RPC valida lo mismo).
drop policy if exists "cash_shifts_staff_open" on public.cash_shifts;
create policy "cash_shifts_staff_open"
  on public.cash_shifts for insert
  to authenticated
  with check (public.is_staff());

-- Cerrar o corregir un arqueo: solo el encargado.
drop policy if exists "cash_shifts_admin_write" on public.cash_shifts;
drop policy if exists "cash_shifts_admin_update" on public.cash_shifts;
create policy "cash_shifts_admin_update"
  on public.cash_shifts for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "cash_shifts_admin_delete" on public.cash_shifts;
create policy "cash_shifts_admin_delete"
  on public.cash_shifts for delete
  to authenticated
  using (public.is_admin());

-- =============================================================================
--  6. REALTIME
--  Que el aviso de "no hay caja abierta" se prenda y se apague en todos los
--  dispositivos a la vez, sin que nadie recargue.
-- =============================================================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and tablename = 'cash_shifts'
  ) then
    alter publication supabase_realtime add table public.cash_shifts;
  end if;
end
$$;
