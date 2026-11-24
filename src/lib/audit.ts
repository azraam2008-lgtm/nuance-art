import 'server-only';
import { db } from '@/lib/supabase/server';
import { currentUserName, maybeUserId } from '@/lib/tenant';

/**
 * "Kim ne yaptı" kaydı (Hesabım → Ekip → Son işlemler). Kayıt hatası asıl işlemi asla bozmaz.
 * Oturumsuz işlerde (zamanlayıcı) kullanıcı "Sistem" olarak yazılır.
 */
export async function audit(action: string, detail = '') {
  try {
    const { error } = await db().from('audit_log').insert({
      user_id: maybeUserId(), user_name: currentUserName() ?? 'Sistem', action: action.slice(0, 80), detail: detail.slice(0, 500),
    });
    if (error) console.error('[audit]', error.message);
  } catch (e) {
    console.error('[audit]', e);
  }
}

/** Kayıtta görünecek sipariş numarası */
export async function orderNo(id: string): Promise<string> {
  const { data } = await db().from('orders').select('marketplace_order_id, marketplace_name').eq('id', id).maybeSingle();
  return data ? `${data.marketplace_name} #${data.marketplace_order_id}` : id.slice(0, 8);
}
