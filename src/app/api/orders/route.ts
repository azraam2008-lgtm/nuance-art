import { handle } from '@/lib/api';
import { db, must } from '@/lib/supabase/server';
import { withProductImages } from '@/lib/orders/images';
import { isMarketplace, isOrderStatus, OPEN_STATUSES, ORDER_TABS, type OrderStatus } from '@/lib/marketplaces/meta';

export const dynamic = 'force-dynamic';

const clean = (v: string | null) => (v ?? '').replace(/[,()%*\\]/g, ' ').trim();
const SORTS = {
  date_desc: { col: 'order_date', asc: false },
  date_asc: { col: 'order_date', asc: true },
  deadline_asc: { col: 'cost(deadline)', asc: true },
  deadline_desc: { col: 'cost(deadline)', asc: false },
  amount_desc: { col: 'total_amount', asc: false },
  amount_asc: { col: 'total_amount', asc: true },
} as const;
type SortKey = keyof typeof SORTS;

/** order_items üzerinden eşleşen sipariş kimlikleri (ürün adı/model kodu, barkod) */
async function orderIdsByItems(opts: { product?: string; barcode?: string }): Promise<string[]> {
  const ids = new Set<string>();
  if (opts.product) {
    const rows = must(await db().from('order_items').select('order_id').or(`product_title.ilike.%${opts.product}%,sku.ilike.%${opts.product}%`).limit(300)) as Array<{ order_id: string }>;
    rows.forEach((r) => ids.add(r.order_id));
  }
  if (opts.barcode) {
    const prods = must(await db().from('products').select('id').ilike('barcode', `%${opts.barcode}%`).limit(100)) as Array<{ id: string }>;
    if (prods.length) {
      const rows = must(await db().from('order_items').select('order_id').in('product_id', prods.map((p) => p.id)).limit(300)) as Array<{ order_id: string }>;
      const hit = new Set(rows.map((r) => r.order_id));
      if (opts.product) { for (const id of [...ids]) if (!hit.has(id)) ids.delete(id); } else hit.forEach((id) => ids.add(id));
    } else return [];
  }
  return [...ids];
}

// Tüm pazaryerlerinin siparişleri tek tabloda: sekme (durum grubu) + ayrıntılı filtre + sıralama + sayfalama
export const GET = handle(async (req: Request) => {
  const sp = new URL(req.url).searchParams;
  // Bir veya birden çok mağaza: ?marketplace=trendyol,trendyol_2
  const marketplaces = (sp.get('marketplace') ?? '').split(',').filter(isMarketplace);
  // Mağaza düğmelerindeki sayılar için (seçili sekmeye göre)
  const countFor = (sp.get('mps') ?? '').split(',').filter(isMarketplace).slice(0, 20);
  const status = sp.get('status');
  const tab = ORDER_TABS.find((t) => t.key === sp.get('tab'));
  const q = clean(sp.get('q'));
  const customer = clean(sp.get('customer'));
  const orderNo = clean(sp.get('orderNo'));
  const tracking = clean(sp.get('tracking'));
  const barcode = clean(sp.get('barcode'));
  const product = clean(sp.get('product'));
  const from = sp.get('from') ?? '';
  const to = sp.get('to') ?? '';
  // Tedarik (kargoya teslim) süresi: late = geçti, today = bugün doluyor, ok = süresi var
  const deadline = sp.get('deadline') ?? (sp.get('late') === '1' ? 'late' : '');
  const invoiceMissing = sp.get('invoice') === 'missing';
  const sort: SortKey = (sp.get('sort') as SortKey) in SORTS ? (sp.get('sort') as SortKey) : 'date_desc';
  const page = Math.max(0, Number(sp.get('page') ?? 0));
  const pageSize = Math.min(200, Math.max(1, Number(sp.get('pageSize') ?? 50)));

  const now = new Date();
  const nowIso = now.toISOString();
  const endOfToday = new Date(`${new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(now)}T23:59:59+03:00`).toISOString();
  // Sayılar ana sorguyla aynı anda çalışır (sayfa daha hızlı açılır)
  const countsP = tabCounts(marketplaces);
  const mpCountsP = marketplaceCounts(countFor, tab?.statuses ?? []);
  const lateP = Promise.resolve(db().from('orders').select('id, order_costs!inner(deadline)', { count: 'exact', head: true })
    .in('status', OPEN_STATUSES).is('shipped_at', null).lt('order_costs.deadline', nowIso)).then((r) => r.count ?? 0);
  const itemIds = product || barcode ? await orderIdsByItems({ product, barcode }) : null;
  if (itemIds && !itemIds.length) return { orders: [], total: 0, page, pageSize, lateCount: await lateP, tabCounts: await countsP, marketplaceCounts: await mpCountsP };

  const needCost = !!deadline || sort.startsWith('deadline');
  // Fatura tablosu henüz kurulmadıysa (schema.sql 9h çalıştırılmadı) siparişler yine de listelenir
  const build = async (inv: boolean, sortCol: string) => {
    let query = db()
      .from('orders')
      .select(`id, external_order_id, marketplace_name, customer_name, total_amount, status, order_date, shipped_at, carrier, tracking_number, invoice_number, return_reason, t1:raw->>cargoTrackingNumber, t2:raw->>trackingNumber, t3:raw->>cargoCode, t4:raw->>trackingInfoCode, c1:raw->>cargoProviderName,
        items:order_items(id, sku, product_title, quantity, unit_price, product:products(id, image_url, barcode, variant_attrs)),
        cost:order_costs${deadline ? '!inner' : ''}(net_profit, status, margin_on_revenue, same_day_eligible, same_day_met, fast_eligible, fast_met, deadline)${inv ? ', invoice:invoices(status, invoice_number, last_error)' : ''}`, { count: 'exact' })
      .order(sortCol, { ascending: SORTS[sort].asc, nullsFirst: false })
      .range(page * pageSize, page * pageSize + pageSize - 1);
    if (sortCol !== 'order_date') query = query.order('order_date', { ascending: false });

    if (marketplaces.length) query = query.in('marketplace_name', marketplaces);
    if (isOrderStatus(status)) query = query.eq('status', status);
    else if (tab && tab.statuses.length) query = query.in('status', [...tab.statuses]);
    // Kalan süreye göre sıralarken yalnızca kargoya verilmeyi bekleyenler (teslim edilen/iade listeyi kalabalıklaştırmasın)
    if (sort.startsWith('deadline')) query = query.in('status', OPEN_STATUSES).is('shipped_at', null);
    if (deadline === 'late') query = query.in('status', OPEN_STATUSES).is('shipped_at', null).lt('cost.deadline', nowIso);
    if (deadline === 'today') query = query.in('status', OPEN_STATUSES).is('shipped_at', null).gte('cost.deadline', nowIso).lte('cost.deadline', endOfToday);
    if (deadline === 'ok') query = query.in('status', OPEN_STATUSES).is('shipped_at', null).gt('cost.deadline', endOfToday);
    if (invoiceMissing) query = query.in('status', ['approved', 'preparing', 'shipped', 'delivered']).is('invoice_number', null);
    if (customer) query = query.ilike('customer_name', `%${customer}%`);
    if (orderNo) query = query.ilike('external_order_id', `%${orderNo}%`);
    if (tracking) query = query.ilike('tracking_number', `%${tracking}%`);
    if (/^\d{4}-\d{2}-\d{2}$/.test(from)) query = query.gte('order_date', `${from}T00:00:00+03:00`);
    if (/^\d{4}-\d{2}-\d{2}$/.test(to)) query = query.lte('order_date', `${to}T23:59:59+03:00`);
    if (itemIds) query = query.in('id', itemIds);
    if (q) {
      const items = must(await db().from('order_items').select('order_id').ilike('product_title', `%${q}%`).limit(300)) as Array<{ order_id: string }>;
      const ids = [...new Set(items.map((i) => i.order_id))];
      const conds = [`external_order_id.ilike.%${q}%`, `customer_name.ilike.%${q}%`, `tracking_number.ilike.%${q}%`];
      if (ids.length) conds.push(`id.in.(${ids.join(',')})`);
      query = query.or(conds.join(','));
    }
    return query;
  };
  const sortCol = SORTS[sort].col;
  let res = await build(true, sortCol);
  if (res.error && /invoices/i.test(res.error.message)) res = await build(false, sortCol);
  // Termine göre sıralama desteklenmezse tarihe göre sırala (sonuç yine de gelsin)
  if (res.error && needCost && /order|cost/i.test(res.error.message)) res = await build(false, 'order_date');
  const { data, error, count } = res;
  if (error) throw new Error(error.message);

  // Pazaryerinin ham verisi tarayıcıya gönderilmez (yavaşlatır); yalnızca kargo takip no ve firma alanları seçilir
  type Row = Record<string, unknown> & { external_order_id: string; tracking_number: string | null; carrier: string | null; t1?: string | null; t2?: string | null; t3?: string | null; t4?: string | null; c1?: string | null };
  const orders = ((data ?? []) as unknown as Row[]).map(({ t1, t2, t3, t4, c1, ...o }) => {
    const [orderNumber, packageNo] = o.external_order_id.split('/');
    return { ...o, order_number: orderNumber, package_no: packageNo ?? null, delivery_no: t1 || t2 || t3 || t4 || o.tracking_number || null, carrier: o.carrier || c1 || null };
  });
  await withProductImages(orders as unknown as Array<{ id: string }>);
  return { orders, total: count ?? 0, page, pageSize, lateCount: await lateP, tabCounts: await countsP, marketplaceCounts: await mpCountsP };
});

/** Sekmelerdeki sayılar (pazaryeri/mağaza filtresi uygulanır) */
async function tabCounts(marketplaces: string[]): Promise<Record<string, number>> {
  const one = async (statuses: readonly OrderStatus[]) => {
    let q = db().from('orders').select('id', { count: 'exact', head: true });
    if (marketplaces.length) q = q.in('marketplace_name', marketplaces);
    if (statuses.length) q = q.in('status', [...statuses]);
    return (await q).count ?? 0;
  };
  return Object.fromEntries(await Promise.all(ORDER_TABS.map(async (t) => [t.key, await one(t.statuses)] as const)));
}

/** Her mağazanın seçili sekmedeki sipariş sayısı */
async function marketplaceCounts(list: string[], statuses: readonly OrderStatus[]): Promise<Record<string, number>> {
  return Object.fromEntries(await Promise.all(list.map(async (m) => {
    let q = db().from('orders').select('id', { count: 'exact', head: true }).eq('marketplace_name', m);
    if (statuses.length) q = q.in('status', [...statuses]);
    return [m, (await q).count ?? 0] as const;
  })));
}
