-- =============================================================================
--  NexoRestUy — Redox, Punta Carretas
--  Migración 021: permitir editar el número de mesa desde el plano
--
--  Ejecutar DESPUÉS de 020_reporte_por_mozo.sql, en:
--    Supabase Dashboard → SQL Editor → New query → Run
--  Es idempotente.
--
--  El número dejaba de poder cambiarse una vez creada la mesa. Se suma al
--  mismo RPC que guarda el resto del plano (ver 007_salon.sql, 016_nombre_mesa.sql).
--
--  Al número lo protege un unique constraint. Se lo pasa a "deferrable
--  initially deferred" para que, si el encargado cambia el número de dos
--  mesas en la misma tanda de guardado (una especie de intercambio), el
--  choque momentáneo mientras se procesa el arreglo no tire abajo todo el
--  guardado: Postgres recién lo revisa al final de la transacción, cuando ya
--  quedaron todos los números acomodados.
-- =============================================================================

do $$
declare
  v_conname text;
begin
  select con.conname into v_conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
   where nsp.nspname = 'public'
     and rel.relname = 'tables'
     and con.contype = 'u'
     and con.conkey = (
       select array_agg(attnum order by attnum)
         from pg_attribute
        where attrelid = rel.oid and attname = 'number'
     );

  if v_conname is not null then
    execute format('alter table public.tables drop constraint %I', v_conname);
  end if;

  alter table public.tables
    add constraint tables_number_key unique (number) deferrable initially deferred;
end
$$;

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

  -- El choque de números (si dos mesas quedan con el mismo, aunque sea a
  -- mitad del loop) recién se revisa al final de esta transacción.
  set constraints public.tables_number_key deferred;

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
           name      = nullif(trim(both from left(v_row ->> 'name', 40)), ''),
           number    = greatest(1, coalesce((v_row ->> 'number')::int, t.number))
     where t.id = (v_row ->> 'id')::uuid;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;
