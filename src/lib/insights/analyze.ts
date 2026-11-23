// İşletme önerileri: tamamen veriye dayalı, deterministik hesaplar (yapay zekâ maliyeti yok).
// Saf fonksiyonlar — veritabanından bağımsız test edilebilir.

export interface ProductIn { id: string; sku: string; title: string; total_stock: number; low_stock_threshold: number; safety_stock?: number; variant_attrs?: Record<string, string> | null }
export interface SaleIn { product_id: string; qty: number; date: string }            // satış (iptal/iade düşülmüş)
export interface OrderIn { id: string; marketplace: string; status: string; date: string; customer: string; net_profit: number | null; revenue_net: number | null;
  items: Array<{ product_id: string | null; sku: string; title: string; quantity: number; share: number }>; return_reason: string | null }

const DAY = 86_400_000;

/** Stok tükenme tahmini: son 30 günün günlük satış hızına göre kaç gün yeter */
export function stockForecast(products: ProductIn[], sales: SaleIn[], now = Date.now()) {
  const since = now - 30 * DAY;
  const sold = new Map<string, number>();
  for (const s of sales) if (Date.parse(s.date) >= since) sold.set(s.product_id, (sold.get(s.product_id) ?? 0) + s.qty);
  return products.map((p) => {
    const perDay = (sold.get(p.id) ?? 0) / 30;
    const daysLeft = perDay > 0 ? Math.max(0, p.total_stock) / perDay : null;
    // 14 gün yetecek kadar stok önerisi (eldeki stok düşülerek)
    const suggest = perDay > 0 ? Math.max(0, Math.ceil(perDay * 21 - p.total_stock)) : 0;
    return { id: p.id, sku: p.sku, title: p.title, variant: p.variant_attrs ?? null, stock: p.total_stock, perDay: Math.round(perDay * 100) / 100,
      daysLeft: daysLeft === null ? null : Math.round(daysLeft * 10) / 10, suggest };
  }).filter((x) => x.perDay > 0 && x.daysLeft !== null && x.daysLeft <= 21)
    .sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0));
}

/** Satış trendi: son 30 gün ile önceki 30 gün (adet) */
export function salesTrend(products: ProductIn[], sales: SaleIn[], now = Date.now()) {
  const cur = new Map<string, number>(), prev = new Map<string, number>();
  for (const s of sales) {
    const t = Date.parse(s.date);
    if (t >= now - 30 * DAY) cur.set(s.product_id, (cur.get(s.product_id) ?? 0) + s.qty);
    else if (t >= now - 60 * DAY) prev.set(s.product_id, (prev.get(s.product_id) ?? 0) + s.qty);
  }
  const rows = products.map((p) => {
    const c = cur.get(p.id) ?? 0, q = prev.get(p.id) ?? 0;
    return { id: p.id, sku: p.sku, title: p.title, variant: p.variant_attrs ?? null, current: c, previous: q, change: q ? (c - q) / q : c ? 1 : 0 };
  }).filter((r) => r.current + r.previous >= 3);
  const totalCur = [...cur.values()].reduce((a, b) => a + b, 0), totalPrev = [...prev.values()].reduce((a, b) => a + b, 0);
  return {
    totalCurrent: totalCur, totalPrevious: totalPrev, totalChange: totalPrev ? (totalCur - totalPrev) / totalPrev : 0,
    rising: rows.filter((r) => r.change > 0.15).sort((a, b) => b.current - b.previous - (a.current - a.previous)).slice(0, 8),
    falling: rows.filter((r) => r.change < -0.15).sort((a, b) => a.current - a.previous - (b.current - b.previous)).slice(0, 8),
    stale: products.filter((p) => p.total_stock > 0 && !cur.get(p.id) && !prev.get(p.id)).map((p) => ({ id: p.id, sku: p.sku, title: p.title, variant: p.variant_attrs ?? null, stock: p.total_stock })).slice(0, 12),
  };
}

/** Ürün bazında kâr ve iade analizi (siparişlerin kesin/tahmini net kârı, kalem payına göre bölünür) */
export function productEconomics(orders: OrderIn[]) {
  const m = new Map<string, { id: string | null; sku: string; title: string; units: number; orders: number; returns: number; netProfit: number; revenue: number; reasons: Record<string, number> }>();
  const reasons: Record<string, number> = {};
  for (const o of orders) {
    const closed = o.status === 'cancelled' || o.status === 'returned';
    if (o.status === 'returned') reasons[o.return_reason || 'Belirtilmedi'] = (reasons[o.return_reason || 'Belirtilmedi'] ?? 0) + 1;
    for (const i of o.items) {
      const r = m.get(i.sku) ?? { id: i.product_id, sku: i.sku, title: i.title, units: 0, orders: 0, returns: 0, netProfit: 0, revenue: 0, reasons: {} };
      r.orders += 1;
      if (!closed) r.units += i.quantity;
      if (o.status === 'returned') { r.returns += 1; const k = o.return_reason || 'Belirtilmedi'; r.reasons[k] = (r.reasons[k] ?? 0) + 1; }
      r.netProfit += Number(o.net_profit ?? 0) * i.share;
      r.revenue += Number(o.revenue_net ?? 0) * i.share;
      m.set(i.sku, r);
    }
  }
  const rows = [...m.values()].map((r) => ({ ...r, netProfit: Math.round(r.netProfit * 100) / 100, revenue: Math.round(r.revenue * 100) / 100,
    margin: r.revenue ? r.netProfit / r.revenue : 0, returnRate: r.orders ? r.returns / r.orders : 0 }));
  return {
    losing: rows.filter((r) => r.netProfit < 0 && r.orders >= 1).sort((a, b) => a.netProfit - b.netProfit).slice(0, 10),
    thin: rows.filter((r) => r.netProfit >= 0 && r.revenue > 0 && r.margin < 0.08 && r.orders >= 2).sort((a, b) => a.margin - b.margin).slice(0, 10),
    best: rows.filter((r) => r.netProfit > 0).sort((a, b) => b.netProfit - a.netProfit).slice(0, 10),
    highReturn: rows.filter((r) => r.orders >= 3 && r.returnRate >= 0.1).sort((a, b) => b.returnRate - a.returnRate).slice(0, 10),
    reasons: Object.entries(reasons).sort((a, b) => b[1] - a[1]).map(([reason, count]) => ({ reason, count })),
    returnRate: orders.length ? orders.filter((o) => o.status === 'returned').length / orders.length : 0,
  };
}

/** Pazaryeri karşılaştırması ve müşteri tekrar oranı */
export function marketplaceAndCustomers(orders: OrderIn[]) {
  const mp = new Map<string, { marketplace: string; orders: number; netProfit: number; revenue: number; returns: number }>();
  const byCustomer = new Map<string, number>();
  for (const o of orders) {
    const r = mp.get(o.marketplace) ?? { marketplace: o.marketplace, orders: 0, netProfit: 0, revenue: 0, returns: 0 };
    r.orders += 1; r.netProfit += Number(o.net_profit ?? 0); r.revenue += Number(o.revenue_net ?? 0);
    if (o.status === 'returned') r.returns += 1;
    mp.set(o.marketplace, r);
    const c = o.customer.trim().toLocaleLowerCase('tr-TR');
    if (c) byCustomer.set(c, (byCustomer.get(c) ?? 0) + 1);
  }
  const customers = byCustomer.size;
  const repeat = [...byCustomer.values()].filter((n) => n > 1).length;
  return {
    marketplaces: [...mp.values()].map((r) => ({ ...r, netProfit: Math.round(r.netProfit * 100) / 100, revenue: Math.round(r.revenue * 100) / 100, margin: r.revenue ? r.netProfit / r.revenue : 0 }))
      .sort((a, b) => b.netProfit - a.netProfit),
    customers, repeatCustomers: repeat, repeatRate: customers ? repeat / customers : 0,
  };
}
