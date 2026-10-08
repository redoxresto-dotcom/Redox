# Redox — Punta Carretas

Sistema de gestión de salón, barra y cocina para el bar **Redox**, sobre
**NexoRestUy**.

Redox es el cliente y NexoRestUy es el producto: el nombre del bar manda en las
pantallas —ingreso, encabezado y la mesa del cliente— y el sistema firma abajo
del ingreso. Personalizarlo para otro local es cambiar los archivos de
`public/` y el componente de marca. Next.js 16 (App Router) + React 19 + Tailwind 4 + Supabase (PostgreSQL + Auth + Realtime).

## Puesta en marcha

### 1. Crear el esquema en Supabase

Proyecto **redox** (`yqzsrzmzramiandpwrni`) → **SQL Editor** → **New query**.
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
| 11 | [`supabase/010_mesas_mozo.sql`](supabase/010_mesas_mozo.sql) | Tomar, transferir y soltar mesas |
| 12 | [`supabase/011_estaciones_usuario.sql`](supabase/011_estaciones_usuario.sql) | Usuarios de barra y de cocina |
| 13 | [`supabase/012_entregado.sql`](supabase/012_entregado.sql) | Estado «entregado» y pedido completo |
| 14 | [`supabase/013_pool.sql`](supabase/013_pool.sql) | Mesas de pool con tiempo prepago |
| 15 | [`supabase/014_pool_jugadores.sql`](supabase/014_pool_jugadores.sql) | Quién está jugando en cada mesa de pool |
| 16 | [`supabase/015_combos.sql`](supabase/015_combos.sql) | Combos y promociones |
| 17 | [`supabase/016_nombre_mesa.sql`](supabase/016_nombre_mesa.sql) | Nombre de mesa |
| 18 | [`supabase/017_cancelar_pedido.sql`](supabase/017_cancelar_pedido.sql) | Cancelar un pedido |
| 19 | [`supabase/018_cancelar_pedido_mozo.sql`](supabase/018_cancelar_pedido_mozo.sql) | Cancelar un pedido también es del mozo |
| 20 | [`supabase/019_imagenes_productos.sql`](supabase/019_imagenes_productos.sql) | Imágenes de producto (bucket `product-images`) |
| 21 | [`supabase/020_alertas_mesa_abierta.sql`](supabase/020_alertas_mesa_abierta.sql) | Los llamados del cliente solo valen con la mesa abierta |
| 22 | [`supabase/020_reporte_por_mozo.sql`](supabase/020_reporte_por_mozo.sql) | Reporte de ventas por mozo |
| 23 | [`supabase/021_editar_numero_mesa.sql`](supabase/021_editar_numero_mesa.sql) | Editar el número de mesa desde el plano |
| 24 | [`supabase/022_pool_reservas.sql`](supabase/022_pool_reservas.sql) | Reservas de mesas de pool |
| 25 | [`supabase/023_pool_nombre_mesa.sql`](supabase/023_pool_nombre_mesa.sql) | La sección de pool muestra el nombre de la mesa |
| 26 | [`supabase/024_barra_ventas.sql`](supabase/024_barra_ventas.sql) | Pantalla de ventas de la barra |
| 27 | [`supabase/025_login_documento.sql`](supabase/025_login_documento.sql) | Login por documento (C.I.) |
| 28 | [`supabase/026_combo_vigencia.sql`](supabase/026_combo_vigencia.sql) | Vigencia de combos |
| 29 | [`supabase/027_barra_mesa_unica.sql`](supabase/027_barra_mesa_unica.sql) | La barra vende directo, sin elegir mesa |
| 30 | [`supabase/028_barra_open_table.sql`](supabase/028_barra_open_table.sql) | Abrir cuenta de barra sin mozo |
| 31 | [`supabase/029_menu_carta.sql`](supabase/029_menu_carta.sql) | Repara la vista `menu` (foto, combo y vigencia) |
| 32 | [`supabase/030_alertas_sin_mesa_abierta.sql`](supabase/030_alertas_sin_mesa_abierta.sql) | Revierte el requisito de mesa abierta para los llamados |
| 33 | [`supabase/031_ventas_manuales.sql`](supabase/031_ventas_manuales.sql) | Ventas cargadas a mano (corte de luz o sin internet) |
| 34 | [`supabase/032_agregar_producto_rpc.sql`](supabase/032_agregar_producto_rpc.sql) | Agregar un producto a la mesa en un solo viaje a la base |
| 35 | [`supabase/033_acciones_salon_rpc.sql`](supabase/033_acciones_salon_rpc.sql) | Menos viajes a la base en las acciones del salón |
| 36 | [`supabase/034_pool_reservas_personal.sql`](supabase/034_pool_reservas_personal.sql) | El mozo también puede cargar reservas de pool |
| 37 | [`supabase/035_pool_reserva_contacto_libre.sql`](supabase/035_pool_reserva_contacto_libre.sql) | La reserva de pool pide un contacto libre, no un celular |
| 38 | [`supabase/036_bebidas_con_sin_alcohol.sql`](supabase/036_bebidas_con_sin_alcohol.sql) | La carta separa bebidas con y sin alcohol |
| 39 | [`supabase/037_baja_mesas_y_ajuste_pool.sql`](supabase/037_baja_mesas_y_ajuste_pool.sql) | Baja de mesas con historial y ajuste del cobro de pool |

Todos son idempotentes: se pueden volver a correr sin romper nada.

### 2. Crear el primer usuario

**Authentication** → **Users** → **Add user** → *Create new user*:

- Email: el documento del encargado seguido de `@redox.local` (por ejemplo
  `12345678@redox.local`). El personal entra con su documento, y por detrás se
  arma ese email.
- Contraseña del encargado.
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
| `NEXT_PUBLIC_SUPABASE_URL` | Ya viene completa | `https://yqzsrzmzramiandpwrni.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Project Settings → **API Keys** → `anon` / `publishable` | Pública, protegida por RLS |
| `SUPABASE_SERVICE_ROLE_KEY` | Project Settings → **API Keys** → `service_role` / `secret` | **Privada.** Nunca con prefijo `NEXT_PUBLIC_` |
| `POOL_WEBHOOK_SECRET` | Lo generás vos | Token de las mesas de pool (Fase 4) |
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` en desarrollo, `https://redox-ovkw.vercel.app` en producción | Se usa para generar los QR |

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
| Vender tiempo de pool y terminar partidas | ❌ | ✅ | ✅ | ✅ |
| Configurar las mesas de pool | ❌ | ❌ | ✅ | ✅ |

### Barra y cocina son otro trabajo, no otro escalón

`barra` y `cocina` pesan lo mismo que un mozo —rango 1, sin mando sobre nadie—
y lo único que cambia es a qué pantalla entran: sus comandas, con **todas** las
mesas. Un mozo entra a las suyas. Cada uno cae en su lugar al iniciar sesión, y
si escribe una URL que no le toca, rebota.

Esa separación es la que hace posible filtrar mesas por dueño. Mientras la
cocina entraba con un usuario de mozo, el mismo nivel necesitaba ver todas las
mesas para las comandas y solo las suyas para el salón.

### Mesas: quién puede qué

| | Mozo | Encargado |
|---|---|---|
| Tomar una mesa libre | ✅ solo para sí mismo | ✅ |
| Ver la mesa de otro mozo | ❌ | ✅ |
| Transferirla | ✅ si es suya | ✅ |
| Soltarla sin cobrar | ❌ | ✅ |
| Cobrarla | ✅ | ✅ |

Cobrar libera la mesa y lo puede hacer cualquiera: el cliente quiere pagar y no
siempre está el mozo que lo atendió.

**El filtro de qué mesas ve cada uno vive en la pantalla, no en la base.** Las
pantallas de barra y cocina necesitan leer todas las mesas para mostrar el
número de cada comanda. Los llamados del QR también se ven completos: un llamado
que nadie ve es peor que un llamado que atiende otro.

**Reglas del dato y reglas de permiso son distintas.** Los triggers no aplican
permisos cuando no hay usuario detrás —service_role, editor SQL—, porque si no
no habría forma de arrancar el sistema. Pero las reglas del dato valen siempre:
una mesa no puede quedar a nombre de alguien que no atiende mesas, y nadie sale
del salón —a cocina, o dado de baja— con mesas abiertas a su nombre. Esas dos
frenan incluso con la clave maestra.

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

**Cada línea avanza `pedido` → `preparando` → `listo` → `entregado`.** Los tres
primeros los mueve la estación; el último, el mozo, cuando la levanta de la
barra y la deja en la mesa.

`listo` no significa terminado: significa **pronto sobre la barra esperando que
alguien lo lleve**. Ese corte es el que hace que el aviso de pedido completo se
pueda apagar, y de paso deja medido cuánto tarda un plato entre que está pronto
y que llega a la mesa — la comida que se enfría esperando al mozo. Está en
`/admin/reportes`, abierto por estación.

**Cuando la barra y la cocina terminaron todo lo de una mesa, la mesa se pone
verde y dice «pedido completo».** Mientras falte algo en una estación sigue
celeste, aunque ya haya cosas prontas: media comanda pronta no es una bandeja
para llevar.

Se puede saltar directo a listo —un trago que se sirve al toque— y se puede
volver atrás, que es lo que salva un toque de más. Lo ya marcado como listo
sigue visible 20 minutos en la estación para poder deshacerlo sin ir a buscar a
la caja; lo entregado desaparece y no vuelve.

Una comanda que lleva más de **8 minutos** esperando se marca en ámbar; pasados
**15**, en rojo y parpadeando. Los umbrales están en `lib/types.ts`
(`ITEM_WARN_MINUTES` / `ITEM_LATE_MINUTES`).

En el salón la mesa tiene cuatro colores:

| Color | Significa |
|---|---|
| sin color | Libre |
| ámbar | Abierta, sin nada pendiente |
| celeste | La barra o la cocina todavía tienen algo |
| **verde** | **Pedido completo**: está todo pronto esperando al mozo |

## Las mesas de pool

Se **vende tiempo** y la mesa se apaga sola al terminarse:

```
se vende 1 hora → la mesa se habilita → cuenta regresiva en pantalla
→ aviso a los 5 minutos → se cumple el plazo y la mesa se apaga
```

No hay tarjetas: habilita alguien del personal desde **/admin/pool**, y el
aparato de la mesa obedece.

**La mesa de pool tiene su propia cuenta**, separada de la del salón: hay quien
viene solo a jugar y no consume nada. Por eso tampoco aparece en el tablero del
salón — vende tiempo, no comandas, y mezclarlas confunde dos trabajos distintos.

**/pool** es la pantalla del televisor: un número grande por mesa, un color por
estado y dos sonidos, uno al entrar en los últimos minutos y otro al cumplirse
el tiempo.

### Cómo se entera la mesa

El servidor no puede llamar al ESP32: está detrás del router del bar, sin IP
pública. Así que es al revés — el aparato **pregunta** cada pocos segundos a
`/api/pool-device` y guarda la hora de corte que le contestan. La misma pregunta
sirve de latido: si un aparato deja de preguntar, la tarjeta de esa mesa dice
«sin señal».

Tres reglas que la firmware tiene que respetar, y que están escritas también en
la propia ruta:

1. **Mandarse por `seconds_left`, no por `ends_at`.** Un ESP32 sin RTC arranca
   con el reloj en cualquier lado, y comparar horas absolutas contra un reloj
   equivocado apaga mesas que están pagas.
2. **Seguir contando solo si no hay respuesta.** Un corte de red no puede
   cortarle el juego a alguien que pagó.
3. **Respetar `poll_seconds`.** El servidor decide el ritmo —15 s libre, 10 s
   jugando, 3 s en los últimos dos minutos— y lo cambia sin tocar el firmware.

Un aparato con un `device_id` que no tiene mesa asignada **falla cerrado**:
queda en la bitácora y la mesa no se habilita.

### El reloj no se guarda

Se guarda `ends_at`, la hora de corte, y cada pantalla calcula cuánto falta. Un
contador guardado como número que baja se desincroniza entre pantallas y se
pierde al recargar.

Por lo mismo, **las partidas vencidas las cierra quien pase**: el aparato al
preguntar, el panel o el televisor al cargar. No hay tarea programada. Como la
hora de cierre se toma del vencimiento y no del momento en que se ejecutó, el
importe y la hora salen correctos aunque nadie mire hasta la mañana siguiente.

### El paño

Cada partida guarda los minutos que la mesa estuvo encendida, redondeados al
minuto más cercano: ahí se **mide**, no se factura. Registrar un cambio de paño
guarda las horas que tenía la mesa y reinicia el contador.

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
    mis-mesas/
      page.tsx            Las mesas que tomó el mozo
    usuarios/
      page.tsx            Personal y niveles (solo gerente)
      user-manager.tsx    Alta, baja, cambio de nivel
      actions.ts          createStaff / changeRole / setActive / deleteStaff
    pool/
      page.tsx            Las mesas de pool y su estado
      pool-board.tsx      Vender tiempo, terminar partidas y ajustes
      actions.ts          Venta, cierre, configuración y mantenimiento
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
      salon-board.tsx     Plano y lista del salón, con el recorte por dueño
      salon-data.ts       Carga compartida entre el salón y «Mis mesas»
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
  pool/
    page.tsx              Pantalla del televisor, para el salón
    pool-tv.tsx           Cuenta regresiva grande por mesa
  api/pool-device/
    route.ts              Lo que pregunta el aparato de cada mesa
app/_components/
  brand.tsx               Logo, mascota y firma del sistema
public/
  redox-logo.png          Logo del bar, con transparencia
  redox-mascota.jpg       Mascota, en la pantalla del cliente
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
  010_mesas_mozo.sql      Tomar, transferir y soltar mesas
  011_estaciones_usuario.sql  Usuarios de barra y de cocina
  012_entregado.sql       Estado entregado y pedido completo
  013_pool.sql            Mesas de pool con tiempo prepago
  014 … 037               El resto, en orden numérico (ver la tabla de arriba)
```
