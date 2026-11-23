import { NextResponse } from 'next/server';
import { rawDb } from '@/lib/supabase/server';
import { hashPassword, hashToken, validatePassword } from '@/lib/auth/password';
import { withSession } from '@/lib/auth/server';

export const dynamic = 'force-dynamic';

async function findToken(token: string) {
  if (!token || token.length > 200) return null;
  const { data } = await rawDb().from('password_resets').select('id, user_id, expires_at, used_at').eq('token_hash', hashToken(token)).maybeSingle();
  if (!data || data.used_at || Date.parse(data.expires_at) < Date.now()) return null;
  return data as { id: string; user_id: string };
}

const INVALID = 'Bu bağlantı geçersiz veya süresi dolmuş. "Şifremi unuttum" sayfasından yeni bir bağlantı isteyin.';

/** Bağlantı hâlâ geçerli mi? (sayfa açılınca kontrol edilir) */
export async function GET(req: Request) {
  const ok = !!(await findToken(new URL(req.url).searchParams.get('token') ?? ''));
  return NextResponse.json(ok ? { ok: true } : { error: INVALID }, { status: ok ? 200 : 400 });
}

/** Yeni şifreyi kaydeder, tüm eski oturumları kapatır ve kullanıcıyı giriş yapmış hale getirir */
export async function POST(req: Request) {
  try {
    const b = (await req.json().catch(() => ({}))) as { token?: string; password?: string };
    const row = await findToken(String(b.token ?? ''));
    if (!row) return NextResponse.json({ error: INVALID }, { status: 400 });
    const { data: user } = await rawDb().from('app_users').select('id, email, name, store_id, session_version').eq('id', row.user_id).single();
    if (!user) return NextResponse.json({ error: INVALID }, { status: 400 });
    let pw: string;
    try { pw = validatePassword(b.password, user.email); } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }

    // Tek kullanımlık: önce bağlantıyı kullanılmış işaretle (aynı anda iki istek gelse de biri geçer)
    const used = await rawDb().from('password_resets').update({ used_at: new Date().toISOString() }).eq('id', row.id).is('used_at', null).select('id');
    if (!used.data?.length) return NextResponse.json({ error: INVALID }, { status: 400 });

    const sv = (user.session_version ?? 0) + 1;
    const { error } = await rawDb().from('app_users')
      .update({ password_hash: await hashPassword(pw), session_version: sv, password_changed_at: new Date().toISOString() }).eq('id', user.id);
    if (error) throw new Error(error.message);
    await rawDb().from('auth_attempts').delete().eq('kind', 'login').eq('key', user.email);
    return withSession(NextResponse.json({ ok: true }), { uid: user.id, sid: user.store_id, sv, email: user.email, name: user.name });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
