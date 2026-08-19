import Image from "next/image";

/**
 * La marca de Redox.
 *
 * Redox es el bar; NexoRestUy es el sistema. Por eso el nombre del local manda
 * en las pantallas —encabezado, ingreso, la mesa del cliente— y el producto
 * solo firma abajo del ingreso.
 *
 * Los archivos de marca vienen con el fondo negro quemado en el JPEG, así que
 * se componen con `mix-blend-screen`: sobre un fondo oscuro, el negro del
 * archivo desaparece y queda solo el dibujo. Con un PNG de fondo transparente
 * se puede sacar ese truco.
 */

/** El logo original. Va donde hay lugar para que se lea: ingreso y portada. */
export function RedoxLogo({ width = 260 }: { width?: number }) {
  return (
    <Image
      src="/redox-logo.jpg"
      alt="Redox"
      width={width}
      height={Math.round((width * 1024) / 1536)}
      priority
      className="mix-blend-screen"
    />
  );
}

/**
 * La mascota. Es la cara del bar para el cliente que escanea el QR.
 *
 * El alto se maneja por CSS y no por props: en un celular chico la pantalla
 * tiene que entrar entera —los dos botones de llamado no pueden quedar abajo
 * del pliegue— y en uno grande sobra lugar para que se luzca.
 */
export function RedoxMascota({ className = "" }: { className?: string }) {
  return (
    <Image
      src="/redox-mascota.jpg"
      alt="La mascota de Redox: un mojito con guardapolvo y tubo de ensayo"
      width={112}
      height={168}
      priority
      className={`mix-blend-screen ${className}`}
    />
  );
}

/**
 * Matraz dibujado en SVG, para los lugares donde el logo no entra.
 *
 * En la barra del panel el logo completo se vería de cincuenta píxeles y no se
 * leería el nombre. Acá se compone el matraz con el nombre en tipografía, que
 * a ese tamaño sí se lee.
 */
export function RedoxFlask({ size = 34 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden
      className="shrink-0"
    >
      <path
        d="M19 6h10v11.5l8.8 19.2A4 4 0 0 1 34.2 42H13.8a4 4 0 0 1-3.6-5.3L19 17.5V6Z"
        stroke="var(--color-brand)"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M17.5 6h13"
        stroke="var(--color-brand)"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <path
        d="M14.6 30h18.8l4.4 9.5A3 3 0 0 1 35 42H13a3 3 0 0 1-2.8-2.5L14.6 30Z"
        fill="var(--color-brand)"
        fillOpacity="0.55"
      />
      <circle cx="20" cy="34.5" r="1.6" fill="var(--color-brand-soft)" />
      <circle cx="26.5" cy="37" r="2.1" fill="var(--color-brand-soft)" />
      <circle cx="23" cy="39.5" r="1.2" fill="var(--color-brand-soft)" />

      <g stroke="var(--color-brand)" strokeWidth="1.3">
        <path d="M30.5 8.5 37 5M37 5l6 2M37 5l1.5-4" />
      </g>
      <circle cx="37" cy="5" r="2.4" fill="var(--color-brand)" />
      <circle cx="43" cy="7" r="1.7" fill="var(--color-brand)" />
      <circle cx="38.5" cy="1" r="1.4" fill="var(--color-brand)" />
      <circle cx="30.5" cy="8.5" r="1.4" fill="var(--color-brand)" />
    </svg>
  );
}

const TAMANOS = {
  sm: { flask: 22, texto: "text-lg" },
  md: { flask: 30, texto: "text-2xl" },
} as const;

/** Versión compacta: matraz y nombre. Para la barra del panel. */
export function RedoxMark({
  size = "sm",
  tagline,
}: {
  size?: keyof typeof TAMANOS;
  tagline?: string;
}) {
  const { flask, texto } = TAMANOS[size];

  return (
    <span className="flex items-center gap-2">
      <RedoxFlask size={flask} />
      <span className="flex flex-col leading-none">
        <span
          className={`${texto} font-semibold tracking-tight text-[var(--color-brand-soft)] italic`}
          style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}
        >
          Redox
        </span>
        {tagline ? (
          <span className="mt-1 text-[10px] tracking-[0.22em] text-[var(--color-muted)] uppercase">
            {tagline}
          </span>
        ) : null}
      </span>
    </span>
  );
}

/** Firma del sistema. Va abajo del ingreso, no en las pantallas de servicio. */
export function PoweredBy() {
  return (
    <p className="text-center text-xs tracking-wide text-[var(--color-muted)]">
      Powered by{" "}
      <span className="font-medium text-[var(--color-brand-soft)]">
        NexoRestUy
      </span>
    </p>
  );
}
