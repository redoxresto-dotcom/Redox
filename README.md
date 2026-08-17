# POS Venta — Punta Carretas

Punto de venta y gestión de salón para bar. Next.js 16 (App Router) + React 19 + Tailwind 4 + Supabase (PostgreSQL + Auth + Realtime).

## Puesta en marcha

### 1. Crear el esquema en Supabase

Proyecto **pos-venta-puntacarretas** (`mwxocugpawwpxdbwhrup`) → **SQL Editor** → **New query**.
Ejecutar **en este orden**:

| # | Archivo | Qué hace |
|---|---|---|
| 1 | [`supabase/schema.sql`](supabase/schema.sql) | Tablas, triggers, RPC, Realtime |
| 2 | [`supabase/seed.sql`](supabase/seed.sql) | 12 mesas + catálogo de arranque |
| 3 | [`supabase/002_auth.sql`](supabase/002_auth.sql) | Perfiles de mozos, roles y RLS definitiva |
| 4 | [`supabase/003_pool.sql`](supabase/003_pool.sql) | Bitácora de mesas de pool y tarifa horaria |

Los tres son idempotentes: se pueden volver a correr sin romper nada.

### 2. Crear el primer usuario

**Authentication** → **Users** → **Add user** → *Create new user*:

- Email y contraseña del encargado.
- Marcar **Auto Confirm User** (si no, Supabase le manda un mail de confirmación).

> El **primer usuario** que se cree queda automáticamente como `admin`.
> Los siguientes entran como `mozo`.

Para dar de alta más mozos, repetir el paso. Para cambiar un rol a mano:

```sql
update public.profiles set role = 'admin' where full_name = 'Lucas';
```

Para dar de baja a alguien sin perder su historial:

```sql
update public.profiles set active = false where full_name = 'Fulano';
```

### 3. Variables de entorno

Copiar `.env.local.example` a `.env.local` y completar:

| Variable | Dónde sacarla | Notas |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Ya viene completa | `https://mwxocugpawwpxdbwhrup.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Project Settings → **API Keys** → `anon` / `publishable` | Pública, protegida por RLS |
| `SUPABASE_SERVICE_ROLE_KEY` | Project Settings → **API Keys** → `service_role` / `secret` | **Privada.** Nunca con prefijo `NEXT_PUBLIC_` |
| `POOL_WEBHOOK_SECRET` | Lo generás vos | Token de las mesas de pool (Fase 4) |
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` en desarrollo | Se usa para generar los QR |

### 4. Levantar el proyecto

```bash
npm run dev
```

Entrar a http://localhost:3000/admin — redirige a `/login`.

## Modelo de seguridad

Tres niveles, aplicados por la base de datos (RLS), no solo por la interfaz:

| | `anon` (cliente con QR) | `mozo` | `admin` |
|---|---|---|---|
| Ver mesas | ✅ | ✅ | ✅ |
| Ver catálogo activo | ✅ | ✅ | ✅ |
| Crear alertas (`llamar_mozo` / `pedir_cuenta`) | ✅ | ✅ | ✅ |
| Ver / resolver alertas | ver | ✅ | ✅ |
| Ver y operar cuentas (`orders`, `order_items`) | ❌ | ✅ | ✅ |
| Editar catálogo (precios y costos) | ❌ | ❌ | ✅ |
| Gestionar usuarios | ❌ | ❌ | ✅ |

Detalles que conviene tener presentes:

- Las Server Actions del POS operan **como el mozo logueado**, no con la clave maestra: si un mozo intenta algo que no le toca, lo frena Postgres.
- `proxy.ts` valida la sesión con `getUser()` (verifica el token contra Supabase) en vez de `getSession()`, que solo lee una cookie falsificable.
- `active = false` en un perfil revoca todos los permisos sin borrar el historial de ventas.
- La `service_role` queda reservada para el webhook de hardware (Fase 4), donde no hay usuario humano.

## Los códigos QR de las mesas

Entrá a **/admin/qr** (solo admin) e imprimí la página: un código por mesa, listo
para pegar.

Cada QR apunta a `/table/<uuid-de-la-mesa>`, **no** a `/table/7`. Es a propósito:
con el número de mesa en la URL, cualquiera podría escribir `/table/9` desde
afuera y hacer sonar la barra por una mesa ajena. Con el UUID, el llamado solo
puede salir de quien tiene el código delante.

Antes de imprimir para producción, definí `NEXT_PUBLIC_SITE_URL` con el dominio
final: los QR llevan la URL grabada y cambiar de dominio obliga a reimprimirlos.

## Webhook de las mesas de pool

`POST /api/pool-webhook` — puente entre el lector RFID/de tarjetas y el POS.

```bash
curl -X POST http://localhost:3000/api/pool-webhook \
  -H "X-Pool-Secret: $POOL_WEBHOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"device_id":"pool-1","event":"session_end","table_number":3,"minutes":45,"external_id":"pool1-0042"}'
```

| Campo | Obligatorio | Notas |
|---|---|---|
| `device_id` | sí | Identificador del lector |
| `event` | sí | `session_start` o `session_end` |
| `table_number` o `table_id` | sí | Número de mesa, o su UUID |
| `minutes` | en `session_end` | Duración de la partida |
| `amount` | no | Importe fijo; si viene, pisa el cálculo por minuto |
| `card_uid` | no | UID de la tarjeta |
| `external_id` | **muy recomendado** | Clave de idempotencia |

Autenticación por secreto compartido en el header `X-Pool-Secret` (también se
acepta `Authorization: Bearer`), comparado en tiempo constante. Es lo único que
separa este endpoint de internet.

**La tarifa sale del catálogo.** El producto marcado con `is_pool_rate = true`
—por defecto *Hora de pool*— define el precio por hora, y el webhook lo
prorratea por minuto: 45 min de una tarifa de $300/h se cobran $225. Así el
encargado cambia la tarifa desde `/admin/catalogo` sin tocar código.

**Idempotencia.** Si el lector reintenta por un corte de red, el mismo
`external_id` devuelve `duplicate: true` sin volver a cobrar. Sin `external_id`
no hay protección: cada POST cobra.

Todo lo que llega queda en `pool_sessions` con el payload crudo, incluso los
eventos rechazados — sirve para diagnosticar un lector mal configurado sin
depender de los logs del servidor.

`GET /api/pool-webhook` responde un health check sin datos sensibles, para el
instalador del hardware.

## Reglas de negocio en la base

No dependen de la interfaz — las garantiza Postgres:

- **Una sola cuenta abierta por mesa** (índice único parcial).
- **Una sola alerta pendiente por tipo y mesa**: si el cliente toca "Llamar al mozo" cinco veces, sigue habiendo una alerta.
- **`orders.total` se recalcula solo** con cada alta, cambio o baja de línea.
- **Precio y costo se congelan** en `order_items` al momento de la venta: cambiar el precio de un producto no altera las cuentas históricas.
- **Abrir y cerrar mesa son atómicos** (`open_table_order` / `close_table_order`): cuenta, estado de la mesa y alertas se mueven juntos o no se mueven.
- **Una mesa abierta por error se puede liberar** sin cobrar, solo mientras no tenga consumos. La cuenta vacía se borra en vez de cobrarse en $0, para no dejar tickets fantasma en el histórico.

## Estructura

```
app/
  page.tsx                Portada
  login/                  Ingreso de mozos (Server Action + Supabase Auth)
  admin/
    layout.tsx            Guard de sesión + navegación + monitor de alertas
    page.tsx              Dashboard de salón (mesas + panel de carga)
    actions.ts            Abrir mesa, cargar productos, cobrar, resolver alertas
    _components/
      salon-board.tsx     Cuadrícula de mesas y panel lateral
      alert-monitor.tsx   Alertas en tiempo real (WebSocket)
    catalogo/
      page.tsx            ABM de productos (solo admin)
      actions.ts          Alta, edición y baja de productos
      catalog-manager.tsx Tabla editable con márgenes
    qr/page.tsx           Códigos QR imprimibles por mesa (solo admin)
  table/[id]/
    page.tsx              Web del cliente — llega escaneando el QR
    table-client.tsx      Botones de llamado + estado en vivo
    actions.ts            Inserta la alerta (sin sesión, vía RLS de anon)
  api/pool-webhook/
    route.ts              Puente para el lector RFID de las mesas de pool
lib/
  auth.ts                 requireStaff() / requireAdmin()
  types.ts                Tipos del dominio + formato de moneda (UYU)
  supabase/client.ts      Cliente de navegador (sesión por cookie, Realtime)
  supabase/server.ts      Cliente de servidor con la sesión del mozo
  supabase/admin.ts       Cliente service_role (solo webhook de hardware)
proxy.ts                  Refresco de sesión + guard de /admin
supabase/
  schema.sql              Tablas, triggers, RPC, Realtime
  seed.sql                Mesas y catálogo de prueba
  002_auth.sql            Perfiles, roles y RLS definitiva
```
