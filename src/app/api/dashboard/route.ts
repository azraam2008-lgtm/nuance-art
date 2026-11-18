import { handle, istanbulDate } from '@/lib/api';
import { db, must } from '@/lib/supabase/server';
import { MARKETPLACES, type MarketplaceName } from '@/lib/marketplaces/meta';

export const dynamic = 'force-dynamic';

type Row = { day: string; marketplace_name: MarketplaceName; revenue: number; order_count: number };
const r2 = (n: number) => Math.round(n * 100) / 100;
const zero = () => Object.fromEntries(MARKETPLACES.map((m) => [m, 0])) as Record<MarketplaceName, number>;

export const GET = handle(async () => {
  const today = istanbulDate();
  const [y, m] = today.split('-').map(Number);
  const monthKey = today.slice(0, 7);
  const from = new Date(Date.UTC(y, m - 1 - 11, 1)).toISOString().slice(0, 10);

  const rows = must(await db().from('v_daily_revenue').select('*').gte('day', from)) as Row[];
  const critical = must(await db().from('v_stock_breakdown').select('id, sku, title, total_stock, low_stock_threshold').eq('is_critical', true)) as unknown[];
  const recent = must(await db().from('orders')
    .select('id, external_order_id, marketplace_name, customer_name, total_amount, status, order_date, items:order_items(product_title, quantity)')
    .order('order_date', { ascending: false }).limit(8));

  // Bu ayki net kâr (kârlılık motoru)
  const monthStart = `${monthKey}-01T00:00:00+03:00`;
  let monthNetProfit = 0;
  let monthEstimates = 0;
  for (let offset = 0; offset < 50_000; offset += 1000) {
    const page = must(await db().from('order_costs').select('net_profit, status, order:orders!inner(order_date)').gte('order.order_date', monthStart).range(offset, offset + 999)) as Array<{ net_profit: number; status: string }>;
    for (const c of page) { monthNetProfit += Number(c.net_profit); if (c.status === 'estimate') monthEstimates++; }
    if (page.length < 1000) break;
  }

  // Bu ay
  const monthByMp = zero();
  let monthOrders = 0;
  for (const r of rows) {
    if (r.day.slice(0, 7) !== monthKey) continue;
    monthByMp[r.marketplace_name] += Number(r.revenue);
    monthOrders += r.order_count;
  }
  const monthRevenue = Object.values(monthByMp).reduce((a, b) => a + b, 0);
  const top = MARKETPLACES.reduce((a, b) => (monthByMp[a] >= monthByMp[b] ? a : b));

  // Aylık seri (son 12 ay)
  const monthly: Array<Record<string, number | string>> = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    const key = d.toISOString().slice(0, 7);
    const entry: Record<string, number | string> = { key, label: d.toLocaleDateString('tr-TR', { month: 'short', year: '2-digit', timeZone: 'UTC' }), ...zero() };
    for (const r of rows) if (r.day.slice(0, 7) === key) entry[r.marketplace_name] = Number(entry[r.marketplace_name]) + Number(r.revenue);
    for (const mp of MARKETPLACES) entry[mp] = r2(Number(entry[mp]));
    monthly.push(entry);
  }

  // Günlük seri (son 30 gün)
  const daily: Array<Record<string, number | string>> = [];
  const base = new Date(`${today}T00:00:00Z`);
  for (let i = 29; i >= 0; i--) {
    const d = new Date(base.getTime() - i * 86_400_000);
    const key = d.toISOString().slice(0, 10);
    const entry: Record<string, number | string> = { key, label: `${key.slice(8, 10)}.${key.slice(5, 7)}`, ...zero() };
    for (const r of rows) if (r.day === key) entry[r.marketplace_name] = Number(entry[r.marketplace_name]) + Number(r.revenue);
    for (const mp of MARKETPLACES) entry[mp] = r2(Number(entry[mp]));
    daily.push(entry);
  }

  // Sağlık: senkron sorunları, onay bekleyen ilanlar, tükenen ürünler
  const ls = must(await db().from('marketplace_listings').select('listing_status, last_pushed_stock, sync_error_message, product:products!inner(total_stock)').neq('listing_status', 'passive')) as unknown as
    Array<{ listing_status: string; last_pushed_stock: number | null; sync_error_message: string | null; product: { total_stock: number } }>;
  const prodCount = must(await db().from('products').select('id, total_stock')) as Array<{ id: string; total_stock: number }>;
  const health = {
    products: prodCount.length,
    outOfStock: prodCount.filter((p) => p.total_stock <= 0).length,
    pending: ls.filter((l) => l.listing_status === 'pending').length,
    errors: ls.filter((l) => l.listing_status === 'error').length,
    unsynced: ls.filter((l) => l.listing_status === 'active' && l.last_pushed_stock !== null && l.last_pushed_stock !== Math.max(0, l.product.total_stock)).length,
  };
  return {
    health,
    kpis: {
      monthRevenue: r2(monthRevenue),
      monthOrders,
      topMarketplace: monthRevenue > 0 ? top : null,
      topMarketplaceRevenue: r2(monthByMp[top]),
      criticalCount: critical.length,
      monthNetProfit: r2(monthNetProfit),
      monthEstimates,
    },
    distribution: MARKETPLACES.map((mp) => ({ marketplace: mp, revenue: r2(monthByMp[mp]), share: monthRevenue ? monthByMp[mp] / monthRevenue : 0 })),
    monthly,
    daily,
    critical,
    recent,
  };
});
