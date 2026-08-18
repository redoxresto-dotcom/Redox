import { requireStaff } from "@/lib/auth";
import { SalonBoard } from "../_components/salon-board";
import { loadSalon } from "../_components/salon-data";

export const dynamic = "force-dynamic";

/**
 * Las mesas que tomó quien está mirando.
 *
 * Es la pantalla donde vive el mozo durante el turno: desde que toma una mesa,
 * esa mesa desaparece del salón de los demás y le queda acá.
 */
export default async function MisMesasPage() {
  const profile = await requireStaff();

  const data = await loadSalon();

  return (
    <SalonBoard
      {...data}
      currentUserId={profile.id}
      role={profile.role}
      scope="mias"
    />
  );
}
