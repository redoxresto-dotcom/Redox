-- =============================================================================
--  NexoRestUy — Redox, Punta Carretas
--  Migración 019: imágenes de producto
--
--  Ejecutar DESPUÉS de 018_cancelar_pedido_mozo.sql, en:
--    Supabase Dashboard → SQL Editor → New query → Run
--  Es idempotente.
--
--  Cada producto puede tener una foto: se sube a un bucket público de Storage
--  y products.image_url guarda la URL pública, no el archivo. Público a
--  propósito, como el resto de la carta — quien escanea el QR no tiene sesión
--  y tiene que poder cargar la imagen igual.
-- =============================================================================

alter table public.products
  add column if not exists image_url text;

-- =============================================================================
--  1. Bucket de Storage
-- =============================================================================
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do update set public = true;

-- Solo admin y gerente suben o borran fotos: es parte de armar el catálogo,
-- igual que el resto de los campos del producto.
drop policy if exists "product_images_admin_insert" on storage.objects;
create policy "product_images_admin_insert"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'product-images' and public.is_admin());

drop policy if exists "product_images_admin_update" on storage.objects;
create policy "product_images_admin_update"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'product-images' and public.is_admin())
  with check (bucket_id = 'product-images' and public.is_admin());

drop policy if exists "product_images_admin_delete" on storage.objects;
create policy "product_images_admin_delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'product-images' and public.is_admin());

-- Lectura pública: el bucket ya es público (sirve los objetos por URL sin
-- pasar por RLS), pero esta policy además deja listar/consultar el objeto
-- por la API de Storage con la clave anónima.
drop policy if exists "product_images_public_read" on storage.objects;
create policy "product_images_public_read"
  on storage.objects for select
  to public
  using (bucket_id = 'product-images');

-- =============================================================================
--  2. MENU — suma la foto y si es combo a la proyección pública
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
    p.category,
    p.image_url,
    p.is_combo
  from public.products p
  where p.active
    and p.in_menu;

revoke all on public.menu from anon, authenticated;
grant select on public.menu to anon, authenticated;
