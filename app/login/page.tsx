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
    <main className="relative mx-auto flex min-h-[100dvh] max-w-sm flex-col justify-center gap-8 px-6 py-12">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
      >
        <div className="absolute -top-32 -left-32 size-[28rem] rounded-full bg-[var(--color-brand)]/20 blur-[110px]" />
        <div className="absolute right-0 bottom-0 size-[26rem] rounded-full bg-[var(--color-accent)]/15 blur-[110px]" />
      </div>

      <div className="flex flex-col items-center gap-2">
        <RedoxLogo width={320} />
      </div>

      {notice ? (
        <p className="rounded-lg bg-[var(--color-busy)]/15 px-3 py-2 text-sm text-[var(--color-busy)] backdrop-blur-md">
          {notice}
        </p>
      ) : null}

      <LoginForm redirectTo={redirectTo} />

      <PoweredBy />
    </main>
  );
}
