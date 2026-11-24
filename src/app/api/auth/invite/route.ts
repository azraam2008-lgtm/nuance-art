import { NextResponse } from 'next/server';
import { rawDb } from '@/lib/supabase/server';
import { hashPassword, hashToken, validatePassword } from '@/lib/auth/password';
import { withSession } from '@/lib/auth/server';
import { withStore } from '@/lib/tenant';
import { audit } from '@/lib/audit';
import { TERMS_VERSION } from '@/lib/legal';

export const dynamic = 'force-dynamic';

const INVALID = 'Davet bağlantısı geçersiz, süresi dolmuş veya iptal edilmiş. Mağaza sahibinden yeni bir davet isteyin.';

async function find(token: string) {
  if (!token || token.length > 200) return null;
  const { data } = await rawDb().from('invites').select('id, store_id, email, role, expires_at, accepted_at, revoked_at').eq('token_hash', hashToken(token)).maybeSingle();
  if (!data || data.accepted_at || data.revoked_at || Date.parse(data.expires_at) < Date.now()) return null;
  return data as { id: string; store_id: string; email: string; role: 'admin' | 'staff' };
}

/** Davet bilgisi (sayfa açılınca) */
export async function GET(req: Request) {
  const inv = await find(new URL(req.url).searchParams.get('token') ?? '');
  if (!inv) return NextResponse.json({ error: INVALID }, { status: 400 });
  const { data: store } = await rawDb().from('stores').select('name').eq('id', inv.store_id).single();
  return NextResponse.json({ email: inv.email, role: inv.role, storeName: store?.name ?? '' });
}

/** Daveti kabul et: ad + şifre belirlenir, kullanıcı mağazaya bağlanır ve giriş yapılır */
export async function POST(req: Request) {
  try {
    const b = (await req.json().catch(() => ({}))) as { token?: string; name?: string; password?: string; acceptTerms?: boolean };
    const inv = await find(String(b.token ?? ''));
    if (!inv) return NextResponse.json({ error: INVALID }, { status: 400 });
    if (!b.acceptTerms) return NextResponse.json({ error: 'Devam etmek için kullanım şartlarını ve KVKK aydınlatma metnini onaylayın.' }, { status: 400 });
    const name = String(b.name ?? '').trim().slice(0, 100);
    if (!name) return NextResponse.json({ error: 'Adınızı girin.' }, { status: 400 });
    let pw: string;
    try { pw = validatePassword(b.password, inv.email); } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }
    const used = await rawDb().from('invites').update({ accepted_at: new Date().toISOString() }).eq('id', inv.id).is('accepted_at', null).select('id');
    if (!used.data?.length) return NextResponse.json({ error: INVALID }, { status: 400 });
    const ins = await rawDb().from('app_users').insert({
      email: inv.email, name, password_hash: await hashPassword(pw), role: inv.role, store_id: inv.store_id,
      password_changed_at: new Date().toISOString(), terms_accepted_at: new Date().toISOString(), terms_version: TERMS_VERSION,
    }).select('id, email, name, session_version').single();
    if (ins.error) {
      return NextResponse.json({ error: ins.error.code === '23505' ? 'Bu e-posta ile zaten bir hesap var. Giriş yapın.' : ins.error.message }, { status: 409 });
    }
    const user = ins.data as { id: string; email: string; name: string; session_version: number };
    await withStore(inv.store_id, () => audit('Ekibe katıldı', `${user.email}`), user.id, { role: inv.role, name: user.name });
    return withSession(NextResponse.json({ ok: true }), { uid: user.id, sid: inv.store_id, sv: user.session_version ?? 0, email: user.email, name: user.name });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
