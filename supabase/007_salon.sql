-- =============================================================================
--  POS VENTA — Punta Carretas
--  Migración 007: sectores y plano del salón
--
--  Ejecutar DESPUÉS de 006_reportes.sql, en:
--    Supabase Dashboard → SQL Editor → New query → Run
--  Es idempotente.
--
--  Las mesas dejan de ser una grilla por número y pasan a tener lugar en un
--  plano: sector, posición, forma, tamaño, rotación y cantidad de sillas.
--
--  Las sillas no son objetos: se guarda cuántas tiene la mesa y se dibujan
--  alrededor. Sesenta sillas sueltas para doce mesas se ven igual en pantalla
--  y hay que reacomodarlas a mano cada vez que se mueve una mesa.
-- =============================================================================

-- =============================================================================
--  1. SECTORS — salón, terraza, pool, lo que el bar necesite
-- =============================================================================
create table if not exists public.sectors (
  id         uuid primary key default gen_random_uuid(),
  name       text        not null check (length(trim(name)) > 0),
  sort_order integer     not null default 0,
  created_at timestamptz not null default now()
);

create unique index if not exists sectors_name_unique on public.sectors (lower(name));
create index if not exists sectors_order_idx on public.sectors (sort_order, name);

-- Sector por defecto, para que ninguna mesa quede huérfana.
--
-- El nombre se arma con chr() en vez de escribir 'Salón' derecho: al pasar el
-- archivo por el editor SQL del navegador, la ó se guardó doble-codificada y
-- quedó "Salón" en la base. Los acentos que escribe la aplicación viajan bien
-- —eso está probado—; el que se rompió fue este literal, y es el único dato
-- con acento que nace de una migración.
insert into public.sectors (name, sort_order)
select 'Sal' || chr(243) || 'n', 0
where not exists (select 1 from public.sectors);

-- Reparación por si el sector ya quedó con el nombre roto. Se compara contra
-- el valor exacto mal codificado (Ã³ en lugar de ó) y no contra un patrón, para
-- no pisarle el nombre a un sector que el bar haya creado a mano.
update public.sectors
   set name = 'Sal' || chr(243) || 'n'
 where name = 'Sal' || chr(195) || chr(179) || 'n';

-- =============================================================================
--  2. TABLES — lugar en el plano
-- =============================================================================
do $$
declare
  v_es_nuevo boolean;
  v_sector   uuid;
begin
  v_es_nuevo := not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'tables'
       and column_name = 'pos_x'
  );

  alter table public.tables
    add column if not exists sector_id uuid references public.sectors (id) on delete set null,
    add column if not exists pos_x    integer not null default 0,
    add column if not exists pos_y    integer not null default 0,
    add column if not exists shape    text    not null default 'redonda'
      check (shape in ('redonda', 'cuadrada', 'rectangular')),
    add column if not exists width    integer not null default 120
      check (width between 40 and 600),
    add column if not exists height   integer not null default 120
      check (height between 40 and 600),
    add column if not exists rotation integer not null default 0
      check (rotation between 0 and 359),
    add column if not exists seats    integer not null default 4
      check (seats between 0 and 20);

  if v_es_nuevo then
    select id into v_sector from public.sectors order by sort_order, name limit 1;

    -- Acomodo inicial en grilla: al abrir el editor por primera vez las mesas
    -- ya están puestas y se mueven, en vez de aparecer todas encimadas en el
    -- cero del plano.
    execute format($sql$
      with numeradas as (
        select id, (row_number() over (order by number) - 1) as i
          from public.tables
      )
      update public.tables t
         set sector_id = coalesce(t.sector_id, %L::uuid),
             pos_x = 80 + ((n.i %% 4) * 220)::int,
             pos_y = 80 + ((n.i / 4) * 200)::int
        from numeradas n
       where n.id = t.id
    $sql$, v_sector);
  end if;
end
$$;

create index if not exists tables_sector_idx on public.tables (sector_id, number);

-- =============================================================================
--  3. RPC del editor
--
--  El plano lo edita el encargado. La policy de tables es de personal —la
--  necesita el mozo para abrir y cerrar mesas— así que el candado de admin va
--  acá, donde se puede distinguir mover una mesa de ocuparla.
-- =============================================================================

create or replace function public.save_table_layout(p_layout jsonb)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row   jsonb;
  v_count integer := 0;
begin
  if not public.is_admin() then
    raise exception 'Solo un encargado puede editar el salón';
  end if;

  if jsonb_typeof(p_layout) <> 'array' then
    raise exception 'El plano tiene que ser un arreglo';
  end if;

  for v_row in select * from jsonb_array_elements(p_layout) loop
    update public.tables t
       set sector_id = nullif(v_row ->> 'sector_id', '')::uuid,
           -- Se acota en vez de rechazar: un arrastre que se pasa del borde
           -- vuelve al borde, no tira un error en la cara del encargado.
           pos_x     = greatest(0, least(4000, coalesce((v_row ->> 'pos_x')::int, t.pos_x))),
           pos_y     = greatest(0, least(4000, coalesce((v_row ->> 'pos_y')::int, t.pos_y))),
           shape     = coalesce(v_row ->> 'shape', t.shape),
           width     = greatest(40, least(600, coalesce((v_row ->> 'width')::int, t.width))),
           height    = greatest(40, least(600, coalesce((v_row ->> 'height')::int, t.height))),
           rotation  = coalesce((v_row ->> 'rotation')::int, t.rotation) % 360,
           seats     = greatest(0, least(20, coalesce((v_row ->> 'seats')::int, t.seats)))
     where t.id = (v_row ->> 'id')::uuid;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- Alta de mesa. El número es lo único que no se puede repetir.
create or replace function public.create_bar_table(
  p_number   integer,
  p_sector   uuid default null,
  p_pos_x    integer default 80,
  p_pos_y    integer default 80
)
returns public.tables
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_table public.tables;
begin
  if not public.is_admin() then
    raise exception 'Solo un encargado puede agregar mesas';
  end if;

  if exists (select 1 from public.tables where number = p_number) then
    raise exception 'Ya hay una mesa con el número %', p_number;
  end if;

  insert into public.tables (number, sector_id, pos_x, pos_y)
  values (
    p_number,
    coalesce(p_sector, (select id from public.sectors order by sort_order, name limit 1)),
    greatest(0, least(4000, coalesce(p_pos_x, 80))),
    greatest(0, least(4000, coalesce(p_pos_y, 80)))
  )
  returning * into v_table;

  return v_table;
end;
$$;

-- Baja de mesa. Una mesa que ya facturó no se borra: se perdería el histórico.
create or replace function public.delete_bar_table(p_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo un encargado puede quitar mesas';
  end if;

  if exists (select 1 from public.orders where table_id = p_id) then
    raise exception 'La mesa tiene cuentas en el histórico y no se puede borrar';
  end if;

  delete from public.tables where id = p_id;
end;
$$;

-- =============================================================================
--  4. ROW LEVEL SECURITY de sectors
--  El cliente que escanea el QR lee mesas, así que también puede leer sectores;
--  no hay nada sensible en un nombre de sector. Escribir, solo admin.
-- =============================================================================
alter table public.sectors enable row level security;

drop policy if exists "sectors_select_public" on public.sectors;
create policy "sectors_select_public"
  on public.sectors for select
  to anon, authenticated
  using (true);

drop policy if exists "sectors_admin_write" on public.sectors;
create policy "sectors_admin_write"
  on public.sectors for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- =============================================================================
--  5. REALTIME
--  Mover una mesa en el editor se ve en el tablero del salón sin recargar.
-- =============================================================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and tablename = 'sectors'
  ) then
    alter publication supabase_realtime add table public.sectors;
  end if;
end
$$;
