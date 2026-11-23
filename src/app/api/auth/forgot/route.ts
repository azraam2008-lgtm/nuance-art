import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { rawDb } from '@/lib/supabase/server';
import { hashToken, isEmail } from '@/lib/auth/password';
import { appOrigin, clientIp } from '@/lib/auth/server';
import { checkLimit, recordAttempt } from '@/lib/auth/limits';
import { mailConfigured, sendResetMail } from '@/lib/auth/mail';

export const dynamic = 'force-dynamic';

/**
 * "Şifremi unuttum": e-postaya 1 saat geçerli, tek kullanımlık bağlantı gönderir.
 * Hesap olsun olmasın aynı yanıt döner (hangi e-postaların kayıtlı olduğu öğrenilemesin).
 */
export async function POST(req: Request) {
  const ip = clientIp(req);
  try {
    const b = (await req.json().catch(() => ({}))) as { email?: string };
    const email = String(b.email ?? '').trim().toLowerCase();
    if (!isEmail(email)) return NextResponse.json({ error: 'Geçerli bir e-posta girin.' }, { status: 400 });
    if (!mailConfigured()) {
      return NextResponse.json({ error: 'E-posta gönderimi henüz ayarlanmamış. Site yöneticisi Vercel\'e GMAIL_USER ve GMAIL_APP_PASSWORD eklemeli.' }, { status: 503 });
    }
    const limited = await checkLimit('reset', email, ip);
    if (limited) return NextResponse.json({ error: limited }, { status: 429 });
    await recordAttempt('reset', email, ip, true);

    const { data: user } = await rawDb().from('app_users').select('id, name, email').eq('email', email).maybeSingle();
    if (user) {
      const token = randomBytes(32).toString('base64url');
      await rawDb().from('password_resets').update({ used_at: new Date().toISOString() }).eq('user_id', user.id).is('used_at', null);
      const { error } = await rawDb().from('password_resets').insert({
        user_id: user.id, token_hash: hashToken(token), expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      });
      if (error) throw new Error(error.message);
      await sendResetMail(user.email, user.name, `${appOrigin(req)}/reset?token=${token}`);
    }
    return NextResponse.json({ ok: true, message: 'Bu e-posta ile kayıtlı bir hesap varsa, şifre sıfırlama bağlantısı gönderildi. Gelen kutunuzu (ve gereksiz/spam klasörünü) kontrol edin.' });
  } catch (e) {
    return NextResponse.json({ error: `E-posta gönderilemedi: ${e instanceof Error ? e.message : String(e)}` }, { status: 500 });
  }
}
