/**
 * Parser de CSV mínimo pero correcto para las importaciones del panel.
 *
 * - Autodetecta el separador (`;`, `,` o tab) a partir de la primera línea.
 * - Respeta comillas dobles: separadores y saltos de línea dentro de `"…"`,
 *   y `""` como comilla escapada.
 * - Saca el BOM del arranque y los `\r` de fin de línea.
 *
 * Es lo que exporta Excel en español ("Guardar como CSV UTF-8"), que usa `;`
 * y es el mismo dialecto que ya genera el export de reportes.
 */
export type CsvTable = {
  /** Encabezados normalizados: minúsculas, sin acentos, sin espacios de borde. */
  headers: string[];
  /** Encabezados tal cual venían, para los mensajes de error. */
  rawHeaders: string[];
  /** Filas de datos (sin el encabezado). Cada celda es string ya sin comillas. */
  rows: string[][];
};

/** minúsculas + sin acentos + trim: para comparar nombres de columna. */
export function normalizarClave(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}

function detectarSeparador(primeraLinea: string): string {
  const candidatos = [";", "\t", ","];
  let mejor = ",";
  let max = -1;
  for (const c of candidatos) {
    // Cuenta ocurrencias fuera de comillas.
    let n = 0;
    let dentro = false;
    for (let i = 0; i < primeraLinea.length; i++) {
      const ch = primeraLinea[i];
      if (ch === '"') dentro = !dentro;
      else if (ch === c && !dentro) n++;
    }
    if (n > max) {
      max = n;
      mejor = c;
    }
  }
  return mejor;
}

export function parseCsv(texto: string): CsvTable {
  const limpio = texto.replace(/^﻿/, "");
  const primeraLinea = limpio.split(/\r?\n/, 1)[0] ?? "";
  const sep = detectarSeparador(primeraLinea);

  const filas: string[][] = [];
  let campo = "";
  let fila: string[] = [];
  let dentroComillas = false;

  for (let i = 0; i < limpio.length; i++) {
    const ch = limpio[i];

    if (dentroComillas) {
      if (ch === '"') {
        if (limpio[i + 1] === '"') {
          campo += '"';
          i++;
        } else {
          dentroComillas = false;
        }
      } else {
        campo += ch;
      }
      continue;
    }

    if (ch === '"') {
      dentroComillas = true;
    } else if (ch === sep) {
      fila.push(campo);
      campo = "";
    } else if (ch === "\n") {
      fila.push(campo);
      filas.push(fila);
      fila = [];
      campo = "";
    } else if (ch === "\r") {
      // fin de línea de Windows: se ignora, el \n lo cierra
    } else {
      campo += ch;
    }
  }
  // Última fila sin salto de línea final.
  if (campo !== "" || fila.length > 0) {
    fila.push(campo);
    filas.push(fila);
  }

  // Descarta filas totalmente vacías (líneas en blanco al final del archivo).
  const noVacias = filas.filter((f) => f.some((c) => c.trim() !== ""));
  if (noVacias.length === 0) {
    return { headers: [], rawHeaders: [], rows: [] };
  }

  const rawHeaders = noVacias[0].map((h) => h.trim());
  const headers = rawHeaders.map(normalizarClave);
  return { headers, rawHeaders, rows: noVacias.slice(1) };
}

/**
 * Acceso a una celda por nombre de columna normalizado. Devuelve "" si la
 * columna no existe o la fila es más corta.
 */
export function celda(
  table: CsvTable,
  fila: string[],
  columna: string,
): string {
  const idx = table.headers.indexOf(normalizarClave(columna));
  if (idx === -1) return "";
  return (fila[idx] ?? "").trim();
}

/** "1.234,50" | "1234.50" | "1 234,5" → 1234.5 ; "" → null ; basura → NaN */
export function parseNumeroLatam(raw: string): number | null {
  const s = raw.trim();
  if (s === "") return null;
  // Quita separadores de miles y espacios; deja el último separador como decimal.
  let limpio = s.replace(/\s/g, "");
  const tieneComa = limpio.includes(",");
  const tienePunto = limpio.includes(".");
  if (tieneComa && tienePunto) {
    // El que aparece último es el decimal.
    if (limpio.lastIndexOf(",") > limpio.lastIndexOf(".")) {
      limpio = limpio.replace(/\./g, "").replace(",", ".");
    } else {
      limpio = limpio.replace(/,/g, "");
    }
  } else if (tieneComa) {
    limpio = limpio.replace(",", ".");
  }
  const n = Number(limpio);
  return Number.isFinite(n) ? n : NaN;
}
