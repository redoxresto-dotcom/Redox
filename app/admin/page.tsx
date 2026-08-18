import { requireStaff } from "@/lib/auth";
import { SalonBoard } from "./_components/salon-board";
import { loadSalon } from "./_components/salon-data";

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

  return (
    <SalonBoard
      {...data}
      currentUserId={profile.id}
      role={profile.role}
      scope="salon"
      notice={error ? (ERRORS[error] ?? null) : null}
    />
  );
}
