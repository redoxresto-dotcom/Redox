export type ProductCategory = "bebida" | "comida" | "otro";
export type StaffRole = "mozo" | "admin";
export type TableStatus = "libre" | "ocupada";
export type OrderStatus = "abierta" | "cobrada";
export type AlertType = "llamar_mozo" | "pedir_cuenta";
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
  active: boolean;
  created_at: string;
};

export type BarTable = {
  id: string;
  number: number;
  status: TableStatus;
  /** id del perfil del mozo a cargo, o null si la mesa está libre. */
  assigned_waiter: string | null;
  created_at: string;
};

export type Order = {
  id: string;
  table_id: string;
  status: OrderStatus;
  total: number;
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
