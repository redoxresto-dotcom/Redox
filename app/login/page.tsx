import { LoginForm } from "./login-form";

const ERRORS: Record<string, string> = {
  "sin-acceso":
    "Tu usuario no tiene acceso al salón. Pedile a un administrador que lo habilite.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string; error?: string }>;
}) {
  const params = await searchParams;
  const redirectTo = params.redirect?.startsWith("/") ? params.redirect : "/admin";
  const notice = params.error ? ERRORS[params.error] : null;

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-8 px-6 py-12">
      <div>
        <p className="text-xs font-medium tracking-widest text-[var(--color-accent)] uppercase">
          Punta Carretas
        </p>
        <h1 className="mt-1.5 text-2xl font-semibold">Ingreso de mozos</h1>
      </div>

      {notice ? (
        <p className="rounded-lg border border-[var(--color-busy)]/40 bg-[var(--color-busy)]/10 px-3 py-2 text-sm text-[var(--color-busy)]">
          {notice}
        </p>
      ) : null}

      <LoginForm redirectTo={redirectTo} />
    </main>
  );
}
