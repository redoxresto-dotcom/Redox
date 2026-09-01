-- =============================================================================
--  NexoRestUy — Redox, Punta Carretas
--  Migración 020: los llamados del cliente solo valen con la mesa abierta
--
--  Ejecutar DESPUÉS de 019_imagenes_productos.sql, en:
--    Supabase Dashboard → SQL Editor → New query → Run
--  Es idempotente.
--
--  El QR de una mesa es una URL fija: una vez impreso, sigue funcionando
--  aunque la mesa esté vacía. Sin este chequeo, cualquiera con esa URL —una
--  foto vieja, un link reenviado, alguien parado afuera con el código de una
--  mesa que ve por la ventana— puede hacer sonar "llamar al mozo" o "pedir la
--  cuenta" en una mesa libre.
--
--  La policy es el límite real: `anon` inserta en `alerts` con la clave
--  pública, que viaja en el navegador de cualquiera. El server action de
--  /table/[id] ya valida esto para devolver un mensaje claro, pero si alguien
--  le pega directo a la API de Supabase salteándose la app, tiene que
--  encontrar la misma pared acá.
-- =============================================================================

drop policy if exists "alerts_insert_public" on public.alerts;
create policy "alerts_insert_public"
  on public.alerts for insert
  to anon, authenticated
  with check (
    status = 'pendiente'
    and type in ('llamar_mozo', 'pedir_cuenta')
    and exists (
      select 1 from public.tables
       where id = table_id
         and status = 'ocupada'
    )
  );
