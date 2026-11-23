import 'server-only';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { rawDb } from '@/lib/supabase/server';
import { SESSION_COOKIE, SESSION_DAYS, signSession, verifySession, type SessionPayload } from './session';

/** Çerezdeki imzalı oturum (veritabanına bakmadan) */
export async function currentUser(): Promise<SessionPayload | null> {
  const c = await cookies();
  return verifySession(c.get(SESSION_COOKIE)?.value);
}

export interface ActiveUser { id: string; email: string; name: string; role: string; storeId: string }

/**
 * Oturumu veritabanıyla doğrular: kullanıcı hâlâ var mı, mağazası aynı mı, şifre değiştikten sonra
 * eski oturum mu? Şifre değişince session_version artar ve diğer cihazlardaki oturumlar kapanır.
 */
export async function activeUser(): Promise<ActiveUser | null> {
  const s = await currentUser();
  if (!s) return null;
  const { data } = await rawDb().from('app_users').select('id, email, name, role, store_id, session_version').eq('id', s.uid).maybeSingle();
  if (!data || data.store_id !== s.sid || Number(data.session_version ?? 0) !== Number(s.sv ?? 0)) return null;
  return { id: data.id, email: data.email, name: data.name, role: data.role, storeId: data.store_id };
}

export async function withSession(res: NextResponse, user: { uid: string; sid: string; sv: number; email: string; name: string }) {
  res.cookies.set(SESSION_COOKIE, await signSession(user), {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: SESSION_DAYS * 86_400,
  });
  return res;
}

export function clearSession(res: NextResponse) {
  res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
  return res;
}

/** İsteğin IP adresi (Vercel x-forwarded-for) */
export function clientIp(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'local';
}

/** Sitenin herkese açık adresi: APP_URL varsa o, yoksa isteğin geldiği adres */
export function appOrigin(req: Request): string {
  const env = process.env.APP_URL?.trim();
  if (env) return env.replace(/\/+$/, '');
  return new URL(req.url).origin;
}
