import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const PUBLIC_ROUTES = [
  '/login',
  '/register',
  '/setup-keys',
  '/share',
  '/invite',
  '/guest',
  '/desktop',
]

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Lascia passare le route pubbliche
  if (PUBLIC_ROUTES.some((route) => pathname.startsWith(route))) {
    return NextResponse.next()
  }

  // Lascia passare le route API e file statici
  if (
    pathname.startsWith('/api') ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon')
  ) {
    return NextResponse.next()
  }

  // Per tutte le altre route: non fare redirect dal middleware.
  // Il token dev è in localStorage; il middleware (Edge) non può leggerlo.
  // Il layout client-side (app)/layout.tsx gestisce l'auth e fa
  // router.replace('/login') se !isLoading && !user.
  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
