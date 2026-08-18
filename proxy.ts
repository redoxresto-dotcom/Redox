import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refresca el token de Supabase en cada request y cierra el paso a /admin y
 * a /estacion si no hay sesión. Es la única parte de la app que puede escribir las
 * cookies de sesión, por eso el refresh vive acá.
 *
 * (En Next 16 este archivo reemplaza al viejo middleware.ts.)
 */
export default async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Sin variables de entorno no hay nada que refrescar; el guard del layout
  // de /admin mostrará el error correspondiente.
  if (!url || !anonKey) return response;

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // getUser() valida el token contra Supabase. No usar getSession() acá:
  // lee la cookie sin verificarla y se puede falsificar.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname, search } = request.nextUrl;

  // Las pantallas de barra y cocina son personal, igual que el panel: quedan
  // detrás del mismo guard.
  const esPrivada =
    pathname.startsWith("/admin") || pathname.startsWith("/estacion");

  if (!user && esPrivada) {
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.search = "";
    login.searchParams.set("redirect", pathname + search);
    return NextResponse.redirect(login);
  }

  if (user && pathname === "/login") {
    const admin = request.nextUrl.clone();
    admin.pathname = "/admin";
    admin.search = "";
    return NextResponse.redirect(admin);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Todo salvo estáticos, imágenes y /api. En particular /table/[id] queda
     * fuera del guard: el cliente del bar entra sin login. Y /api tampoco pasa
     * por acá: el webhook del pool se autentica con su propio secreto, no con
     * cookies, y no tiene sentido consultar la sesión en cada request.
     */
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
