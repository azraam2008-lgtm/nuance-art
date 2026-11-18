import { NextResponse } from 'next/server';
import { db } from '@/lib/supabase/server';
import { verifyPassword } from '@/lib/auth/password';
import { withSession } from '@/lib/auth/server';

export const dynamic = 'force-dynamic';

// Basit kaba kuvvet koruması (sunucu örneği başına): 10 hatalı denemede 15 dk bekleme
const attempts = new Map<string, { n: number; until: number }>();

export async function POST(req: Request) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  const a = attempts.get(ip);
  if (a && a.until > Date.now()) return NextResponse.json({ error: 'Çok fazla hatalı deneme. 15 dakika sonra tekrar deneyin.' }, { status: 429 });
  try {
    const b = (await req.json()) as { email?: string; password?: string };
    const email = String(b.email ?? '').trim().toLowerCase();
    const { data } = await db().from('app_users').select('id, email, name, password_hash').eq('email', email).maybeSingle();
    const ok = data ? await verifyPassword(String(b.password ?? ''), data.password_hash) : false;
    if (!ok || !data) {
      const n = (a?.n ?? 0) + 1;
      attempts.set(ip, { n, until: n >= 10 ? Date.now() + 15 * 60_000 : 0 });
      return NextResponse.json({ error: 'E-posta veya şifre hatalı.' }, { status: 401 });
    }
    attempts.delete(ip);
    await db().from('app_users').update({ last_login_at: new Date().toISOString() }).eq('id', data.id);
    return withSession(NextResponse.json({ ok: true }), { uid: data.id, email: data.email, name: data.name });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
