import { handle, HttpError, readJson } from '@/lib/api';
import { db, rawDb, must } from '@/lib/supabase/server';
import { currentStoreId, currentUserId } from '@/lib/tenant';
import { mailConfigured } from '@/lib/auth/mail';

export const dynamic = 'force-dynamic';

/** Hesap bilgileri: ad, e-posta, mağaza adı, son şifre değişikliği */
export const GET = handle(async () => {
  const user = must(await rawDb().from('app_users').select('id, email, name, role, created_at, last_login_at, password_changed_at').eq('id', currentUserId()).single());
  const store = must(await rawDb().from('stores').select('id, name, created_at').eq('id', currentStoreId()).single());
  return { user, store, mailConfigured: mailConfigured() };
});

/** Ad ve mağaza adını günceller */
export const PATCH = handle(async (req: Request) => {
  const b = await readJson<{ name?: string; storeName?: string }>(req);
  if (b.name !== undefined) {
    const name = String(b.name).trim().slice(0, 100);
    if (!name) throw new HttpError(400, 'Adınızı girin.');
    must(await rawDb().from('app_users').update({ name }).eq('id', currentUserId()).select('id'));
  }
  if (b.storeName !== undefined) {
    const storeName = String(b.storeName).trim().slice(0, 120);
    if (!storeName) throw new HttpError(400, 'Mağaza adını girin.');
    must(await rawDb().from('stores').update({ name: storeName }).eq('id', currentStoreId()).select('id'));
    const { data } = await db().from('app_settings').select('value').eq('key', 'company').maybeSingle();
    must(await db().from('app_settings').upsert({ key: 'company', value: { ...((data?.value as object) ?? {}), name: storeName }, updated_at: new Date().toISOString() }));
  }
  return { ok: true };
});
