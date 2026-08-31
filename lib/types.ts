export type ProductCategory = "bebida" | "comida" | "otro";
export type StaffRole = "mozo" | "barra" | "cocina" | "admin" | "gerente";
export type TableStatus = "libre" | "ocupada";
export type TableShape = "redonda" | "cuadrada" | "rectangular";
export type OrderStatus = "abierta" | "cobrada" | "cancelada";
export type AlertType = "llamar_mozo" | "pedir_cuenta";
/** Quién prepara el producto. 'ninguna' = se cobra sin pasar por nadie. */
export type Station = "barra" | "cocina" | "ninguna";
/**
 * Avance de una línea de la cuenta.
 *
 *   pedido → preparando → listo → entregado
 *          └ la estación ────┘   └ el mozo ┘
 *
 * «listo» no significa terminado: significa que está pronto sobre la barra
 * esperando que alguien lo lleve a la mesa.
 */
export type ItemStatus = "pedido" | "preparando" | "listo" | "entregado";
export type PaymentMethod =
  "efectivo" | "debito" | "credito" | "transferencia" | "otro";
export type AlertStatus = "pendiente" | "resuelta";

export type Profile = {
  id: string;
  full_name: string;
  role: StaffRole;
  active: boolean;
  /** Documento (C.I.) con el que inicia sesión. null en cuentas viejas por mail. */
  document: string | null;
  created_at: string;
};

export type Product = {
  id: string;
  name: string;
  price: number;
  cost: number;
  category: ProductCategory;
  station: Station;
  description: string | null;
  /** Si se muestra en la carta pública del QR y del sitio. */
  in_menu: boolean;
  /** Combo o promoción: un producto que agrupa a otros con un precio propio. */
  is_combo: boolean;
  /**
   * Vigencia de la promoción (solo tiene sentido en combos). Fechas `YYYY-MM-DD`
   * en hora de Montevideo. `null` = sin límite por ese lado. Fuera de la
   * ventana, el combo no se ofrece en el POS ni en la carta.
   */
  combo_valid_from: string | null;
  combo_valid_until: string | null;
  /** URL pública de la foto en Storage, o null si no tiene. */
  image_url: string | null;
  active: boolean;
  created_at: string;
};

/** Hoy en hora de Montevideo, en formato `YYYY-MM-DD`. */
export function hoyMontevideo(): string {
  return new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Montevideo",
  });
}

/** ¿El combo está dentro de su ventana de vigencia hoy? */
export function comboVigente(
  p: Pick<Product, "combo_valid_from" | "combo_valid_until">,
  hoy: string = hoyMontevideo(),
): boolean {
  if (p.combo_valid_from && p.combo_valid_from > hoy) return false;
  if (p.combo_valid_until && p.combo_valid_until < hoy) return false;
  return true;
}

/** ¿Hoy es el último día de vigencia del combo? (para la alerta) */
export function comboUltimoDia(
  p: Pick<Product, "is_combo" | "combo_valid_until">,
  hoy: string = hoyMontevideo(),
): boolean {
  return p.is_combo && p.combo_valid_until === hoy;
}

/** Un producto dentro de un combo, con cuánto de él lleva. */
export type ComboComponent = {
  product_id: string;
  quantity: number;
};

/**
 * Lo que ve el público. Sale de la vista `menu`, no de `products`: la clave
 * anónima viaja al navegador de cualquiera que escanee un QR, y el costo de la
 * mercadería no tiene por qué estar de su lado.
 */
export type MenuItem = {
  id: string;
  name: string;
  price: number;
  description: string | null;
  category: ProductCategory;
  image_url: string | null;
  is_combo: boolean;
};

export type Sector = {
  id: string;
  name: string;
  sort_order: number;
  created_at: string;
};

export type BarTable = {
  id: string;
  number: number;
  status: TableStatus;
  /** Etiqueta opcional además del número, p. ej. "Terraza" o "Barra 1". */
  name: string | null;
  /**
   * Mesa de barra: la atiende el usuario "barra" desde su pantalla de ventas.
   * Queda fuera del tablero del salón, igual que las mesas de pool.
   */
  is_bar: boolean;
  /** id del perfil del mozo a cargo, o null si la mesa está libre. */
  assigned_waiter: string | null;
  /** Lugar en el plano del salón. */
  sector_id: string | null;
  pos_x: number;
  pos_y: number;
  shape: TableShape;
  width: number;
  height: number;
  rotation: number;
  seats: number;
  created_at: string;
};

export type CashShift = {
  id: string;
  opened_at: string;
  opened_by: string | null;
  opening_float: number;
  closed_at: string | null;
  closed_by: string | null;
  /** Efectivo contado al cerrar. */
  counted_cash: number | null;
  /** Fondo + ventas en efectivo, congelado al cerrar. */
  expected_cash: number | null;
  /** counted_cash − expected_cash: positivo sobra, negativo falta. */
  difference: number | null;
  notes: string | null;
  created_at: string;
};

export type Order = {
  id: string;
  table_id: string;
  status: OrderStatus;
  total: number;
  payment_method: PaymentMethod | null;
  shift_id: string | null;
  opened_at: string;
  closed_at: string | null;
  opened_by: string | null;
  closed_by: string | null;
  /** Motivo de la cancelación, si status es 'cancelada'. */
  cancel_reason: string | null;
  created_at: string;
};

export type OrderItem = {
  id: string;
  order_id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
  unit_cost: number;
  subtotal: number;
  /** Copia congelada de products.station al momento de la venta. */
  station: Station;
  status: ItemStatus;
  started_at: string | null;
  ready_at: string | null;
  delivered_at: string | null;
  started_by: string | null;
  ready_by: string | null;
  delivered_by: string | null;
  created_by: string | null;
  created_at: string;
};

export type Alert = {
  id: string;
  table_id: string;
  type: AlertType;
  status: AlertStatus;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
};

/** Fila de la cuenta con el nombre del producto ya resuelto. */
export type OrderItemWithProduct = OrderItem & {
  product: Pick<Product, "id" | "name" | "category"> | null;
};

/** Estado completo de una mesa que consume el panel del POS. */
export type TableDetail = {
  table: BarTable;
  order: Order | null;
  items: OrderItemWithProduct[];
};

export const ALERT_LABELS: Record<AlertType, string> = {
  llamar_mozo: "Llama al mozo",
  pedir_cuenta: "Pide la cuenta",
};

/** Las estaciones que efectivamente tienen pantalla. */
export const PREP_STATIONS: readonly Station[] = ["barra", "cocina"] as const;

export const STATION_LABELS: Record<Station, string> = {
  barra: "Barra",
  cocina: "Cocina",
  ninguna: "Sin comanda",
};

export const PAYMENT_METHODS: readonly PaymentMethod[] = [
  "efectivo",
  "debito",
  "credito",
  "transferencia",
  "otro",
] as const;

export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  efectivo: "Efectivo",
  debito: "Débito",
  credito: "Crédito",
  transferencia: "Transferencia",
  otro: "Otro",
};

export function isPaymentMethod(value: string): value is PaymentMethod {
  return (PAYMENT_METHODS as readonly string[]).includes(value);
}

export const ITEM_STATUS_LABELS: Record<ItemStatus, string> = {
  pedido: "Pedido",
  preparando: "En preparación",
  listo: "Pronto para llevar",
  entregado: "Entregado",
};

/**
 * Umbrales de espera de una comanda, en minutos. Pasado el primero la línea se
 * marca en ámbar; pasado el segundo, en rojo y parpadeando.
 */
export const ITEM_WARN_MINUTES = 8;
export const ITEM_LATE_MINUTES = 15;

/**
 * Cuánto sigue viéndose en la estación algo ya marcado como listo. Es la
 * ventana para deshacer un toque de más sin tener que llamar a la caja.
 */
export const READY_WINDOW_MINUTES = 20;

export function isPrepStation(value: string): value is "barra" | "cocina" {
  return value === "barra" || value === "cocina";
}

/**
 * Estado en vivo de una mesa de pool, tal como lo devuelve `pool_status()`.
 *
 * Trae `ends_at` y no los segundos que faltan: el reloj lo corre cada pantalla
 * por su cuenta. Un contador que viaja ya calculado nace viejo.
 */
export type PoolStatus = {
  table_id: string;
  table_number: number;
  /** Etiqueta opcional de la mesa ("Terraza", "Pool 1"). */
  table_name: string | null;
  device_id: string;
  session_id: string | null;
  started_at: string | null;
  ends_at: string | null;
  /** Quiénes están jugando. Van en la partida, no en la mesa. */
  player_one: string | null;
  player_two: string | null;
  order_id: string | null;
  order_total: number | null;
  purchased_minutes: number;
  warning_minutes: number;
  max_block_minutes: number;
  last_seen_at: string | null;
  relay_on: boolean | null;
  hours_played: number;
  felt_threshold_hours: number;
};

/** Bloques que se venden de un toque. Lo demás se escribe a mano. */
export const POOL_BLOQUES = [30, 60, 120] as const;

/**
 * Si el aparato no dio señales en este rato, se lo da por caído. Pregunta cada
 * 15 segundos como mucho, así que un minuto es holgado: no marca caído a uno
 * que apenas se demoró.
 */
export const POOL_LECTOR_TIMEOUT_MS = 60_000;

export function poolMinutosATexto(minutos: number): string {
  if (minutos % 60 === 0) return `${minutos / 60} h`;
  if (minutos < 60) return `${minutos} min`;
  return `${Math.floor(minutos / 60)} h ${minutos % 60} min`;
}

/**
 * Cómo se nombra una mesa en pantalla: el nombre si tiene uno, y si no el
 * número. El número sigue siendo el identificador; el nombre es la etiqueta.
 */
export function nombreMesa(
  numero: number,
  nombre: string | null | undefined,
): string {
  const limpio = nombre?.trim();
  return limpio && limpio.length > 0 ? limpio : `Mesa ${numero}`;
}

/** Estados de una reserva de mesa de pool. */
export type PoolReservationStatus =
  | "reservada"
  | "activada"
  | "liberada"
  | "no_show"
  | "vencida";

/**
 * Un turno para una mesa de pool, tal como lo devuelve `pool_day_reservations()`.
 *
 * La reserva no enciende la mesa: cuando el cliente llega, administración la
 * activa a mano y recién ahí arranca una partida.
 */
export type PoolReservation = {
  id: string;
  table_id: string;
  table_number: number;
  table_name: string | null;
  customer_name: string;
  phone: string;
  /** El turno: la "hora de reserva" que se muestra en la grilla del salón. */
  scheduled_at: string;
  play_minutes: number;
  status: PoolReservationStatus;
  session_id: string | null;
  created_at: string;
  activated_at: string | null;
  released_at: string | null;
  created_by_name: string | null;
  activated_by_name: string | null;
  released_by_name: string | null;
};

/** Opciones de "horas de juego" al reservar. Mismos bloques que una venta. */
export const POOL_RESERVA_BLOQUES = [30, 60, 90, 120] as const;

/**
 * Normaliza un celular uruguayo a nueve dígitos (`09XXXXXXX`), o devuelve null
 * si no lo parece. Acepta espacios, guiones y el prefijo internacional +598.
 */
export function normalizarCelularUy(crudo: string): string | null {
  let d = (crudo ?? "").replace(/\D/g, "");
  if (d.startsWith("598")) d = d.slice(3);
  if (d.length === 8 && d.startsWith("9")) d = `0${d}`;
  return /^09\d{7}$/.test(d) ? d : null;
}

/** `09XXXXXXX` → `09X XXX XXX` para mostrar. */
export function formatCelularUy(normalizado: string): string {
  return /^09\d{7}$/.test(normalizado)
    ? `${normalizado.slice(0, 3)} ${normalizado.slice(3, 6)} ${normalizado.slice(6)}`
    : normalizado;
}

/**
 * Un turno que ya pasó su hora y sigue sin activarse es un cliente demorado.
 * A los primeros minutos se marca en ámbar; pasado el segundo, en rojo.
 */
export const POOL_RESERVA_DEMORA_MINUTES = 10;
export const POOL_RESERVA_TARDE_MINUTES = 20;

export const TABLE_SHAPES: readonly TableShape[] = [
  "redonda",
  "cuadrada",
  "rectangular",
] as const;

export const SHAPE_LABELS: Record<TableShape, string> = {
  redonda: "Redonda",
  cuadrada: "Cuadrada",
  rectangular: "Rectangular",
};

/**
 * Jerarquía del personal. Se manda sobre quien tiene rango estrictamente menor:
 * un gerente sobre admins y mozos, un admin sobre mozos, un mozo sobre nadie.
 *
 * Los mismos números están en la base (`role_rank`). Acá viven para decidir qué
 * mostrar; quien decide qué se puede hacer es Postgres.
 */
export const ROLE_RANK: Record<StaffRole, number> = {
  mozo: 1,
  // Barra y cocina no son un escalón más: son otro trabajo. Pesan lo mismo que
  // un mozo y lo único que cambia es a qué pantalla entran.
  barra: 1,
  cocina: 1,
  admin: 2,
  gerente: 3,
};

export const ROLE_LABELS: Record<StaffRole, string> = {
  mozo: "Mozo",
  barra: "Barra",
  cocina: "Cocina",
  admin: "Admin",
  gerente: "Gerente",
};

export const STAFF_ROLES: readonly StaffRole[] = [
  "mozo",
  "barra",
  "cocina",
  "admin",
  "gerente",
] as const;

/** Su pantalla de comandas, o null si su lugar es el salón. */
export function stationOf(role: StaffRole): "barra" | "cocina" | null {
  return role === "barra" || role === "cocina" ? role : null;
}

/** Quiénes pueden tener una mesa a su nombre. */
export function atiendeMesas(role: StaffRole): boolean {
  return role === "mozo" || role === "admin" || role === "gerente";
}

/** Quiénes usan la pantalla de ventas de barra (bebidas, cobro, ticket). */
export function atiendeBarra(role: StaffRole): boolean {
  return role === "barra" || role === "admin" || role === "gerente";
}

/** A dónde entra cada uno al iniciar sesión. */
export function homeFor(role: StaffRole): string {
  // La barra vende desde su propia pantalla; la cocina entra a sus comandas.
  if (role === "barra") return "/barra";
  const station = stationOf(role);
  if (station) return `/estacion/${station}`;
  return role === "mozo" ? "/admin/mis-mesas" : "/admin";
}

/** ¿`role` llega al nivel `min`? */
export function hasRank(role: StaffRole, min: StaffRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

/** Roles que alguien puede asignar: solo por debajo del suyo. */
export function assignableRoles(role: StaffRole): StaffRole[] {
  return STAFF_ROLES.filter((r) => ROLE_RANK[r] < ROLE_RANK[role]);
}

// ---------------------------------------------------------------------------
//  Login por documento (C.I.)
//
//  Supabase Auth necesita un email. El personal entra con su documento y por
//  detrás se arma un email sintético `<documento>@<dominio>`. Las cuentas
//  viejas siguen entrando con su correo real mientras se migran.
// ---------------------------------------------------------------------------

/** Dominio del email sintético. Se puede fijar con AUTH_EMAIL_DOMAIN. */
export const DOMINIO_LOGIN =
  process.env.AUTH_EMAIL_DOMAIN?.trim() || "redox.local";

/** ¿El texto tipeado es un documento (6 a 8 dígitos) y no un correo? */
export function esDocumento(raw: string): boolean {
  return /^\d{6,8}$/.test(raw.trim());
}

/** Documento → email interno con el que se autentica contra Supabase. */
export function loginEmailFromDocumento(doc: string): string {
  return `${doc.trim()}@${DOMINIO_LOGIN}`;
}

/**
 * Datos de un comprobante de venta, en el orden en que se imprimen. Hoy se
 * usan para el ticket de navegador; mañana, para el encoder ESC/POS.
 */
export type TicketData = {
  /** Bloque 1 — emisor. */
  emisor: { nombre: string; linea2?: string };
  /** Bloque 2 — comprobante. */
  comprobante: { numero: string; fecha: string; mesa: string; cajero: string };
  /** Bloque 3 — detalle. */
  lineas: { cantidad: number; descripcion: string; unitario: number; total: number }[];
  /** Bloque 4 — totales. */
  total: number;
  /** Bloque 5 — pago. */
  medioPago: PaymentMethod;
};

export const CATEGORY_LABELS: Record<ProductCategory, string> = {
  bebida: "Bebidas",
  comida: "Comida",
  otro: "Otros",
};

export function formatMoney(value: number): string {
  return new Intl.NumberFormat("es-UY", {
    style: "currency",
    currency: "UYU",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value ?? 0);
}
