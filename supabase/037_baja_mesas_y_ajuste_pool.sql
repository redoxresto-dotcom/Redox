-- =============================================================================
--  NexoRestUy — Redox, Punta Carretas
--  Migración 037: baja de mesas con historial y ajuste del cobro de pool
--
--  Ejecutar DESPUÉS de 036_bebidas_con_sin_alcohol.sql, en:
--    Supabase Dashboard → SQL Editor → New query → Run
--  Es idempotente.
--
--  Estos cambios se habían aplicado directo sobre la base original sin dejar
--  archivo. Quedan acá para que una base nueva arranque igual que la original.
--
--  1. Una mesa que ya facturó no se borra: se da de baja (tables.active) y se
--     puede volver a habilitar. Sale del salón, la barra y el QR, pero las
--     ventas viejas conservan a qué mesa pertenecían.
--  2. Cortar una partida de pool antes de tiempo ajusta la cuenta a los minutos
--     realmente jugados, en vez de dejar cobrado el bloque completo.
-- =============================================================================

alter table public.tables
  add column if not exists active boolean not null default true;

-- Cambia el tipo de retorno (void → text), así que hay que soltarla primero.
drop function if exists public.delete_bar_table(uuid);

create function public.delete_bar_table(p_id uuid)
returns text
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo un encargado puede quitar mesas';
  end if;

  -- Con historial no se borra: se da de baja. Sigue existiendo para que las
  -- ventas viejas conserven a qué mesa pertenecían, pero sale de operación.
  if exists (select 1 from public.orders where table_id = p_id) then
    update public.tables set active = false where id = p_id;
    return 'baja';
  end if;

  delete from public.tables where id = p_id;
  return 'borrada';
end;
$$;

create or replace function public.enable_bar_table(p_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo un encargado puede habilitar mesas';
  end if;

  update public.tables set active = true where id = p_id;
end;
$$;

create or replace function public.pool_end_session(
  p_session_id uuid,
  p_source     text default 'panel'
)
returns public.pool_sessions
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_session  public.pool_sessions;
  v_fin      timestamptz;
  v_rate     public.products;
  v_correcto numeric(10,2);
  v_cobrado  numeric(10,2);
  v_a_quitar numeric(10,2);
  v_compra   public.pool_purchases;
begin
  if not public.is_staff() then
    raise exception 'Solo el personal puede terminar una partida';
  end if;

  select * into v_session
    from public.pool_sessions
   where id = p_session_id and status = 'activa';

  if v_session.id is null then
    raise exception 'La partida no existe o ya está terminada';
  end if;

  -- Si venció el plazo, terminó cuando venció, no cuando alguien se acordó de
  -- tocar el botón.
  v_fin := least(now(), v_session.ends_at);

  update public.pool_sessions
     set status           = case when p_source = 'plazo' then 'terminada' else 'cancelada' end,
         ended_at         = v_fin,
         -- Ídem: se mide, no se factura. Ver la nota en pool_expire_due().
         minutes_played   = round(extract(epoch from (v_fin - v_session.started_at)) / 60)::integer,
         closed_by        = auth.uid(),
         closed_by_source = case when p_source = 'plazo' then 'plazo' else 'panel' end
   where id = v_session.id
  returning * into v_session;

  if p_source <> 'plazo' then
    select * into v_rate from public.products where is_pool_rate limit 1;

    if v_rate.id is not null then
      v_correcto := round((coalesce(v_session.minutes_played, 0)::numeric / 60) * v_rate.price, 2);

      select coalesce(sum(amount), 0) into v_cobrado
        from public.pool_purchases
       where session_id = v_session.id;

      v_a_quitar := greatest(0, v_cobrado - v_correcto);

      if v_a_quitar > 0 then
        for v_compra in
          select * from public.pool_purchases
           where session_id = v_session.id
           order by created_at desc
        loop
          exit when v_a_quitar <= 0;

          if v_compra.amount <= v_a_quitar then
            if v_compra.order_item_id is not null then
              delete from public.order_items where id = v_compra.order_item_id;
            end if;
            update public.pool_purchases set amount = 0 where id = v_compra.id;
            v_a_quitar := v_a_quitar - v_compra.amount;
          else
            if v_compra.order_item_id is not null then
              update public.order_items
                 set unit_price = greatest(0, unit_price - v_a_quitar)
               where id = v_compra.order_item_id;
            end if;
            update public.pool_purchases
               set amount = amount - v_a_quitar
             where id = v_compra.id;
            v_a_quitar := 0;
          end if;
        end loop;
      end if;
    end if;
  end if;

  return v_session;
end;
$$;

notify pgrst, 'reload schema';
