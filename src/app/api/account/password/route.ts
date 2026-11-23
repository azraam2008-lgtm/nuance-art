import { NextResponse } from 'next/server';
import { handle, HttpError, readJson } from '@/lib/api';
import { rawDb, must } from '@/lib/supabase/server';
import { currentUserId } from '@/lib/tenant';
import { hashPassword, validatePassword, verifyPassword } from '@/lib/auth/password';
import { clientIp, withSession } from '@/lib/auth/server';
import { checkLimit, recordAttempt } from '@/lib/auth/limits';
import { mailConfigured, sendPasswordChangedMail } from '@/lib/auth/mail';

export const dynamic = 'force-dynamic';

/**
 * Şifre değiştirme: mevcut şifre doğrulanır, yeni şifre kaydedilir,
 * diğer cihazlardaki oturumlar kapatılır (bu cihaz giriş yapmış kalır) ve bilgilendirme e-postası gider.
 */
export const POST = handle(async (req: Request) => {
  const b = await readJson<{ currentPassword?: string; newPassword?: string }>(req);
  const user = must(await rawDb().from('app_users').select('id, email, name, store_id, password_hash, session_version').eq('id', currentUserId()).single()) as
    { id: string; email: string; name: string; store_id: string; password_hash: string; session_version: number };
  const ip = clientIp(req);
  const limited = await checkLimit('login', user.email, ip);
  if (limited) throw new HttpError(429, limited);
  const ok = await verifyPassword(String(b.currentPassword ?? ''), user.password_hash);
  if (!ok) {
    await recordAttempt('login', user.email, ip, false);
    throw new HttpError(400, 'Mevcut şifre hatalı.');
  }
  let pw: string;
  try { pw = validatePassword(b.newPassword, user.email); } catch (e) { throw new HttpError(400, (e as Error).message); }
  if (await verifyPassword(pw, user.password_hash)) throw new HttpError(400, 'Yeni şifre eskisiyle aynı olamaz.');
  const sv = (user.session_version ?? 0) + 1;
  must(await rawDb().from('app_users').update({ password_hash: await hashPassword(pw), session_version: sv, password_changed_at: new Date().toISOString() }).eq('id', user.id).select('id'));
  if (mailConfigured()) await sendPasswordChangedMail(user.email, user.name).catch((e) => console.error('[mail]', e));
  return withSession(NextResponse.json({ ok: true }), { uid: user.id, sid: user.store_id, sv, email: user.email, name: user.name });
});
