-- =============================================================================
--  NexoRestUy — Redox, Punta Carretas
--  Migración 016: nombre de mesa
--
--  Ejecutar DESPUÉS de 015_combos.sql, en:
--    Supabase Dashboard → SQL Editor → New query → Run
--  Es idempotente.
--
--  El número sigue siendo el identificador único de la mesa (lo pide el
--  histórico y el editor de layout). El nombre es solo una etiqueta opcional
--  para las mesas que el dueño quiere reconocer de un vistazo — "Terraza",
--  "Barra 1" — en vez de memorizar que la terraza es la 12.
-- =============================================================================

alter table public.tables
  add column if not exists name text;

alter table public.tables
  drop constraint if exists tables_name_length;
alter table public.tables
  add constraint tables_name_length check (name is null or length(name) <= 40);

-- El editor guarda todo el plano de una, junto con posición, forma, etc.
-- (ver 007_salon.sql). Se agrega el nombre al mismo RPC en vez de sumar un
-- segundo camino de escritura para un solo campo.
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
           seats     = greatest(0, least(20, coalesce((v_row ->> 'seats')::int, t.seats))),
           name      = nullif(trim(both from left(v_row ->> 'name', 40)), '')
     where t.id = (v_row ->> 'id')::uuid;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;
