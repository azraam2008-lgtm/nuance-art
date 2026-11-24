// Rol politikası: personel hangi uçlara erişemez, yanıttan hangi alanlar çıkarılır?
import assert from 'node:assert/strict';

async function main() {
  const { checkPolicy, stripSensitive } = await import('../src/lib/api');
  const denied = (role: 'owner' | 'admin' | 'staff', path: string, method = 'GET') => {
    try { checkPolicy(role, path, method); return false; } catch { return true; }
  };
  // Personel
  for (const p of ['/api/profit', '/api/insights', '/api/expenses', '/api/ads', '/api/fees/quote', '/api/products/bulk-price', '/api/products/bulk-import', '/api/orders/abc/cost', '/api/products/abc/listings']) {
    assert.equal(denied('staff', p, 'POST'), true, p);
  }
  assert.equal(denied('staff', '/api/credentials', 'PUT'), true);
  assert.equal(denied('staff', '/api/credentials/test', 'POST'), true);
  assert.equal(denied('staff', '/api/credentials', 'GET'), false, 'bağlantı durumu görülebilir');
  for (const p of ['/api/orders', '/api/orders/abc', '/api/products', '/api/products/abc/stock', '/api/stock', '/api/jobs']) assert.equal(denied('staff', p, 'POST'), false, p);
  // Yönetici: deneme mağazası hariç her şey
  assert.equal(denied('admin', '/api/profit'), false);
  assert.equal(denied('admin', '/api/credentials', 'PUT'), false);
  assert.equal(denied('admin', '/api/demo', 'POST'), true);
  assert.equal(denied('owner', '/api/demo', 'POST'), false);

  // Hassas alanlar çıkarılır, sipariş termin bilgisi kalır
  const out = stripSensitive({
    products: [{ sku: 'A', price: 100, cost_price: 40, profits: { trendyol: { netProfit: 10 } }, packaging_cost: 2, min_margin: 10 }],
    orders: [{ id: '1', total_amount: 100, cost: { net_profit: 12, deadline: '2026-01-01', status: 'estimate' } }],
    kpis: { monthRevenue: 5, monthNetProfit: 3 },
    credentials: [{ marketplace: 'trendyol', apiKey: 'x', apiSecretMasked: '••', sellerId: '1', hasSecret: true, mode: 'live' }],
  }) as Record<string, Array<Record<string, unknown>>> & { kpis: Record<string, unknown> };
  assert.deepEqual(out.products[0], { sku: 'A', price: 100 });
  assert.deepEqual(out.orders[0], { id: '1', total_amount: 100, cost: { deadline: '2026-01-01', status: 'estimate' } });
  assert.deepEqual(out.kpis, { monthRevenue: 5 });
  assert.deepEqual(out.credentials[0], { marketplace: 'trendyol', mode: 'live' });
  console.log('roles.test.ts: tüm kontroller geçti');
}
main().catch((e) => { console.error(e); process.exit(1); });
