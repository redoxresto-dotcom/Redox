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
| 5 | [`supabase/004_estaciones.sql`](supabase/004_estaciones.sql) | Estaciones (barra / cocina) y estado por ítem |
| 6 | [`supabase/005_caja.sql`](supabase/005_caja.sql) | Medios de pago, turnos de caja y arqueo |
| 7 | [`supabase/006_reportes.sql`](supabase/006_reportes.sql) | Funciones de reporte de ventas |
| 8 | [`supabase/007_salon.sql`](supabase/007_salon.sql) | Sectores y plano del salón |
| 9 | [`supabase/008_carta.sql`](supabase/008_carta.sql) | Carta pública y cierre de la filtración de costos |
| 10 | [`supabase/009_gerente.sql`](supabase/009_gerente.sql) | Rol gerente y jerarquía de permisos |

Todos son idempotentes: se pueden volver a correr sin romper nada.

### 2. Crear el primer usuario

**Authentication** → **Users** → **Add user** → *Create new user*:

- Email y contraseña del encargado.
- Marcar **Auto Confirm User** (si no, Supabase le manda un mail de confirmación).

> El **primer usuario** que se cree queda automáticamente como `gerente`.
> Los siguientes entran como `mozo`.
>
> De ahí en más, el alta se hace desde **/admin/usuarios** y no desde el panel
> de Supabase.

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

Cuatro niveles, aplicados por la base de datos (RLS y triggers), no solo por
la interfaz:

| | `anon` (cliente con QR) | `mozo` | `admin` | `gerente` |
|---|---|---|---|---|
| Ver mesas | ✅ | ✅ | ✅ | ✅ |
| Ver la carta pública (vista `menu`) | ✅ | ✅ | ✅ | ✅ |
| Leer `products`, con sus costos | ❌ | ✅ | ✅ | ✅ |
| Crear alertas (`llamar_mozo` / `pedir_cuenta`) | ✅ | ✅ | ✅ | ✅ |
| Ver / resolver alertas | ver | ✅ | ✅ | ✅ |
| Ver y operar cuentas (`orders`, `order_items`) | ❌ | ✅ | ✅ | ✅ |
| Pantallas de barra y cocina (`/estacion`) | ❌ | ✅ | ✅ | ✅ |
| Abrir la caja | ❌ | ✅ | ✅ | ✅ |
| Cerrar la caja y arquear | ❌ | ❌ | ✅ | ✅ |
| Reportes y exportación | ❌ | ❌ | ✅ | ✅ |
| Editar el plano del salón | ❌ | ❌ | ✅ | ✅ |
| Editar catálogo (precios y costos) | ❌ | ❌ | ✅ | ✅ |
| Alta, baja y cambio de nivel de usuarios | ❌ | ❌ | ❌ | ✅ |

### La jerarquía

`mozo` (1) < `admin` (2) < `gerente` (3). Una sola regla, y vale para todo:
**se manda sobre quien tiene rango estrictamente menor.** Un gerente crea, edita
y da de baja admins y mozos; un admin, solo mozos; un mozo, a nadie. Nadie puede
cambiarse el rol a sí mismo ni borrar su propio usuario, y tiene que quedar
siempre al menos un gerente activo.

El gerente hereda todo lo del admin sin duplicar una sola regla: `is_admin()`
pregunta por el rango y no por el nombre del rol, así que las diecisiete reglas
que ya la usaban aceptan gerente sin haberlas tocado.

**Por qué el cambio de rol lo gobierna un trigger y no una policy.** La RLS
decide si una fila se puede tocar, no qué columna. La policy anterior dejaba
editar la fila propia —para el nombre— y con eso alcanzaba para correr
`update profiles set role = 'admin' where id = auth.uid()` y ascenderse solo.
Un trigger sí puede mirar qué cambió, y es el que ahora aplica la jerarquía.

**Las altas y bajas de usuarios usan `service_role`**, porque crear o borrar una
cuenta de Auth no se puede hacer con la sesión de nadie. Esa clave bypassea RLS
y triggers, así que en esas dos operaciones la jerarquía la verifica el código
de la Server Action. El cambio de rol y la baja lógica van con la sesión del
gerente justamente para que los verifique Postgres.

Detalles que conviene tener presentes:

- Las Server Actions del POS operan **como el mozo logueado**, no con la clave maestra: si un mozo intenta algo que no le toca, lo frena Postgres.
- `proxy.ts` valida la sesión con `getUser()` (verifica el token contra Supabase) en vez de `getSession()`, que solo lee una cookie falsificable.
- `active = false` en un perfil revoca todos los permisos sin borrar el historial de ventas.
- La `service_role` queda reservada para el webhook de hardware (Fase 4), donde no hay usuario humano.

## Barra y cocina

El mozo carga *dos negronis y una picada* en la mesa y el sistema reparte solo:
los negronis aparecen en **/estacion/barra**, la picada en **/estacion/cocina**.
Cada pantalla ve únicamente lo suyo.

Se abre una vez por monitor, con el usuario de un mozo, y se deja puesta. El
botón ⛶ la pone en pantalla completa. El 🔊 avisa con un chirrido cada vez que
entra una comanda nueva, más grave que el de las alertas del salón para que en
la barra se distinga un pedido de un llamado de mesa.

**Quién prepara qué lo define el catálogo.** Cada producto tiene su estación en
`/admin/catalogo`:

| Estación | Para qué |
|---|---|
| `barra` | Tragos, cerveza, refrescos |
| `cocina` | Picadas, hamburguesas, todo lo que se cocina |
| `ninguna` | Lo que se cobra sin que nadie lo prepare: la hora de pool, un descorche |

Lo marcado como `ninguna` no genera comanda: nace listo y no aparece en ninguna
pantalla.

**Cada línea avanza `pedido` → `preparando` → `listo`.** Se puede saltar directo
a listo (un trago que se sirve al toque) y se puede volver atrás, que es lo que
salva un toque de más. Lo ya marcado como listo sigue visible 20 minutos para
poder deshacerlo sin ir a buscar a la caja.

Una comanda que lleva más de **8 minutos** esperando se marca en ámbar; pasados
**15**, en rojo y parpadeando. Los umbrales están en `lib/types.ts`
(`ITEM_WARN_MINUTES` / `ITEM_LATE_MINUTES`).

En el salón, la mesa queda en **celeste** mientras tenga algo sin entregar, en
ámbar cuando está abierta con todo entregado, y sin color cuando está libre.

## La carta del QR

El cliente escanea, toca **Ver la carta** y ve lo mismo que está cargado en la
caja, agrupado por categoría, con precio y descripción. Se cambia un precio en
`/admin/catalogo` y cambia en la mesa: no hay una segunda carta que mantener.

En el catálogo, cada producto tiene **mostrar en la carta** y una descripción
opcional. Lo que no se muestra sigue existiendo para la caja: la tarifa de pool
—que se cobra prorrateada por minuto y como línea de precio fijo confunde—, un
descorche, o algo que se dejó de servir pero sigue en el histórico de ventas.

La carta se abre encima de los botones de llamado y no debajo: quien abre el QR
para pedir la cuenta tiene que seguir teniendo el botón a un toque.

### Por qué hay una vista `menu` y no se lee `products`

La clave anónima de Supabase viaja al navegador de todos los que escanean un
QR. La RLS filtra **filas**, no **columnas**, así que la policy que dejaba a
`anon` leer el catálogo le dejaba leer también el **costo** de cada producto.
Estaba abierto desde la primera versión y se verificó contra la base: devolvía
los costos.

La 008 lo cierra. `anon` pierde el acceso directo a `products` y en su lugar hay
una vista `menu` con solo id, nombre, precio, descripción y categoría, filtrada
por activo y visible. La vista corre con los permisos de su dueño, que es lo que
permite sacarle a `anon` todo acceso a la tabla.

**Si mañana hay que publicar un dato nuevo del producto, se agrega a la vista.**
Nunca devolviendo a `anon` la lectura de `products`.

## El plano del salón

En **/admin/salon** el encargado arrastra cada mesa al lugar donde está
físicamente. El plano que queda es el que ve la caja en `/admin`, con los
colores de estado encima.

→ Sectores en pestañas: salón, terraza, planta alta, lo que el bar tenga
→ Cada mesa con forma (redonda, cuadrada, rectangular), tamaño, rotación y
  cantidad de sillas
→ Arrastrar con el mouse o el dedo; con la mesa elegida, las flechas la mueven
  de a diez, y con Shift de a cincuenta
→ Alta y baja de mesas, y cambio de sector desde el panel

**Por qué plano libre y no grilla.** Los sistemas de plaza ponen las mesas en
una cuadrícula de celdas iguales. Es más ordenado y no se puede hacer feo, pero
no representa la mesa larga contra la ventana ni la redonda de seis del rincón.
El pedido acá era que el plano se parezca al salón real, así que las posiciones
son libres y se pegan a una grilla de 10 para que dos mesas juntas queden
derechas.

**Las sillas no son objetos.** Se guarda cuántas tiene cada mesa y se dibujan
alrededor, repartidas por el contorno si es redonda y caminando el perímetro si
tiene lados. Sesenta sillas sueltas para doce mesas se ven igual en pantalla y
hay que reacomodarlas a mano cada vez que se mueve una mesa. Si algún día hacen
falta de verdad, se agrega una tabla de sillas con su desplazamiento respecto de
la mesa: es aditivo, no hay que rehacer el plano.

**Las medidas son fijas.** El plano vive en un lienzo de 1400×900 y cada
pantalla lo escala a su ancho. Así el mismo salón se ve igual en el monitor de
la caja y en la tablet del mozo, y mover una mesa no depende del tamaño de la
pantalla desde la que se movió.

**El permiso vive en un RPC, no en la policy.** `tables` tiene policy de
personal porque el mozo necesita abrir y cerrar mesas; el candado de admin va en
`save_table_layout`, donde se puede distinguir mover una mesa de ocuparla.

## Caja, turnos y arqueo

Cobrar exige **un turno de caja abierto**. Sin turno, una venta no cae en ningún
arqueo y el cierre del día deja de cerrar, así que la base directamente no lo
permite. El tablero del salón avisa antes con un cartel y el botón de cobrar
queda apagado: nadie se entera con la mesa esperando y el ticket en la mano.

En **/admin/caja**:

1. **Abrir el turno** declarando el fondo de cambio. Lo puede hacer cualquiera
   del personal — si dependiera del encargado, un sábado sin él nadie podría
   cobrar.
2. Durante el turno se ve lo vendido, abierto por medio de pago, y cuánto
   efectivo debería haber en el cajón: *fondo + ventas en efectivo*.
3. **Cerrar y arquear**: se cuenta la caja, se escribe el número, y el sistema
   deja registrada la diferencia. Solo el encargado.

Cada cuenta se cobra con **un medio de pago** —efectivo, débito, crédito,
transferencia u otro— y queda pegada al turno que estaba abierto. El esperado se
congela al cerrar: corregir una cuenta vieja no reescribe un arqueo ya firmado.

## Reportes

**/admin/reportes**, solo admin. Se elige el período y se ve venta total,
tickets, ticket promedio y unidades, más la apertura por medio de pago, por
franja horaria, por día de la semana, y el ranking de más y menos vendidos —
incluida la lista de lo que **no vendió una sola unidad** en el período, que es
la que sirve para sacar cosas de la carta.

Todo se agrega en la base (`supabase/006_reportes.sql`). Traer las líneas crudas
para sumarlas en JavaScript funciona el primer mes y se cae solo el día que el
bar lleve un año de ventas. Lo horario se calcula en hora de Montevideo: si no,
una venta de la una de la mañana del sábado aparece como domingo.

**Exportación:** botones que bajan CSV con punto y coma y coma decimal, que es
lo que Excel en español abre de un doble clic sin pasar por el asistente de
importación. Si el contador necesita `.xlsx` nativo hay que sumar una librería;
avisar antes de prometerlo.

Los reportes son de **venta**: cuánto salió de cada cosa, cuándo y cómo se pagó.
No calculan rentabilidad por trago, porque el costo cargado es el del catálogo y
no el de la última compra al proveedor.

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
- **La estación se congela en la línea** al momento de la venta, igual que el precio: mover un producto de barra a cocina no hace saltar de pantalla las comandas que ya están en curso.
- **Pedir otra unidad de algo ya preparado abre una línea nueva.** Sumar sobre la vieja dejaría el pedido invisible para la estación, que ya la había dado por cerrada.
- **Sin turno de caja abierto no se cobra**, y hay **un solo turno abierto a la vez** (índice único parcial).
- **El arqueo se congela al cerrar**: el esperado queda guardado calculado, no se recalcula al mirarlo.
- **Una mesa que ya facturó no se borra.** La baja se rechaza con un mensaje claro en vez de llevarse puesto el histórico de ventas.
- **Un sector con mesas adentro no se borra**: primero hay que moverlas, o desaparecerían del plano sin que nadie entienda a dónde fueron.

## Estructura

```
app/
  page.tsx                Portada
  login/                  Ingreso de mozos (Server Action + Supabase Auth)
  admin/
    layout.tsx            Guard de sesión + navegación + monitor de alertas
    salon/
      page.tsx            Editor del plano (solo admin)
      floor-editor.tsx    Arrastrar mesas, sectores y propiedades
      actions.ts          Guardar plano, alta/baja de mesas y sectores
    usuarios/
      page.tsx            Personal y niveles (solo gerente)
      user-manager.tsx    Alta, baja, cambio de nivel
      actions.ts          createStaff / changeRole / setActive / deleteStaff
    caja/
      page.tsx            Turno abierto, resumen por medio de pago e historial
      caja-client.tsx     Abrir turno, arqueo y cierre
      actions.ts          openShift() / closeShift()
    reportes/
      page.tsx            Reportes por período (solo admin)
      data.ts             Rango del período y llamadas a las funciones de la base
      export/route.ts     Descarga CSV para el contador
    page.tsx              Dashboard de salón (mesas + panel de carga)
    actions.ts            Abrir mesa, cargar productos, cobrar, resolver alertas
    _components/
      salon-board.tsx     Plano del salón por sector y panel lateral
      floor-table.tsx     Dibujo de una mesa con sus sillas, compartido
      alert-monitor.tsx   Alertas en tiempo real (WebSocket)
    catalogo/
      page.tsx            ABM de productos (solo admin)
      actions.ts          Alta, edición y baja de productos
      catalog-manager.tsx Tabla editable con márgenes
    qr/page.tsx           Códigos QR imprimibles por mesa (solo admin)
  table/[id]/
    page.tsx              Web del cliente — llega escaneando el QR
    table-client.tsx      Botones de llamado, estado en vivo y la carta
    actions.ts            Inserta la alerta (sin sesión, vía RLS de anon)
  estacion/
    layout.tsx            Chrome mínimo, sin la barra de alertas del salón
    page.tsx              Elegir pantalla (barra / cocina)
    actions.ts            Avanzar y deshacer el estado de una comanda
    [station]/
      page.tsx            Comandas de la estación, agrupadas por mesa
      station-board.tsx   Tablero en vivo, relojes de espera y avisos
  api/pool-webhook/
    route.ts              Puente para el lector RFID de las mesas de pool
lib/
  auth.ts                 requireStaff() / requireAdmin() / requireManager()
  beep.ts                 Chirrido por Web Audio, compartido por las pantallas
  floor.ts                Medidas del plano, grilla y posición de las sillas
  types.ts                Tipos del dominio + formato de moneda (UYU)
  supabase/client.ts      Cliente de navegador (sesión por cookie, Realtime)
  supabase/server.ts      Cliente de servidor con la sesión del mozo
  supabase/admin.ts       Cliente service_role (solo webhook de hardware)
proxy.ts                  Refresco de sesión + guard de /admin
supabase/
  schema.sql              Tablas, triggers, RPC, Realtime
  seed.sql                Mesas y catálogo de prueba
  002_auth.sql            Perfiles, roles y RLS definitiva
  003_pool.sql            Bitácora de pool y tarifa horaria
  004_estaciones.sql      Estaciones y estado por ítem
  005_caja.sql            Medios de pago, turnos y arqueo
  006_reportes.sql        Funciones de reporte
  007_salon.sql           Sectores y plano del salón
  008_carta.sql           Carta pública (vista menu)
  009_gerente.sql         Rol gerente y jerarquía
```
