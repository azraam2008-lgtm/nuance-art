import { NextResponse } from 'next/server';
import { rawDb } from '@/lib/supabase/server';
import { fakeVerify, hashPassword, needsRehash, verifyPassword } from '@/lib/auth/password';
import { clientIp, withSession } from '@/lib/auth/server';
import { checkLimit, recordAttempt } from '@/lib/auth/limits';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const ip = clientIp(req);
  try {
    const b = (await req.json().catch(() => ({}))) as { email?: string; password?: string };
    const email = String(b.email ?? '').trim().toLowerCase().slice(0, 200);
    const password = String(b.password ?? '');
    const limited = await checkLimit('login', email, ip);
    if (limited) return NextResponse.json({ error: limited }, { status: 429 });

    const { data } = await rawDb().from('app_users').select('id, email, name, password_hash, store_id, session_version').eq('email', email).maybeSingle();
    let ok = false;
    if (data) ok = await verifyPassword(password, data.password_hash).catch(() => false);
    else await fakeVerify(password);
    await recordAttempt('login', email, ip, ok);
    if (!ok || !data) return NextResponse.json({ error: 'E-posta veya şifre hatalı.' }, { status: 401 });
    if (!data.store_id) return NextResponse.json({ error: 'Hesabınız bir mağazaya bağlı değil. Veritabanında schema.sql dosyasını yeniden çalıştırın.' }, { status: 500 });

    const update: Record<string, unknown> = { last_login_at: new Date().toISOString() };
    if (needsRehash(data.password_hash)) update.password_hash = await hashPassword(password); // eski şifreleri güçlü parametreye taşı
    await rawDb().from('app_users').update(update).eq('id', data.id);
    return withSession(NextResponse.json({ ok: true }), { uid: data.id, sid: data.store_id, sv: data.session_version ?? 0, email: data.email, name: data.name });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
