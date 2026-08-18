"use client";

import { useState, useTransition } from "react";
import {
  changeRole,
  createStaff,
  deleteStaff,
  resetPassword,
  setActive,
} from "./actions";
import {
  assignableRoles,
  ROLE_LABELS,
  ROLE_RANK,
  type Profile,
  type StaffRole,
} from "@/lib/types";

type Props = {
  profiles: Profile[];
  /** El gerente que está mirando la pantalla. */
  me: Profile;
  /** id de perfil → mail con el que entra. Vive en auth.users, no en profiles. */
  emails: Record<string, string>;
};

export function UserManager({ profiles, me, emails }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [creando, setCreando] = useState(false);
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const [reseteando, setReseteando] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const roles = assignableRoles(me.role);

  function run(fn: () => Promise<{ error: string | null }>, onDone?: () => void) {
    setError(null);
    setAviso(null);
    startTransition(async () => {
      const result = await fn();
      if (result.error) setError(result.error);
      else onDone?.();
    });
  }

  /** Sobre quién puede actuar: solo niveles por debajo del propio. */
  function puedeEditar(p: Profile): boolean {
    return ROLE_RANK[p.role] < ROLE_RANK[me.role];
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-6">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Usuarios</h1>
          <p className="text-sm text-[var(--color-muted)]">
            {profiles.filter((p) => p.active).length} activo
            {profiles.filter((p) => p.active).length === 1 ? "" : "s"} de{" "}
            {profiles.length}
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setCreando((c) => !c);
            setError(null);
          }}
          className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-[#04121c]"
        >
          {creando ? "Cancelar" : "+ Usuario"}
        </button>
      </header>

      {error ? (
        <p
          role="alert"
          className="mb-4 rounded-lg border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-3 py-2 text-sm text-[var(--color-danger)]"
        >
          {error}
        </p>
      ) : null}

      {aviso ? (
        <p
          role="status"
          className="mb-4 rounded-lg border border-[var(--color-free)]/40 bg-[var(--color-free)]/10 px-3 py-2 text-sm text-[var(--color-free)]"
        >
          {aviso}
        </p>
      ) : null}

      {creando ? (
        <form
          action={(fd) => run(() => createStaff(fd), () => setCreando(false))}
          className="mb-4 grid gap-3 rounded-xl border border-[var(--color-accent)]/40 bg-[var(--color-surface)] p-4 sm:grid-cols-2"
        >
          <label className="grid gap-1">
            <span className="text-xs text-[var(--color-muted)]">Nombre</span>
            <input
              name="full_name"
              required
              autoFocus
              className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
            />
          </label>

          <label className="grid gap-1">
            <span className="text-xs text-[var(--color-muted)]">Mail</span>
            <input
              name="email"
              type="email"
              required
              autoComplete="off"
              className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
            />
          </label>

          <label className="grid gap-1">
            <span className="text-xs text-[var(--color-muted)]">
              Contraseña inicial
            </span>
            <input
              name="password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
            />
          </label>

          <label className="grid gap-1">
            <span className="text-xs text-[var(--color-muted)]">Nivel</span>
            <select
              name="role"
              defaultValue={roles[0] ?? "mozo"}
              className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
            >
              {roles.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </label>

          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={isPending}
              className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-[#04121c] disabled:opacity-50"
            >
              {isPending ? "Creando…" : "Crear usuario"}
            </button>
            <p className="mt-2 text-xs text-[var(--color-muted)]">
              La contraseña se la das vos en el local. El usuario queda
              confirmado y puede entrar enseguida, sin mail de por medio.
            </p>
          </div>
        </form>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-[var(--color-border)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--color-surface)] text-left text-xs tracking-wide text-[var(--color-muted)] uppercase">
            <tr>
              <th className="px-4 py-2.5 font-medium">Nombre</th>
              <th className="px-4 py-2.5 font-medium">Mail</th>
              <th className="px-4 py-2.5 font-medium">Nivel</th>
              <th className="px-4 py-2.5 font-medium">Estado</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {profiles.map((p) => {
              const editable = puedeEditar(p);
              const soyYo = p.id === me.id;

              return (
                <tr
                  key={p.id}
                  className={`border-t border-[var(--color-border)] ${
                    p.active ? "" : "opacity-50"
                  }`}
                >
                  <td className="px-4 py-3">
                    {p.full_name}
                    {soyYo ? (
                      <span className="ml-2 text-xs text-[var(--color-muted)]">
                        (vos)
                      </span>
                    ) : null}
                  </td>

                  <td className="px-4 py-3 text-[var(--color-muted)]">
                    {emails[p.id] ?? "—"}
                  </td>

                  <td className="px-4 py-3">
                    {editable ? (
                      <select
                        value={p.role}
                        disabled={isPending}
                        onChange={(e) =>
                          run(() =>
                            changeRole(p.id, e.target.value as StaffRole)
                          )
                        }
                        className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1 text-sm outline-none focus:border-[var(--color-accent)]"
                      >
                        {roles.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABELS[r]}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span
                        className={`rounded px-2 py-0.5 text-xs tracking-wide uppercase ${
                          p.role === "gerente"
                            ? "bg-[var(--color-accent)]/20 text-[var(--color-accent)]"
                            : "bg-[var(--color-surface-2)] text-[var(--color-muted)]"
                        }`}
                      >
                        {ROLE_LABELS[p.role]}
                      </span>
                    )}
                  </td>

                  <td className="px-4 py-3">
                    {p.active ? (
                      <span className="text-[var(--color-free)]">Activo</span>
                    ) : (
                      <span className="text-[var(--color-muted)]">
                        Dado de baja
                      </span>
                    )}
                  </td>

                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      {editable && reseteando === p.id ? (
                        <form
                          action={(fd) =>
                            run(
                              () => resetPassword(p.id, fd),
                              () => {
                                setReseteando(null);
                                setAviso(
                                  `Contraseña nueva para ${p.full_name}. Pasásela en mano: no se puede volver a ver.`
                                );
                              }
                            )
                          }
                          className="flex items-center gap-1"
                        >
                          <input
                            name="password"
                            type="text"
                            required
                            minLength={8}
                            autoFocus
                            autoComplete="off"
                            placeholder="Contraseña nueva"
                            className="w-44 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1 text-sm outline-none focus:border-[var(--color-accent)]"
                          />
                          <button
                            type="submit"
                            disabled={isPending}
                            className="rounded-lg bg-[var(--color-accent)] px-2.5 py-1 text-xs font-semibold text-[#04121c] disabled:opacity-50"
                          >
                            Guardar
                          </button>
                          <button
                            type="button"
                            onClick={() => setReseteando(null)}
                            className="rounded-lg px-2 py-1 text-[var(--color-muted)]"
                          >
                            ✕
                          </button>
                        </form>
                      ) : editable ? (
                        <>
                          <button
                            type="button"
                            disabled={isPending}
                            onClick={() => {
                              setReseteando(p.id);
                              setConfirmando(null);
                              setError(null);
                              setAviso(null);
                            }}
                            className="rounded-lg px-2.5 py-1 text-[var(--color-muted)] transition-colors hover:text-[var(--color-ink)] disabled:opacity-50"
                          >
                            Contraseña
                          </button>
                          <button
                            type="button"
                            disabled={isPending}
                            onClick={() => run(() => setActive(p.id, !p.active))}
                            className="rounded-lg px-2.5 py-1 text-[var(--color-muted)] transition-colors hover:text-[var(--color-ink)] disabled:opacity-50"
                          >
                            {p.active ? "Dar de baja" : "Reactivar"}
                          </button>

                          {confirmando === p.id ? (
                            <>
                              <button
                                type="button"
                                disabled={isPending}
                                onClick={() =>
                                  run(
                                    () => deleteStaff(p.id),
                                    () => setConfirmando(null)
                                  )
                                }
                                className="rounded-lg bg-[var(--color-danger)] px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50"
                              >
                                Confirmar
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmando(null)}
                                className="rounded-lg px-2 py-1 text-[var(--color-muted)]"
                              >
                                ✕
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              disabled={isPending}
                              onClick={() => setConfirmando(p.id)}
                              className="rounded-lg px-2.5 py-1 text-[var(--color-muted)] transition-colors hover:text-[var(--color-danger)] disabled:opacity-50"
                            >
                              Borrar
                            </button>
                          )}
                        </>
                      ) : (
                        <span
                          title={
                            soyYo
                              ? "No podés editar tu propio usuario"
                              : "Solo se puede editar a alguien de nivel inferior al tuyo"
                          }
                          className="px-2.5 py-1 text-xs text-[var(--color-muted)]"
                        >
                          {soyYo ? "—" : "Fuera de tu alcance"}
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-3 grid gap-1 text-xs text-[var(--color-muted)]">
        <p>
          Se manda sobre quien tiene un nivel <strong>por debajo</strong> del
          propio: un gerente sobre admins y mozos, un admin sobre mozos. Nadie
          puede cambiarse el rol a sí mismo, y tiene que quedar siempre al menos
          un gerente activo.
        </p>
        <p>
          <strong>La contraseña no se puede consultar</strong>, ni desde acá ni
          desde ningún lado: se guarda cifrada de una sola dirección. Si un mozo
          la olvida, se le pone una nueva con «Contraseña» y se la pasás en mano.
        </p>
        <p>
          <strong>Dar de baja</strong> revoca todos los permisos y conserva el
          historial: las ventas que cargó siguen figurando a su nombre.{" "}
          <strong>Borrar</strong> elimina el usuario y deja esas cuentas sin
          dueño. Salvo que alguien se haya cargado por error, conviene dar de
          baja.
        </p>
      </div>
    </main>
  );
}
