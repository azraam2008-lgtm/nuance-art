import { handle } from '@/lib/api';
import { db, must } from '@/lib/supabase/server';
import { withProductImages } from '@/lib/orders/images';
import { ORDER_STATUSES, OPEN_STATUSES } from '@/lib/marketplaces/meta';
import { getInvoicingSettings } from '@/lib/invoicing/service';

export const dynamic = 'force-dynamic';

const count = async (q: PromiseLike<{ count: number | null }>) => { try { return (await q).count ?? 0; } catch { return 0; } };

/**
 * Ana sayfa: Trendyol satıcı paneline benzer "yapılacaklar" görünümü.
 * Ciro ve kâr burada yok (Kârlılık sayfasında); siparişler ve kritik stok öne çıkar.
 */
export const GET = handle(async () => {
  const now = new Date();
  // Türkiye saatine göre bugünün sonu
  const endOfToday = new Date(`${new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(now)}T23:59:59+03:00`).toISOString();
  const since30 = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const open = [...OPEN_STATUSES];

  const nowIso = now.toISOString();
  const head = () => db().from('orders').select('id', { count: 'exact', head: true });
  const withCost = () => db().from('orders').select('id, order_costs!inner(deadline)', { count: 'exact', head: true }).in('status', open).is('shipped_at', null);

  // Fatura kesmeyi panelden yapıyorsa: faturası olmayan siparişler (ayar yoksa gösterilmez)
  const invoiceMissingP = getInvoicingSettings().then((inv) => (inv.provider && inv.provider !== 'none'
    ? count(head().in('status', ['approved', 'preparing', 'shipped', 'delivered']).is('invoice_number', null).gte('order_date', since30))
    : null)).catch(() => null);

  // Ürün performansı: son 30 günde en çok satanlar (adet)
  const topP = (async () => {
    const sold = must(await db().from('order_items')
      .select('product_id, quantity, unit_price, order:orders!inner(order_date, status)')
      .gte('order.order_date', since30).not('order.status', 'in', '(cancelled,returned)').not('product_id', 'is', null).limit(5000)) as unknown as
      Array<{ product_id: string; quantity: number; unit_price: number }>;
    const agg = new Map<string, { units: number; revenue: number }>();
    for (const r of sold) {
      const a = agg.get(r.product_id) ?? { units: 0, revenue: 0 };
      a.units += r.quantity; a.revenue += r.quantity * Number(r.unit_price);
      agg.set(r.product_id, a);
    }
    const topIds = [...agg.entries()].sort((a, b) => b[1].units - a[1].units).slice(0, 6).map(([id]) => id);
    const rows = topIds.length ? must(await db().from('products').select('id, sku, title, image_url, total_stock').in('id', topIds)) as Array<{ id: string; sku: string; title: string; image_url: string | null; total_stock: number }> : [];
    return topIds.map((id) => { const p = rows.find((x) => x.id === id); return p ? { ...p, ...agg.get(id)! } : null; }).filter(Boolean);
  })();

  // Hepsi aynı anda çalışır: sayfa en yavaş sorgu kadar bekler, toplamı kadar değil
  const [statusPairs, late, dueToday, returns30, invoiceMissing, criticalRes, recentRes, top, ls, products, outOfStock, jobsFailed] = await Promise.all([
    Promise.all(ORDER_STATUSES.map(async (st) => [st, await count(head().eq('status', st))] as const)),
    count(withCost().lt('order_costs.deadline', nowIso)),
    count(withCost().gte('order_costs.deadline', nowIso).lte('order_costs.deadline', endOfToday)),
    count(head().eq('status', 'returned').gte('order_date', since30)),
    invoiceMissingP,
    db().from('v_stock_breakdown').select('id, sku, title, image_url, total_stock, low_stock_threshold', { count: 'exact' }).eq('is_critical', true).order('total_stock').limit(8),
    db().from('orders')
      .select('id, external_order_id, marketplace_name, customer_name, total_amount, status, order_date, cost:order_costs(deadline), items:order_items(id, sku, product_title, quantity, product:products(id, image_url, barcode, variant_attrs))')
      .order('order_date', { ascending: false }).limit(8),
    topP,
    db().from('marketplace_listings').select('listing_status, last_pushed_stock, product:products!inner(total_stock, safety_stock)').neq('listing_status', 'passive'),
    count(db().from('products').select('id', { count: 'exact', head: true })),
    count(db().from('products').select('id', { count: 'exact', head: true }).lte('total_stock', 0)),
    // İş kuyruğu (tablo henüz kurulmadıysa 0)
    count(db().from('sync_jobs').select('id', { count: 'exact', head: true }).eq('status', 'failed')),
  ]);
  const statusCounts = Object.fromEntries(statusPairs);
  const critical = must(criticalRes) as unknown[];
  const criticalCount = criticalRes.count ?? critical.length;
  const recent = await withProductImages(must(recentRes) as unknown as Array<{ id: string }>);
  const listings = must(ls) as unknown as Array<{ listing_status: string; last_pushed_stock: number | null; product: { total_stock: number; safety_stock: number | null } }>;
  const health = {
    products,
    outOfStock,
    pending: listings.filter((l) => l.listing_status === 'pending').length,
    errors: listings.filter((l) => l.listing_status === 'error').length,
    unsynced: listings.filter((l) => l.listing_status === 'active' && l.last_pushed_stock !== null && l.last_pushed_stock !== Math.max(0, l.product.total_stock - (l.product.safety_stock ?? 0))).length,
    jobsFailed,
  };

  return {
    actions: { statusCounts, late, dueToday, returns30, invoiceMissing, criticalCount },
    health,
    critical,
    recent,
    top,
  };
});
