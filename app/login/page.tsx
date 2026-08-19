import { LoginForm } from "./login-form";
import { PoweredBy, RedoxLogo } from "../_components/brand";

const ERRORS: Record<string, string> = {
  "sin-acceso":
    "Tu usuario está dado de baja y no tiene acceso al salón. Contactate con el encargado o con el soporte técnico.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string; error?: string }>;
}) {
  const params = await searchParams;
  const redirectTo = params.redirect?.startsWith("/") ? params.redirect : null;
  const notice = params.error ? ERRORS[params.error] : null;

  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-sm flex-col justify-center gap-8 px-6 py-12">
      <div className="flex flex-col items-center gap-2">
        <RedoxLogo width={260} />
        <p className="text-[11px] tracking-[0.24em] text-[var(--color-muted)] uppercase">
          Punta Carretas
        </p>
      </div>

      {notice ? (
        <p className="rounded-lg border border-[var(--color-busy)]/40 bg-[var(--color-busy)]/10 px-3 py-2 text-sm text-[var(--color-busy)]">
          {notice}
        </p>
      ) : null}

      <LoginForm redirectTo={redirectTo} />

      <PoweredBy />
    </main>
  );
}
