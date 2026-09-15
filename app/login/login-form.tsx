"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { signIn, type LoginState } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-xl bg-[var(--color-accent)]/90 px-4 py-3.5 font-semibold text-[#04121c] shadow-lg shadow-[var(--color-accent)]/20 backdrop-blur-md transition-colors hover:bg-[var(--color-accent)] disabled:opacity-50"
    >
      {pending ? "Entrando…" : "Entrar"}
    </button>
  );
}

export function LoginForm({ redirectTo }: { redirectTo: string | null }) {
  const [state, formAction] = useActionState<LoginState, FormData>(signIn, {
    error: null,
  });

  return (
    <form action={formAction} className="grid gap-4">
      {/* Sin destino explícito, la acción manda a cada uno a su pantalla. */}
      {redirectTo ? (
        <input type="hidden" name="redirect" value={redirectTo} />
      ) : null}

      <label className="grid gap-1.5">
        <span className="text-sm text-[var(--color-muted)]">Documento</span>
        <input
          name="email"
          type="text"
          inputMode="numeric"
          autoComplete="username"
          required
          autoFocus
          placeholder="Número de documento"
          className="rounded-xl bg-white/5 px-4 py-3 shadow-inner shadow-black/20 backdrop-blur-md outline-none focus:bg-white/10"
        />
        <span className="text-xs text-[var(--color-muted)]">
          Si todavía usás correo, también funciona.
        </span>
      </label>

      <label className="grid gap-1.5">
        <span className="text-sm text-[var(--color-muted)]">Contraseña</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="rounded-xl bg-white/5 px-4 py-3 shadow-inner shadow-black/20 backdrop-blur-md outline-none focus:bg-white/10"
        />
      </label>

      {state.error ? (
        <p
          role="alert"
          className="rounded-lg border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-3 py-2 text-sm text-[var(--color-danger)]"
        >
          {state.error}
        </p>
      ) : null}

      <SubmitButton />
    </form>
  );
}
