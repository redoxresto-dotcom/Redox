-- =============================================================================
--  POS VENTA — Punta Carretas
--  Migración 004: estaciones (barra / cocina) y estado por ítem
--
--  Ejecutar DESPUÉS de 003_pool.sql, en:
--    Supabase Dashboard → SQL Editor → New query → Run
--  Es idempotente.
--
--  El mozo carga "dos negronis y una picada" en la mesa y el sistema reparte:
--  los negronis a la pantalla de la barra, la picada a la de cocina. Cada línea
--  de la cuenta avanza pedido → preparando → listo desde la propia estación.
-- =============================================================================

-- =============================================================================
--  1. PRODUCTS.STATION — quién prepara cada producto
--
--  'ninguna' es para lo que no pasa por ninguna estación: la hora de pool, un
--  descorche, cualquier cosa que se cobre sin que nadie la prepare. No genera
--  comanda y por lo tanto no aparece en ninguna pantalla.
-- =============================================================================
do $$
declare
  v_es_nueva boolean;
begin
  v_es_nueva := not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'products'
       and column_name = 'station'
  );

  if v_es_nueva then
    alter table public.products
      add column station text not null default 'barra'
        check (station in ('barra', 'cocina', 'ninguna'));

    -- Reparto inicial razonable, solo la primera vez: la comida a cocina, la
    -- bebida a barra, la tarifa de pool a ninguna. De acá en adelante lo
    -- decide el encargado desde /admin/catalogo y esta migración no lo pisa.
    execute $sql$
      update public.products
         set station = case
               when is_pool_rate then 'ninguna'
               when category = 'comida' then 'cocina'
               else 'barra'
             end
    $sql$;
  end if;
end
$$;

-- =============================================================================
--  2. ORDER_ITEMS — estado de preparación
--
--  station se copia del producto al momento de la venta y queda congelada,
--  igual que unit_price: si el encargado mueve un producto de barra a cocina
--  en el medio del servicio, las comandas que ya estaban en curso no saltan
--  de pantalla.
-- =============================================================================
do $$
declare
  v_es_nueva boolean;
begin
  v_es_nueva := not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'order_items'
       and column_name = 'status'
  );

  alter table public.order_items
    add column if not exists station text not null default 'barra'
      check (station in ('barra', 'cocina', 'ninguna')),
    add column if not exists status text not null default 'pedido'
      check (status in ('pedido', 'preparando', 'listo')),
    add column if not exists started_at timestamptz,
    add column if not exists ready_at   timestamptz,
    add column if not exists started_by uuid references public.profiles (id) on delete set null,
    add column if not exists ready_by   uuid references public.profiles (id) on delete set null;

  if v_es_nueva then
    -- Todo lo vendido antes de que existieran las estaciones ya salió: se da
    -- por listo. Si no, el día que se enciende la pantalla de cocina aparece
    -- un backlog de comandas viejas que nadie va a preparar.
    execute $sql$
      update public.order_items oi
         set station  = coalesce(p.station, 'barra'),
             status   = 'listo',
             ready_at = coalesce(oi.ready_at, oi.created_at)
        from public.products p
       where p.id = oi.product_id
    $sql$;
  end if;
end
$$;

-- La consulta de cada estación: lo pendiente, lo más viejo primero.
create index if not exists order_items_station_pending_idx
  on public.order_items (station, created_at)
  where status <> 'listo';

-- Para el "deshacer" de la pantalla: lo que se marcó listo recién.
create index if not exists order_items_ready_idx
  on public.order_items (ready_at desc)
  where status = 'listo';

-- =============================================================================
--  3. TRIGGERS
-- =============================================================================

-- Al cargar una línea, se le sella la estación del producto.
create or replace function public.fn_order_item_station()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_station text;
begin
  select p.station into v_station
    from public.products p
   where p.id = new.product_id;

  new.station := coalesce(v_station, 'barra');

  -- Lo que no pasa por una estación nace listo: la hora de pool no espera a
  -- que nadie la prepare, y no tiene por qué dejar la mesa en amarillo.
  if new.station = 'ninguna' then
    new.status   := 'listo';
    new.ready_at := coalesce(new.ready_at, now());
  end if;

  return new;
end;
$$;

drop trigger if exists trg_order_item_station on public.order_items;
create trigger trg_order_item_station
  before insert on public.order_items
  for each row execute function public.fn_order_item_station();

-- Sella hora y responsable de cada avance, y limpia al deshacer.
create or replace function public.fn_order_item_status_stamps()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'preparando' then
      new.started_at := coalesce(new.started_at, now());
      new.started_by := coalesce(new.started_by, auth.uid());
      -- Volver de 'listo' a 'preparando' es deshacer: se borra el sello.
      new.ready_at := null;
      new.ready_by := null;

    elsif new.status = 'listo' then
      new.ready_at := now();
      new.ready_by := coalesce(auth.uid(), new.ready_by);

    elsif new.status = 'pedido' then
      new.started_at := null;
      new.started_by := null;
      new.ready_at   := null;
      new.ready_by   := null;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_order_item_status_stamps on public.order_items;
create trigger trg_order_item_status_stamps
  before update of status on public.order_items
  for each row execute function public.fn_order_item_status_stamps();

-- =============================================================================
--  4. REALTIME
--
--  order_items no estaba publicado. El tablero del salón se venía enterando de
--  refilón, porque cada línea nueva cambia orders.total y eso sí viajaba. Un
--  cambio de estado no toca el total: sin esto, las pantallas de barra y cocina
--  no se enterarían de nada.
-- =============================================================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and tablename = 'order_items'
  ) then
    alter publication supabase_realtime add table public.order_items;
  end if;
end
$$;
