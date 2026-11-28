import { NextResponse } from 'next/server';
import { handle, HttpError, readJson, istanbulDate } from '@/lib/api';
import { db, rawDb, must } from '@/lib/supabase/server';
import { currentStoreId, currentUserId, withStore } from '@/lib/tenant';
import { withSession } from '@/lib/auth/server';
import { BASE_MARKETPLACES } from '@/lib/marketplaces/meta';
import { audit } from '@/lib/audit';
import { ACCENTS, accentFor } from '@/lib/theme';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface StoreRow { id: string; name: string; role: string; isDemo: boolean; accent: string; accentKey: string }

/** Kullanıcının erişebildiği tüm mağazalar (ana mağaza + üyelikler) */
async function myStores(uid: string): Promise<StoreRow[]> {
  const { data: me } = await rawDb().from('app_users').select('store_id, role').eq('id', uid).single();
  const mem = must(await rawDb().from('store_members').select('store_id, role').eq('user_id', uid)) as Array<{ store_id: string; role: string }>;
  const roles = new Map<string, string>(mem.map((m) => [m.store_id, m.role]));
  if (me?.store_id) roles.set(me.store_id, me.role ?? 'owner');
  const ids = [...roles.keys()];
  if (!ids.length) return [];
  const stores = must(await rawDb().from('stores').select('id, name, is_demo, created_at').in('id', ids).order('created_at')) as Array<{ id: string; name: string; is_demo: boolean }>;
  // Her mağazanın rengi (seçilmemişse kimliğinden sabit bir renk)
  const themes = must(await rawDb().from('app_settings').select('store_id, value').eq('key', 'theme').in('store_id', ids)) as Array<{ store_id: string; value: { accent?: string } }>;
  return stores.map((s) => {
    const a = accentFor(s.id, themes.find((t) => t.store_id === s.id)?.value?.accent);
    return { id: s.id, name: s.name || 'Mağaza', role: roles.get(s.id) ?? 'staff', isDemo: !!s.is_demo, accent: a.base, accentKey: a.key };
  });
}

/** Bir mağazanın bu ayki özeti (ciro, net kâr, sipariş, stok) — kendi mağaza bağlamında hesaplanır */
async function summary(storeId: string) {
  return withStore(storeId, async () => {
    const month = `${istanbulDate().slice(0, 7)}-01T00:00:00+03:00`;
    const orders = must(await db().from('orders').select('marketplace_name, status, total_amount, cost:order_costs(net_profit)').gte('order_date', new Date(month).toISOString()).limit(20_000)) as unknown as Array<{ marketplace_name: string; status: string; total_amount: number; cost: { net_profit: number } | Array<{ net_profit: number }> | null }>;
    const valid = orders.filter((o) => o.status !== 'cancelled' && o.status !== 'returned');
    const revenue = valid.reduce((t, o) => t + Number(o.total_amount), 0);
    const profit = valid.reduce((t, o) => { const c = Array.isArray(o.cost) ? o.cost[0] : o.cost; return t + Number(c?.net_profit ?? 0); }, 0);
    const byMp: Record<string, { orders: number; revenue: number }> = {};
    for (const o of valid) { const x = (byMp[o.marketplace_name] ??= { orders: 0, revenue: 0 }); x.orders++; x.revenue += Number(o.total_amount); }
    const products = must(await db().from('products').select('total_stock, low_stock_threshold').limit(50_000)) as Array<{ total_stock: number; low_stock_threshold: number }>;
    const { data: creds } = await db().from('marketplace_credentials').select('marketplace_name, is_active, extra_config').eq('is_active', true);
    return {
      orders: valid.length, revenue: Math.round(revenue * 100) / 100, profit: Math.round(profit * 100) / 100, byMarketplace: byMp,
      products: products.length, stockUnits: products.reduce((t, p) => t + Math.max(0, p.total_stock), 0),
      outOfStock: products.filter((p) => p.total_stock <= 0).length, lowStock: products.filter((p) => p.total_stock > 0 && p.total_stock < p.low_stock_threshold).length,
      connected: (creds ?? []).map((c) => ({ marketplace: c.marketplace_name as string, accountName: String((c.extra_config as Record<string, unknown> | null)?.accountName ?? '') })),
    };
  }, currentUserId());
}

/** Mağazalarım: ?summary=1 ile her mağazanın bu ayki özeti ve toplam */
export const GET = handle(async (req: Request) => {
  const uid = currentUserId();
  const stores = await myStores(uid);
  const withSummary = new URL(req.url).searchParams.get('summary') === '1';
  if (!withSummary) return { current: currentStoreId(), stores };
  // Personel kâr göremez: yalnızca sahip/yönetici olduğu mağazaların özeti
  const rows = [];
  for (const s of stores) rows.push({ ...s, summary: s.role === 'staff' ? null : await summary(s.id) });
  const sums = rows.filter((r) => r.summary).map((r) => r.summary!);
  return {
    current: currentStoreId(), stores: rows,
    total: { orders: sums.reduce((t, x) => t + x.orders, 0), revenue: sums.reduce((t, x) => t + x.revenue, 0), profit: sums.reduce((t, x) => t + x.profit, 0), stockUnits: sums.reduce((t, x) => t + x.stockUnits, 0), products: sums.reduce((t, x) => t + x.products, 0) },
  };
});

/** action=create: yeni (ayrı) mağaza açar ve ona geçer · action=switch: başka mağazaya geçer */
export const POST = handle(async (req: Request) => {
  const b = await readJson<{ action?: string; name?: string; storeId?: string; accent?: string }>(req);
  const uid = currentUserId();
  const { data: me } = await rawDb().from('app_users').select('id, email, name, session_version').eq('id', uid).single();
  if (!me) throw new HttpError(401, 'Oturum gerekli.');
  let target = '';
  if (b.action === 'create') {
    const name = String(b.name ?? '').trim().slice(0, 120);
    if (!name) throw new HttpError(400, 'Mağaza adını girin.');
    if ((await myStores(uid)).length >= 10) throw new HttpError(400, 'En fazla 10 mağaza açılabilir.');
    const store = must(await rawDb().from('stores').insert({ name }).select('id').single()) as { id: string };
    must(await rawDb().from('store_members').insert({ user_id: uid, store_id: store.id, role: 'owner' }).select('user_id'));
    await rawDb().from('marketplace_credentials').insert(BASE_MARKETPLACES.map((m) => ({ store_id: store.id, marketplace_name: m })));
    await rawDb().from('app_settings').insert({ store_id: store.id, key: 'company', value: { name, email: me.email } });
    await audit('Yeni mağaza açıldı', name);
    target = store.id;
  } else if (b.action === 'switch') {
    target = String(b.storeId ?? '');
    if (!(await myStores(uid)).some((s) => s.id === target)) throw new HttpError(403, 'Bu mağazaya erişiminiz yok.');
  } else if (b.action === 'theme') {
    // Mağaza rengi: sahip veya yönetici değiştirir (geçiş yapmaz)
    const st = (await myStores(uid)).find((s) => s.id === b.storeId);
    if (!st || st.role === 'staff') throw new HttpError(403, 'Bu mağazanın rengini değiştirme yetkiniz yok.');
    if (!ACCENTS.some((a) => a.key === b.accent)) throw new HttpError(400, 'Geçersiz renk.');
    await withStore(st.id, async () => { must(await db().from('app_settings').upsert({ key: 'theme', value: { accent: b.accent }, updated_at: new Date().toISOString() }).select('key')); });
    return { ok: true };
  } else {
    throw new HttpError(400, 'Geçersiz işlem.');
  }
  return withSession(NextResponse.json({ ok: true, storeId: target }), { uid, sid: target, sv: me.session_version ?? 0, email: me.email, name: me.name });
});
