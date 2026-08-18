export type ProductCategory = "bebida" | "comida" | "otro";
export type StaffRole = "mozo" | "admin";
export type TableStatus = "libre" | "ocupada";
export type TableShape = "redonda" | "cuadrada" | "rectangular";
export type OrderStatus = "abierta" | "cobrada";
export type AlertType = "llamar_mozo" | "pedir_cuenta";
/** Quién prepara el producto. 'ninguna' = se cobra sin pasar por nadie. */
export type Station = "barra" | "cocina" | "ninguna";
/** Avance de una línea de la cuenta dentro de su estación. */
export type ItemStatus = "pedido" | "preparando" | "listo";
export type PaymentMethod =
  | "efectivo"
  | "debito"
  | "credito"
  | "transferencia"
  | "otro";
export type AlertStatus = "pendiente" | "resuelta";

export type Profile = {
  id: string;
  full_name: string;
  role: StaffRole;
  active: boolean;
  created_at: string;
};

export type Product = {
  id: string;
  name: string;
  price: number;
  cost: number;
  category: ProductCategory;
  station: Station;
  active: boolean;
  created_at: string;
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
  started_by: string | null;
  ready_by: string | null;
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
  listo: "Listo",
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
