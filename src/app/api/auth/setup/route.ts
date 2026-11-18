import { NextResponse } from 'next/server';
import { db, must } from '@/lib/supabase/server';
import { hashPassword, validatePassword } from '@/lib/auth/password';
import { withSession } from '@/lib/auth/server';

export const dynamic = 'force-dynamic';

/** İlk yönetici hesabı — yalnızca hiç kullanıcı yokken çalışır */
export async function POST(req: Request) {
  try {
    const { count } = await db().from('app_users').select('id', { count: 'exact', head: true });
    if ((count ?? 0) > 0) return NextResponse.json({ error: 'Kurulum zaten tamamlanmış. Giriş yapın.' }, { status: 409 });
    const b = (await req.json()) as { name?: string; email?: string; password?: string; companyName?: string };
    const email = String(b.email ?? '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: 'Geçerli bir e-posta girin.' }, { status: 400 });
    const name = String(b.name ?? '').trim().slice(0, 100);
    if (!name) return NextResponse.json({ error: 'Adınızı girin.' }, { status: 400 });
    let pw: string;
    try { pw = validatePassword(b.password); } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }
    const user = must(await db().from('app_users').insert({ email, name, password_hash: await hashPassword(pw), role: 'admin' }).select('id, email, name').single()) as { id: string; email: string; name: string };
    if (b.companyName?.trim()) {
      await db().from('app_settings').upsert({ key: 'company', value: { name: b.companyName.trim().slice(0, 120) }, updated_at: new Date().toISOString() });
    }
    return withSession(NextResponse.json({ ok: true }), { uid: user.id, email: user.email, name: user.name });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
