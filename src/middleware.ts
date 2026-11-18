import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySession } from '@/lib/auth/session';

/**
 * Oturum koruması: giriş yapılmamışsa sayfalar /login'e yönlenir, API'ler 401 döner.
 * Herkese açık: giriş/kurulum sayfaları, auth API'leri, webhook ve cron (kendi gizli anahtarlarıyla korunur),
 * Etsy OAuth dönüşü (kendi state doğrulamasıyla).
 */
const PUBLIC = [/^\/login$/, /^\/setup$/, /^\/api\/auth\//, /^\/api\/webhooks\//, /^\/api\/cron\//];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((r) => r.test(pathname))) return NextResponse.next();
  let ok = false;
  try {
    ok = !!(await verifySession(req.cookies.get(SESSION_COOKIE)?.value));
  } catch {
    ok = false;
  }
  if (ok) return NextResponse.next();
  if (pathname.startsWith('/api/')) return NextResponse.json({ error: 'Oturum gerekli. Lütfen giriş yapın.' }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = pathname !== '/' ? `?next=${encodeURIComponent(pathname)}` : '';
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg).*)'],
};
