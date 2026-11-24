import { NextResponse } from 'next/server';
import { rawDb, must } from '@/lib/supabase/server';
import { hashPassword, isEmail, validatePassword } from '@/lib/auth/password';
import { clientIp, withSession } from '@/lib/auth/server';
import { checkLimit, recordAttempt } from '@/lib/auth/limits';
import { MARKETPLACES } from '@/lib/marketplaces/meta';
import { TERMS_VERSION } from '@/lib/legal';

export const dynamic = 'force-dynamic';

/**
 * Yeni mağaza + sahibi hesabı. Herkes kendi e-postasıyla kayıt olabilir;
 * her mağazanın ürünleri, siparişleri ve pazaryeri anahtarları birbirinden tamamen ayrıdır.
 */
export async function POST(req: Request) {
  const ip = clientIp(req);
  try {
    const b = (await req.json().catch(() => ({}))) as { name?: string; email?: string; password?: string; storeName?: string; acceptTerms?: boolean };
    const email = String(b.email ?? '').trim().toLowerCase();
    const name = String(b.name ?? '').trim().slice(0, 100);
    const storeName = String(b.storeName ?? '').trim().slice(0, 120);
    if (!name) return NextResponse.json({ error: 'Adınızı girin.' }, { status: 400 });
    if (!storeName) return NextResponse.json({ error: 'Mağaza adını girin.' }, { status: 400 });
    if (!b.acceptTerms) return NextResponse.json({ error: 'Devam etmek için kullanım şartlarını ve KVKK aydınlatma metnini onaylayın.' }, { status: 400 });
    if (!isEmail(email)) return NextResponse.json({ error: 'Geçerli bir e-posta girin.' }, { status: 400 });
    let pw: string;
    try { pw = validatePassword(b.password, email); } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }

    const limited = await checkLimit('signup', email, ip);
    if (limited) return NextResponse.json({ error: limited }, { status: 429 });
    await recordAttempt('signup', email, ip, true);

    const { data: exists } = await rawDb().from('app_users').select('id').eq('email', email).maybeSingle();
    if (exists) return NextResponse.json({ error: 'Bu e-posta ile zaten bir hesap var. Giriş yapın veya "Şifremi unuttum"u kullanın.' }, { status: 409 });

    const passwordHash = await hashPassword(pw);
    const store = must(await rawDb().from('stores').insert({ name: storeName }).select('id').single()) as { id: string };
    const row = { email, name, password_hash: passwordHash, role: 'owner', store_id: store.id, password_changed_at: new Date().toISOString() };
    let ins = await rawDb().from('app_users')
      .insert({ ...row, terms_accepted_at: new Date().toISOString(), terms_version: TERMS_VERSION })
      .select('id, email, name, session_version').single();
    // schema.sql henüz güncellenmediyse (onay sütunları yok) kayıt yine de çalışsın
    if (ins.error && (ins.error.code === 'PGRST204' || ins.error.code === '42703')) {
      ins = await rawDb().from('app_users').insert(row).select('id, email, name, session_version').single();
    }
    if (ins.error) {
      await rawDb().from('stores').delete().eq('id', store.id);
      if (ins.error.code === '23505') return NextResponse.json({ error: 'Bu e-posta ile zaten bir hesap var.' }, { status: 409 });
      throw new Error(ins.error.message);
    }
    const user = ins.data as { id: string; email: string; name: string; session_version: number };
    await rawDb().from('marketplace_credentials').insert(MARKETPLACES.map((m) => ({ store_id: store.id, marketplace_name: m })));
    await rawDb().from('app_settings').insert({ store_id: store.id, key: 'company', value: { name: storeName, email } });
    return withSession(NextResponse.json({ ok: true }), { uid: user.id, sid: store.id, sv: user.session_version ?? 0, email: user.email, name: user.name });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
