-- =============================================================================
--  POS VENTA — Punta Carretas
--  Migración 008: carta pública
--
--  Ejecutar DESPUÉS de 007_salon.sql, en:
--    Supabase Dashboard → SQL Editor → New query → Run
--  Es idempotente.
--
--  El cliente que escanea el QR pasa a ver la carta. Es el mismo catálogo que
--  usa la caja: se cambia un precio en /admin/catalogo y cambia en la mesa.
--
--  --------------------------------------------------------------------------
--  Además tapa una filtración que estaba abierta desde el principio.
--
--  La policy `products_select_public` dejaba a `anon` leer la tabla entera, y
--  la RLS filtra FILAS, no COLUMNAS: cualquiera con la clave pública —que
--  viaja al navegador de todos los que escanean un QR— podía consultar el
--  COSTO de cada producto. Verificado contra la base: devolvía los costos.
--
--  Se reemplaza por una vista con solo las columnas que el público puede ver.
--  --------------------------------------------------------------------------
-- =============================================================================

-- =============================================================================
--  1. PRODUCTS — lo que hace falta para mostrar una carta
-- =============================================================================
do $$
declare
  v_es_nuevo boolean;
begin
  v_es_nuevo := not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'products'
       and column_name = 'in_menu'
  );

  alter table public.products
    add column if not exists description text,
    -- Hay productos que existen en la caja y no van en la carta: la tarifa de
    -- pool, un descorche, la cerveza que se dejó de servir pero sigue en el
    -- histórico de ventas.
    add column if not exists in_menu boolean not null default true;

  if v_es_nuevo then
    -- La tarifa de pool se cobra prorrateada por minuto: mostrarla en la carta
    -- como una línea de precio fijo confunde más de lo que informa. Solo la
    -- primera vez; si después el bar decide publicarla, no se le pisa.
    execute $sql$
      update public.products set in_menu = false where is_pool_rate
    $sql$;
  end if;
end
$$;

create index if not exists products_menu_idx
  on public.products (category, name)
  where active and in_menu;

-- =============================================================================
--  2. MENU — la proyección pública del catálogo
--
--  Sin costo, sin is_pool_rate, sin active: solo lo que se muestra en una mesa.
--  El filtro va adentro de la vista para que no dependa de que quien consulta
--  se acuerde de escribirlo.
--
--  security_invoker = false a propósito: la vista corre con los permisos de su
--  dueño y por eso `anon` no necesita conservar ningún acceso a `products`. Es
--  justamente lo que permite cerrar la filtración del costo.
-- =============================================================================
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
    and p.in_menu;

-- SOLO LECTURA, y el `revoke` de arriba no es decorativo.
--
-- Supabase deja privilegios por defecto sobre todo lo que se crea en `public`:
-- una vista nueva nace con INSERT, UPDATE y DELETE otorgados a `anon`. Y esta
-- vista es simple —una tabla, sin agregaciones—, así que Postgres la hace
-- actualizable automáticamente. Como además corre con los permisos de su dueño,
-- esas escrituras entran a `products` salteándose la RLS por completo.
--
-- Sin este revoke, cualquiera con la clave pública podía crear productos y
-- cambiar precios. Probado: un POST devolvió 201 y un PATCH bajó el refresco
-- a un peso.
revoke all on public.menu from anon, authenticated;
grant select on public.menu to anon, authenticated;

-- =============================================================================
--  3. Se cierra el acceso directo de anon a products
--
--  El personal sigue leyendo la tabla completa con su sesión
--  (`products_select_staff`, de la 002).
-- =============================================================================
drop policy if exists "products_select_public" on public.products;
