import { handle, HttpError, readJson, requireRole } from '@/lib/api';
import { db, must } from '@/lib/supabase/server';
import { isEmail } from '@/lib/auth/password';
import { mailConfigured, sendMail } from '@/lib/auth/mail';
import { getNotifySettings, NOTIFY_DEFAULTS } from '@/lib/notify';

export const dynamic = 'force-dynamic';

/** E-posta bildirim ayarları */
export const GET = handle(async () => {
  requireRole('admin');
  const { data } = await db().from('app_settings').select('value').eq('key', 'notifications').maybeSingle();
  return { enabled: !!data, settings: await getNotifySettings(), mailConfigured: mailConfigured() };
});

export const PUT = handle(async (req: Request) => {
  requireRole('admin');
  const b = await readJson<Record<string, unknown>>(req);
  const email = String(b.email ?? '').trim().toLowerCase();
  if (!isEmail(email)) throw new HttpError(400, 'Bildirimlerin gideceği geçerli bir e-posta girin.');
  const v: Record<string, unknown> = { email };
  for (const k of Object.keys(NOTIFY_DEFAULTS)) v[k] = Boolean(b[k]);
  must(await db().from('app_settings').upsert({ key: 'notifications', value: v, updated_at: new Date().toISOString() }).select('key'));
  if (b.test) {
    if (!mailConfigured()) throw new HttpError(400, 'Ayarlar kaydedildi, ancak e-posta gönderimi henüz ayarlanmadığı için deneme e-postası gönderilemedi.');
    await sendMail(email, 'Deneme bildirimi', 'Merhaba,\n\nBildirim ayarlarınız çalışıyor. Yeni sipariş, stok bitmesi, geciken sipariş ve gönderilemeyen işlemler bu adrese gelecek.\n');
  }
  return { ok: true };
});
