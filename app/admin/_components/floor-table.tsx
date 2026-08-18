"use client";

import type { PointerEvent as ReactPointerEvent } from "react";
import { chairPositions, tableRadius, CHAIR_H, CHAIR_W } from "@/lib/floor";
import type { TableShape } from "@/lib/types";

export type FloorGeometry = {
  pos_x: number;
  pos_y: number;
  shape: TableShape;
  width: number;
  height: number;
  rotation: number;
  seats: number;
};

type Props = {
  table: FloorGeometry;
  /** Clases del cuerpo de la mesa: borde, fondo y color de texto. */
  className?: string;
  /** Anillo de selección del editor. */
  selected?: boolean;
  label?: string;
  title?: string;
  children?: React.ReactNode;
  onPointerDown?: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove?: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp?: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onClick?: () => void;
};

/**
 * Una mesa dibujada en el plano, con sus sillas alrededor.
 *
 * La usan el editor y el tablero del salón: si el plano se dibujara distinto en
 * cada pantalla, mover una mesa en el editor dejaría de significar lo mismo que
 * verla desde la caja.
 *
 * El contenedor no tiene tamaño —es el punto donde está la mesa— y todo lo de
 * adentro se centra sobre él. Así la rotación gira alrededor del centro de la
 * mesa y las sillas la acompañan sin recalcular nada.
 */
export function FloorTable({
  table,
  className = "",
  selected,
  label,
  title,
  children,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onClick,
}: Props) {
  const chairs = chairPositions(
    table.shape,
    table.width,
    table.height,
    table.seats
  );

  return (
    <div
      className="absolute"
      style={{
        left: table.pos_x,
        top: table.pos_y,
        width: 0,
        height: 0,
        transform: `rotate(${table.rotation}deg)`,
      }}
    >
      {chairs.map((chair, i) => (
        <span
          key={i}
          aria-hidden
          className={`absolute rounded-md ${
            selected ? "bg-[var(--color-accent)]/50" : "bg-[var(--color-border)]"
          }`}
          style={{
            width: CHAIR_W,
            height: CHAIR_H,
            left: chair.x,
            top: chair.y,
            transform: `translate(-50%, -50%) rotate(${chair.angle}deg)`,
          }}
        />
      ))}

      <div
        role={onClick ? "button" : undefined}
        tabIndex={onClick ? 0 : undefined}
        aria-label={label}
        title={title}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onClick={onClick}
        onKeyDown={
          onClick
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onClick();
                }
              }
            : undefined
        }
        className={`absolute flex touch-none flex-col items-center justify-center border-2 select-none ${
          selected
            ? "ring-2 ring-[var(--color-accent)] ring-offset-2 ring-offset-[var(--color-bg)]"
            : ""
        } ${className}`}
        style={{
          left: 0,
          top: 0,
          width: table.width,
          height: table.height,
          borderRadius: tableRadius(table.shape),
          transform: "translate(-50%, -50%)",
        }}
      >
        {/* El contenido se contra-rota: una mesa puesta a 90° no tiene por qué
            dejar el número acostado. */}
        <div
          className="flex flex-col items-center justify-center"
          style={{ transform: `rotate(${-table.rotation}deg)` }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
