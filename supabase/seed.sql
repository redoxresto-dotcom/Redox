-- =============================================================================
--  Datos iniciales de prueba. Ejecutar DESPUÉS de schema.sql.
--  Correr de nuevo no duplica nada.
-- =============================================================================

-- 12 mesas del salón
insert into public.tables (number)
select generate_series(1, 12)
on conflict (number) do nothing;

-- Catálogo de arranque
insert into public.products (name, price, cost, category)
values
  ('Cerveza tirada 500ml', 220, 90,  'bebida'),
  ('Cerveza botella',      190, 80,  'bebida'),
  ('Refresco',             120, 45,  'bebida'),
  ('Agua mineral',          90, 30,  'bebida'),
  ('Whisky medida',        320, 130, 'bebida'),
  ('Fernet con cola',      280, 110, 'bebida'),
  ('Papas fritas',         230, 70,  'comida'),
  ('Picada para 2',        620, 240, 'comida'),
  ('Hamburguesa',          450, 180, 'comida'),
  ('Chivito',              520, 210, 'comida'),
  ('Hora de pool',         300, 0,   'otro')
on conflict do nothing;
