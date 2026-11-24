import 'server-only';
import { db, rawDb } from '@/lib/supabase/server';
import { currentStoreId } from '@/lib/tenant';
import { mailConfigured, sendMail } from '@/lib/auth/mail';
import { istanbulDate } from '@/lib/api';
import { MARKETPLACE_META, isMarketplace } from '@/lib/marketplaces/meta';

/** Bildirim ayarları (app_settings → notifications) */
export interface NotifySettings {
  email: string; newOrder: boolean; stockOut: boolean; lateOrders: boolean; syncFailed: boolean; dailySummary: boolean;
}
export const NOTIFY_DEFAULTS: Omit<NotifySettings, 'email'> = { newOrder: true, stockOut: true, lateOrders: true, syncFailed: true, dailySummary: false };
interface NotifyState { lastRunAt?: string; summaryDate?: string; late?: string[]; out?: string[] }

const mpLabel = (m: string) => (isMarketplace(m) ? MARKETPLACE_META[m].label : m);
const tl = (n: number) => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(n || 0);
const OPEN = ['new', 'approved', 'preparing', 'invoiced'];

export async function getNotifySettings(): Promise<NotifySettings> {
  const { data } = await db().from('app_settings').select('value').eq('key', 'notifications').maybeSingle();
  const v = (data?.value ?? {}) as Partial<NotifySettings>;
  let email = v.email ?? '';
  if (!email) {
    const { data: owner } = await rawDb().from('app_users').select('email').eq('store_id', currentStoreId()).eq('role', 'owner').limit(1).maybeSingle();
    email = owner?.email ?? '';
  }
  return { ...NOTIFY_DEFAULTS, ...v, email };
}

/**
 * Mağazanın bildirimlerini toplayıp tek bir e-postada gönderir (zamanlayıcı 5 dakikada bir çağırır).
 * Aynı gecikme / stok bitti uyarısı bir kez gönderilir; ürün stoğu dönünce tekrar uyarılabilir.
 * Günlük özet saat 08:00'den sonra günde bir kez (Türkiye saati) gönderilir.
 */
export async function runNotifications(): Promise<{ sent: boolean; items: number; skipped?: string }> {
  const { data: row } = await db().from('app_settings').select('value').eq('key', 'notifications').maybeSingle();
  if (!row) return { sent: false, items: 0, skipped: 'kapalı' };
  if (!mailConfigured()) return { sent: false, items: 0, skipped: 'e-posta ayarlı değil' };
  const s = await getNotifySettings();
  if (!s.email) return { sent: false, items: 0, skipped: 'alıcı yok' };

  const { data: st } = await db().from('app_settings').select('value').eq('key', 'notify_state').maybeSingle();
  const state = (st?.value ?? {}) as NotifyState;
  const now = new Date();
  // İlk çalışmada geçmişi e-postayla doldurmamak için son 10 dakikaya bakılır
  const since = state.lastRunAt ?? new Date(now.getTime() - 10 * 60_000).toISOString();
  const sections: string[] = [];
  let items = 0;

  if (s.newOrder) {
    const { data } = await db().from('orders').select('marketplace_name, marketplace_order_id, total_amount, customer_name').gt('created_at', since).order('created_at').limit(50);
    if (data?.length) {
      items += data.length;
      sections.push(`🛒 YENİ SİPARİŞ (${data.length})\n` + data.map((o) => `• ${mpLabel(o.marketplace_name)} #${o.marketplace_order_id} — ${tl(Number(o.total_amount))}${o.customer_name ? ` — ${o.customer_name}` : ''}`).join('\n'));
    }
  }

  let out = state.out ?? [];
  if (s.stockOut) {
    const { data } = await db().from('products').select('id, sku, title, total_stock').lte('total_stock', 0).limit(500);
    const now0 = new Set((data ?? []).map((p) => p.id as string));
    const fresh = (data ?? []).filter((p) => !out.includes(p.id));
    out = [...now0]; // stoğu dönen ürün listeden çıkar → tekrar biterse yine uyarılır
    if (fresh.length) {
      items += fresh.length;
      sections.push(`📦 STOĞU BİTEN ÜRÜN (${fresh.length})\n` + fresh.slice(0, 30).map((p) => `• ${p.sku} — ${p.title}`).join('\n') + '\nStok bitince ilanlar pazaryerlerinde 0 stokla görünür; Stok sayfasından giriş yapabilirsiniz.');
    }
  }

  let late = state.late ?? [];
  if (s.lateOrders) {
    const { data } = await db().from('orders').select('id, marketplace_name, marketplace_order_id, cost:order_costs!inner(deadline)')
      .in('status', OPEN).lt('cost.deadline', now.toISOString()).limit(200);
    const ids = (data ?? []).map((o) => o.id as string);
    const fresh = (data ?? []).filter((o) => !late.includes(o.id));
    late = ids;
    if (fresh.length) {
      items += fresh.length;
      sections.push(`⏰ KARGO SÜRESİ GEÇEN SİPARİŞ (${fresh.length})\n` + fresh.slice(0, 30).map((o) => `• ${mpLabel(o.marketplace_name)} #${o.marketplace_order_id}`).join('\n') + '\nGeciken siparişler pazaryerinde puanınızı düşürebilir.');
    }
  }

  if (s.syncFailed) {
    const { data } = await db().from('sync_jobs').select('kind, marketplace_name, last_error').eq('status', 'failed').gt('updated_at', since).limit(30);
    if (data?.length) {
      items += data.length;
      const kind: Record<string, string> = { push_stock: 'Stok', publish: 'Yayın', update_product: 'İçerik', order_status: 'Sipariş durumu' };
      sections.push(`⚠️ GÖNDERİLEMEYEN İŞLEM (${data.length})\n` + data.map((j) => `• ${mpLabel(j.marketplace_name ?? '')}: ${kind[j.kind] ?? j.kind} — ${(j.last_error ?? '').slice(0, 140)}`).join('\n') + '\nAyrıntı ve tekrar deneme: İşlem Merkezi.');
    }
  }

  let summaryDate = state.summaryDate;
  const today = istanbulDate(now);
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Istanbul', hour: '2-digit', hour12: false }).format(now));
  if (s.dailySummary && summaryDate !== today && hour >= 8) {
    summaryDate = today;
    sections.push(await dailySummary(now));
    items++;
  }

  let sent = false;
  if (sections.length) {
    const { data: store } = await rawDb().from('stores').select('name').eq('id', currentStoreId()).single();
    const subject = sections.length === 1 && s.dailySummary && summaryDate === today && items === 1
      ? `${store?.name ?? 'Mağaza'}: günlük özet`
      : `${store?.name ?? 'Mağaza'}: ${items} yeni bildirim`;
    await sendMail(s.email, subject, `${sections.join('\n\n')}\n\n—\nBu bildirimleri panelde Hesabım → Bildirimler bölümünden değiştirebilirsiniz.`);
    sent = true;
  }
  await db().from('app_settings').upsert({ key: 'notify_state', value: { lastRunAt: now.toISOString(), summaryDate, late: late.slice(0, 500), out: out.slice(0, 1000) }, updated_at: now.toISOString() });
  return { sent, items };
}

/** Dünün özeti (yalnızca kendi hesaplarımız; yapay zekâ yok) */
async function dailySummary(now: Date): Promise<string> {
  const y = istanbulDate(new Date(now.getTime() - 86_400_000));
  const from = new Date(`${y}T00:00:00+03:00`).toISOString();
  const to = new Date(`${y}T23:59:59.999+03:00`).toISOString();
  const { data: orders } = await db().from('orders').select('marketplace_name, status, total_amount, cost:order_costs(net_profit)').gte('order_date', from).lte('order_date', to).limit(5000);
  const valid = (orders ?? []).filter((o) => o.status !== 'cancelled' && o.status !== 'returned');
  const revenue = valid.reduce((t, o) => t + Number(o.total_amount), 0);
  const profit = valid.reduce((t, o) => {
    const c = Array.isArray(o.cost) ? o.cost[0] : o.cost;
    return t + Number((c as { net_profit?: number } | null)?.net_profit ?? 0);
  }, 0);
  const byMp: Record<string, number> = {};
  for (const o of valid) byMp[o.marketplace_name] = (byMp[o.marketplace_name] ?? 0) + 1;
  const { data: prods } = await db().from('products').select('total_stock, low_stock_threshold').limit(5000);
  const outN = (prods ?? []).filter((p) => p.total_stock <= 0).length;
  const lowN = (prods ?? []).filter((p) => p.total_stock > 0 && p.total_stock < p.low_stock_threshold).length;
  const { count: openN } = await db().from('orders').select('id', { count: 'exact', head: true }).in('status', OPEN);
  const [yy, mm, dd] = y.split('-');
  return [
    `📊 DÜNÜN ÖZETİ (${dd}.${mm}.${yy})`,
    `• Sipariş: ${valid.length}${valid.length ? ` (${Object.entries(byMp).sort((a, b) => b[1] - a[1]).map(([m, n]) => `${mpLabel(m)} ${n}`).join(', ')})` : ''}`,
    `• Ciro: ${tl(revenue)}`,
    `• Tahmini net kâr: ${tl(profit)}`,
    `• Hazırlanacak açık sipariş: ${openN ?? 0}`,
    `• Stoğu biten ürün: ${outN} · Kritik stokta: ${lowN}`,
    `Ayrıntılı öneriler için panelde "Öneriler" sayfasına bakın.`,
  ].join('\n');
}
