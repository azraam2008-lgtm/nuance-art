import { randomBytes } from 'crypto';
import { handle, HttpError, readJson, requireRole } from '@/lib/api';
import { db, rawDb, must } from '@/lib/supabase/server';
import { currentRole, currentStoreId, currentUserId } from '@/lib/tenant';
import { hashToken, isEmail } from '@/lib/auth/password';
import { appOrigin } from '@/lib/auth/server';
import { mailConfigured, sendMail } from '@/lib/auth/mail';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

const ROLE_TR: Record<string, string> = { owner: 'Sahip', admin: 'Yönetici', staff: 'Personel' };

/** Ekip: üyeler, bekleyen davetler, son işlemler */
export const GET = handle(async () => {
  const members = must(await rawDb().from('app_users').select('id, name, email, role, created_at, last_login_at').eq('store_id', currentStoreId()).order('created_at'));
  const invites = currentRole() === 'owner'
    ? must(await db().from('invites').select('id, email, role, expires_at, created_at').is('accepted_at', null).is('revoked_at', null).gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false }))
    : [];
  const log = currentRole() === 'staff' ? [] : must(await db().from('audit_log').select('id, user_name, action, detail, created_at').order('created_at', { ascending: false }).limit(60));
  return { me: currentUserId(), myRole: currentRole(), members, invites, log, mailConfigured: mailConfigured() };
});

/** Davet et / daveti iptal et / rol değiştir / ekipten çıkar — yalnızca mağaza sahibi */
export const POST = handle(async (req: Request) => {
  requireRole('owner');
  const b = await readJson<{ action?: string; email?: string; role?: string; id?: string; userId?: string }>(req);
  const role = b.role === 'admin' ? 'admin' : 'staff';
  const validId = (v?: string) => { if (!v || !/^[0-9a-f-]{36}$/i.test(v)) throw new HttpError(400, 'Geçersiz kayıt.'); return v; };

  if (b.action === 'invite') {
    const email = String(b.email ?? '').trim().toLowerCase();
    if (!isEmail(email)) throw new HttpError(400, 'Geçerli bir e-posta girin.');
    const { data: existing } = await rawDb().from('app_users').select('store_id').eq('email', email).maybeSingle();
    if (existing) throw new HttpError(409, existing.store_id === currentStoreId() ? 'Bu kişi zaten ekipte.' : 'Bu e-posta başka bir mağazada kayıtlı. Şimdilik her e-posta tek mağazaya bağlanabiliyor.');
    const token = randomBytes(32).toString('base64url');
    must(await db().from('invites').update({ revoked_at: new Date().toISOString() }).eq('email', email).is('accepted_at', null).select('id'));
    must(await db().from('invites').insert({ email, role, token_hash: hashToken(token), invited_by: currentUserId(), expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString() }).select('id'));
    const link = `${appOrigin(req)}/invite?token=${token}`;
    let mailed = false;
    if (mailConfigured()) {
      const { data: store } = await rawDb().from('stores').select('name').eq('id', currentStoreId()).single();
      await sendMail(email, `${store?.name ?? 'Mağaza'} ekibine davet edildiniz`,
        `Merhaba,\n\n${store?.name ?? 'Bir mağaza'} sizi pazaryeri yönetim paneline "${ROLE_TR[role]}" olarak davet etti.\nKatılmak ve şifrenizi belirlemek için bağlantıya tıklayın (7 gün geçerlidir):\n\n${link}\n`)
        .then(() => { mailed = true; }, (e) => console.error('[mail]', e));
    }
    await audit('Ekibe davet', `${email} (${ROLE_TR[role]})`);
    return { link, mailed };
  }
  if (b.action === 'revoke') {
    must(await db().from('invites').update({ revoked_at: new Date().toISOString() }).eq('id', validId(b.id)).select('id'));
    return { ok: true };
  }
  if (b.action === 'role' || b.action === 'remove') {
    const uid = validId(b.userId);
    if (uid === currentUserId()) throw new HttpError(400, 'Kendi rolünüzü değiştiremez veya kendinizi çıkaramazsınız.');
    const target = must(await rawDb().from('app_users').select('id, email, role, session_version').eq('id', uid).eq('store_id', currentStoreId()).maybeSingle()) as { id: string; email: string; role: string; session_version: number } | null;
    if (!target) throw new HttpError(404, 'Kullanıcı bulunamadı.');
    if (target.role === 'owner') throw new HttpError(400, 'Mağaza sahibi değiştirilemez.');
    if (b.action === 'role') {
      must(await rawDb().from('app_users').update({ role, session_version: (target.session_version ?? 0) + 1 }).eq('id', uid).select('id'));
      await audit('Rol değişti', `${target.email} → ${ROLE_TR[role]}`);
    } else {
      must(await rawDb().from('app_users').delete().eq('id', uid).select('id'));
      await audit('Ekipten çıkarıldı', target.email);
    }
    return { ok: true };
  }
  throw new HttpError(400, 'Geçersiz işlem.');
});
