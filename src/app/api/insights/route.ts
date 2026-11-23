import { handle } from '@/lib/api';
import { db, must } from '@/lib/supabase/server';
import { MARKETPLACE_META, isMarketplace } from '@/lib/marketplaces/meta';
import { marketplaceAndCustomers, productEconomics, salesTrend, stockForecast, type OrderIn, type ProductIn, type SaleIn } from '@/lib/insights/analyze';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Öneriler: stok tükenme tahmini, satış trendi, kârsız ürünler, iade analizi, pazaryeri karşılaştırması (son 30/60/90 gün) */
export const GET = handle(async () => {
  const now = Date.now();
  const products = must(await db().from('products').select('id, sku, title, total_stock, low_stock_threshold, safety_stock, variant_attrs')) as ProductIn[];

  // Satışlar stok hareketlerinden (iptal/iade iadeleri düşülür)
  const since60 = new Date(now - 60 * 86_400_000).toISOString();
  const moves: Array<{ product_id: string; change_amount: number; reason: string; created_at: string }> = [];
  for (let off = 0; off < 50_000; off += 1000) {
    const page = must(await db().from('stock_movements').select('product_id, change_amount, reason, created_at')
      .in('reason', ['sale', 'cancel_restore']).gte('created_at', since60).order('created_at').range(off, off + 999)) as typeof moves;
    moves.push(...page);
    if (page.length < 1000) break;
  }
  const sales: SaleIn[] = moves.map((m) => ({ product_id: m.product_id, qty: -m.change_amount, date: m.created_at }));

  // Son 90 günün siparişleri + kâr
  const since90 = new Date(now - 90 * 86_400_000).toISOString();
  const raw: Array<{ id: string; marketplace_name: string; status: string; order_date: string; customer_name: string; return_reason: string | null;
    items: Array<{ product_id: string | null; sku: string; product_title: string; quantity: number; unit_price: number }>;
    cost: { net_profit: number; revenue_net: number } | Array<{ net_profit: number; revenue_net: number }> | null }> = [];
  for (let off = 0; off < 20_000; off += 1000) {
    const page = must(await db().from('orders').select('id, marketplace_name, status, order_date, customer_name, return_reason, items:order_items(product_id, sku, product_title, quantity, unit_price), cost:order_costs(net_profit, revenue_net)')
      .gte('order_date', since90).order('order_date').range(off, off + 999)) as typeof raw;
    raw.push(...page);
    if (page.length < 1000) break;
  }
  const orders: OrderIn[] = raw.map((o) => {
    const c = Array.isArray(o.cost) ? o.cost[0] : o.cost;
    const total = o.items.reduce((s, i) => s + i.quantity * Number(i.unit_price), 0) || 1;
    return {
      id: o.id, marketplace: o.marketplace_name, status: o.status, date: o.order_date, customer: o.customer_name, return_reason: o.return_reason,
      net_profit: c?.net_profit ?? null, revenue_net: c?.revenue_net ?? null,
      items: o.items.map((i) => ({ product_id: i.product_id, sku: i.sku, title: i.product_title, quantity: i.quantity, share: (i.quantity * Number(i.unit_price)) / total })),
    };
  });

  const forecast = stockForecast(products, sales, now);
  const trend = salesTrend(products, sales, now);
  const economics = productEconomics(orders);
  const comparison = marketplaceAndCustomers(orders);

  // Öncelikli aksiyonlar (en fazla 6)
  const actions: Array<{ level: 'high' | 'medium' | 'info'; text: string; href: string }> = [];
  const soon = forecast.filter((f) => (f.daysLeft ?? 99) <= 7);
  if (soon.length) actions.push({ level: 'high', text: `${soon.length} ürünün stoğu 7 gün içinde bitecek: ${soon.slice(0, 3).map((f) => f.sku).join(', ')}${soon.length > 3 ? '…' : ''}. Üretim / tedarik planlayın.`, href: '#stok' });
  if (economics.losing.length) actions.push({ level: 'high', text: `${economics.losing.length} ürün son 90 günde zarar ettirdi (en kötüsü ${economics.losing[0].sku}: ${economics.losing[0].netProfit.toLocaleString('tr-TR')} ₺). Fiyatı veya kargo ayarını gözden geçirin.`, href: '#kar' });
  if (economics.highReturn.length) actions.push({ level: 'medium', text: `${economics.highReturn[0].sku} ürününde iade oranı %${Math.round(economics.highReturn[0].returnRate * 100)}. Açıklama ve fotoğrafları kontrol edin.`, href: '#iade' });
  const worstMp = comparison.marketplaces.filter((m) => m.orders >= 5 && m.netProfit < 0)[0];
  if (worstMp) actions.push({ level: 'medium', text: `${isMarketplace(worstMp.marketplace) ? MARKETPLACE_META[worstMp.marketplace].label : worstMp.marketplace} siparişlerinde toplamda zarar ediliyor. Fiyatları o pazaryerine özel artırmayı düşünün.`, href: '#pazaryeri' });
  if (trend.stale.length) actions.push({ level: 'info', text: `${trend.stale.length} ürün 60 gündür hiç satmadı. İndirim, reklam veya fotoğraf yenileme deneyin.`, href: '#trend' });
  if (trend.totalPrevious && trend.totalChange < -0.2) actions.push({ level: 'medium', text: `Satışlar önceki 30 güne göre %${Math.round(-trend.totalChange * 100)} düştü.`, href: '#trend' });

  return { actions, forecast, trend, economics, comparison, generatedAt: new Date().toISOString() };
});
