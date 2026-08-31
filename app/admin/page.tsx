import { requireStaff } from "@/lib/auth";
import { SalonBoard } from "./_components/salon-board";
import { loadSalon } from "./_components/salon-data";
import { comboUltimoDia, hasRank, hoyMontevideo } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Motivos por los que alguien puede terminar acá rebotado desde otra pantalla.
 * Sin esto el rebote es mudo: la URL dice el motivo y nadie lo lee.
 */
const ERRORS: Record<string, string> = {
  "solo-admin": "Esa pantalla es de administradores.",
  "solo-gerente":
    "La administración de usuarios es del gerente. Pedísela a quien tenga ese nivel.",
};

export default async function SalonPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const profile = await requireStaff();

  const { error } = await searchParams;
  const data = await loadSalon();

  // Aviso de combos en su último día de vigencia: es del encargado, que es
  // quien decide si la promoción se extiende o se deja caer.
  const hoy = hoyMontevideo();
  const combosUltimoDia = hasRank(profile.role, "admin")
    ? data.products.filter((p) => comboUltimoDia(p, hoy)).map((p) => p.name)
    : [];

  let notice: string | null = error ? (ERRORS[error] ?? null) : null;
  if (!notice && combosUltimoDia.length > 0) {
    notice = `Último día de: ${combosUltimoDia.join(", ")}. Ajustá la vigencia en Catálogo si la promoción sigue.`;
  }

  return (
    <SalonBoard
      {...data}
      currentUserId={profile.id}
      role={profile.role}
      scope="salon"
      notice={notice}
    />
  );
}
