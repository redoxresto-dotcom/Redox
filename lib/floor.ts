import type { TableShape } from "@/lib/types";

/**
 * Geometría del plano del salón.
 *
 * El plano vive en un lienzo de medidas fijas y todo se guarda en esas
 * unidades. Cada pantalla lo escala para entrar en su ancho: así el mismo
 * plano se ve igual en el monitor de la caja y en la tablet del mozo, y mover
 * una mesa no depende del tamaño de la pantalla desde la que se movió.
 */
export const CANVAS_W = 1400;
export const CANVAS_H = 900;

/** Las posiciones se pegan a esta grilla: dos mesas al lado quedan derechas. */
export const GRID = 10;

/** Distancia de la silla al borde de la mesa. */
const CHAIR_GAP = 14;
export const CHAIR_W = 22;
export const CHAIR_H = 16;

/**
 * Escala a la que dibujar el plano dentro de un contenedor de `width` píxeles.
 *
 * Encoger hasta que entre siempre suena bien hasta que alguien lo abre en un
 * celular: a 360 px de ancho el plano entero entraría al 26%, con mesas de
 * treinta píxeles que no se leen ni se tocan. Por debajo del mínimo se deja de
 * achicar y el plano se desplaza de costado, que es preferible a una maqueta
 * ilegible.
 */
export const MIN_SCALE = 0.5;

export function fitScale(width: number): number {
  if (width <= 0) return 1;
  return Math.min(1, Math.max(width / CANVAS_W, MIN_SCALE));
}

export function snap(value: number): number {
  return Math.round(value / GRID) * GRID;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export type Chair = {
  /** Desplazamiento respecto del centro de la mesa, sin rotar. */
  x: number;
  y: number;
  /** Giro de la silla para que mire a la mesa. */
  angle: number;
};

/**
 * Dónde van las sillas de una mesa.
 *
 * Redondas: repartidas por el contorno. Cuadradas y rectangulares: caminando
 * el perímetro a paso parejo, que reparte solo las sillas entre los lados
 * largos y los cortos sin tener que decidir cuántas van en cada uno.
 */
export function chairPositions(
  shape: TableShape,
  width: number,
  height: number,
  seats: number
): Chair[] {
  if (seats <= 0) return [];

  if (shape === "redonda") {
    const radio = Math.max(width, height) / 2 + CHAIR_GAP + CHAIR_H / 2;
    return Array.from({ length: seats }, (_, i) => {
      // Arranca arriba y va en sentido horario.
      const rad = (i / seats) * Math.PI * 2 - Math.PI / 2;
      return {
        x: Math.cos(rad) * radio,
        y: Math.sin(rad) * radio,
        angle: (rad * 180) / Math.PI + 90,
      };
    });
  }

  const w = width + CHAIR_GAP * 2 + CHAIR_H;
  const h = height + CHAIR_GAP * 2 + CHAIR_H;
  const perimetro = 2 * (w + h);
  // Medio paso de arranque: las sillas quedan centradas en cada lado en vez de
  // pisar las esquinas.
  const paso = perimetro / seats;

  return Array.from({ length: seats }, (_, i) => {
    let d = paso * i + paso / 2;
    const mitadW = w / 2;
    const mitadH = h / 2;

    // Arriba, derecha, abajo, izquierda.
    if (d < w) return { x: -mitadW + d, y: -mitadH, angle: 0 };
    d -= w;
    if (d < h) return { x: mitadW, y: -mitadH + d, angle: 90 };
    d -= h;
    if (d < w) return { x: mitadW - d, y: mitadH, angle: 180 };
    d -= w;
    return { x: -mitadW, y: mitadH - d, angle: 270 };
  });
}

/** Radio del borde según la forma, para dibujar la mesa. */
export function tableRadius(shape: TableShape): string {
  if (shape === "redonda") return "50%";
  return "0.75rem";
}
