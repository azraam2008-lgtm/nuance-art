import { handle, istanbulDate } from '@/lib/api';
import { db, must } from '@/lib/supabase/server';
import { isMarketplace, MARKETPLACES } from '@/lib/marketplaces/meta';

export const dynamic = 'force-dynamic';

interface Row {
  id: string; external_order_id: string; marketplace_name: string; status: string; order_date: string; customer_name: string;
  items: Array<{ sku: string; product_title: string; quantity: number; unit_price: number }>;
  cost: {
    status: string; revenue_gross: number; revenue_net: number; commission: number; fees: number; shipping: number; tax: number; product_cost: number; other: number;
    total_cost: number; net_profit: number; same_day_eligible: boolean | null; same_day_met: boolean | null; fast_eligible: boolean | null; fast_met: boolean | null; lines: Array<{ code: string; cost: number }>;
  } | null;
}

const KEYS = ['revenue_gross', 'revenue_net', 'commission', 'fees', 'shipping', 'tax', 'product_cost', 'other', 'net_profit'] as const;
type Agg = Record<(typeof KEYS)[number], number> & { orders: number; cancelled: number; estimates: number };
const empty = (): Agg => ({ revenue_gross: 0, revenue_net: 0, commission: 0, fees: 0, shipping: 0, tax: 0, product_cost: 0, other: 0, net_profit: 0, orders: 0, cancelled: 0, estimates: 0 });

/**
 * Kârlılık raporu: pazaryeri kırılımı, ürün kırılımı, zarar eden siparişler,
 * kaçırılan "Bugün Kargoda / hızlı gönderim" avantajları.
 */
export const GET = handle(async (req: Request) => {
  const sp = new URL(req.url).searchParams;
  const today = istanbulDate();
  const from = sp.get('from') ?? `${today.slice(0, 7)}-01`;
  const to = sp.get('to') ?? today;
  const mp = sp.get('marketplace');

  const rows: Row[] = [];
  for (let offset = 0; offset < 50_000; offset += 1000) {
    let q = db().from('orders')
      .select('id, external_order_id, marketplace_name, status, order_date, customer_name, items:order_items(sku, product_title, quantity, unit_price), cost:order_costs(status, revenue_gross, revenue_net, commission, fees, shipping, tax, product_cost, other, total_cost, net_profit, same_day_eligible, same_day_met, fast_eligible, fast_met, lines)')
      .gte('order_date', `${from}T00:00:00+03:00`).lte('order_date', `${to}T23:59:59+03:00`)
      .order('order_date', { ascending: false }).range(offset, offset + 999);
    if (isMarketplace(mp)) q = q.eq('marketplace_name', mp);
    const page = must(await q) as unknown as Row[];
    rows.push(...page);
    if (page.length < 1000) break;
  }

  const total = empty();
  const byMp: Record<string, Agg> = Object.fromEntries(MARKETPLACES.map((m) => [m, empty()]));
  const byProduct = new Map<string, { sku: string; title: string; units: number; revenue_net: number; net_profit: number; orders: number }>();
  const losses: Array<{ id: string; external_order_id: string; marketplace: string; date: string; net_profit: number; revenue_gross: number; reason: string }> = [];
  const missed = { sameDay: 0, fast: 0, extraCost: 0, orders: [] as Array<{ id: string; external_order_id: string; marketplace: string; date: string; kind: string }> };
  let uncomputed = 0;

  for (const r of rows) {
    const c = Array.isArray(r.cost) ? (r.cost as unknown as Row['cost'][])[0] : r.cost;
    if (!c) { uncomputed++; continue; }
    const a = byMp[r.marketplace_name] ?? (byMp[r.marketplace_name] = empty());
    for (const agg of [a, total]) {
      for (const k of KEYS) agg[k] += Number(c[k] ?? 0);
      agg.orders += 1;
      if (r.status === 'cancelled') agg.cancelled += 1;
      if (c.status === 'estimate') agg.estimates += 1;
    }
    if (r.status !== 'cancelled') {
      const lineTotal = r.items.reduce((s, i) => s + i.quantity * Number(i.unit_price), 0) || 1;
      for (const i of r.items) {
        const share = (i.quantity * Number(i.unit_price)) / lineTotal;
        const p = byProduct.get(i.sku) ?? { sku: i.sku, title: i.product_title, units: 0, revenue_net: 0, net_profit: 0, orders: 0 };
        p.units += i.quantity; p.revenue_net += Number(c.revenue_net) * share; p.net_profit += Number(c.net_profit) * share; p.orders += 1;
        byProduct.set(i.sku, p);
      }
    }
    if (Number(c.net_profit) < 0) {
      const biggest = [...(c.lines ?? [])].filter((l) => l.code !== 'product_cost').sort((x, y) => y.cost - x.cost)[0];
      losses.push({ id: r.id, external_order_id: r.external_order_id, marketplace: r.marketplace_name, date: r.order_date, net_profit: Number(c.net_profit), revenue_gross: Number(c.revenue_gross),
        reason: r.status === 'cancelled' ? 'İade/iptal kargo maliyeti' : biggest ? `En büyük kesinti: ${biggest.code}` : '' });
    }
    if (r.status !== 'cancelled' && ((c.same_day_eligible && c.same_day_met === false) || (c.fast_eligible && c.fast_met === false))) {
      const sd = !!(c.same_day_eligible && c.same_day_met === false);
      if (sd) missed.sameDay++; else missed.fast++;
      missed.orders.push({ id: r.id, external_order_id: r.external_order_id, marketplace: r.marketplace_name, date: r.order_date, kind: sd ? 'Bugün Kargoda kaçırıldı' : 'Termin aşıldı' });
      // Trendyol: hizmet bedeli farkı (10,99 − 4,99) KDV hariç
      if (sd && r.marketplace_name === 'trendyol') missed.extraCost += 6;
    }
  }

  // Reklam harcamaları (KDV dahil girilir; kâr hesabında KDV hariç tutar düşülür)
  let adQ = db().from('ad_spend').select('marketplace_name, amount').gte('spend_date', from).lte('spend_date', to);
  if (isMarketplace(mp)) adQ = adQ.eq('marketplace_name', mp);
  const adRows = (await adQ).data as Array<{ marketplace_name: string; amount: number }> | null ?? [];
  const adsByMp: Record<string, number> = {};
  for (const r of adRows) adsByMp[r.marketplace_name] = (adsByMp[r.marketplace_name] ?? 0) + Number(r.amount) / 1.2;
  const adsTotal = Object.values(adsByMp).reduce((s, v) => s + v, 0);

  const round = (a: Agg) => Object.fromEntries(Object.entries(a).map(([k, v]) => [k, Math.round(v * 100) / 100]));
  return {
    range: { from, to },
    total: round(total),
    byMarketplace: Object.fromEntries(Object.entries(byMp).filter(([, v]) => v.orders > 0).map(([k, v]) => [k, round(v)])),
    products: [...byProduct.values()].map((p) => ({ ...p, revenue_net: Math.round(p.revenue_net * 100) / 100, net_profit: Math.round(p.net_profit * 100) / 100 }))
      .sort((a, b) => b.net_profit - a.net_profit),
    losses: losses.sort((a, b) => a.net_profit - b.net_profit).slice(0, 50),
    missed: { ...missed, orders: missed.orders.slice(0, 50) },
    uncomputed,
    ads: {
      totalNet: Math.round(adsTotal * 100) / 100,
      byMarketplace: Object.fromEntries(Object.entries(adsByMp).map(([k, v]) => [k, Math.round(v * 100) / 100])),
      profitAfterAds: Math.round((total.net_profit - adsTotal) * 100) / 100,
    },
  };
});
