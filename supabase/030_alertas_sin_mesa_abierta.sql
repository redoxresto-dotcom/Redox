-- =============================================================================
--  NexoRestUy — Redox, Punta Carretas
--  Migración 030: revierte el requisito de "mesa abierta" para los llamados
--
--  Ejecutar DESPUÉS de 029_menu_carta.sql, en:
--    Supabase Dashboard → SQL Editor → New query → Run
--  Es idempotente.
--
--  La 020_alertas_mesa_abierta.sql había exigido que la mesa estuviera
--  'ocupada' para que el cliente pudiera tocar "llamar al mozo" o "pedir la
--  cuenta". A pedido de los dueños de Redox se saca ese chequeo: el cliente
--  puede llamar aunque la mesa figure libre (p. ej. recién se sienta y todavía
--  nadie le abrió la cuenta).
--
--  Vuelve a la policy original de 002_auth.sql: solo se valida el estado y el
--  tipo de la alerta.
-- =============================================================================

drop policy if exists "alerts_insert_public" on public.alerts;
create policy "alerts_insert_public"
  on public.alerts for insert
  to anon, authenticated
  with check (
    status = 'pendiente'
    and type in ('llamar_mozo', 'pedir_cuenta')
  );
