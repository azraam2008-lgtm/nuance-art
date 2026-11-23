import assert from 'node:assert/strict';
import { marketplaceAndCustomers, productEconomics, salesTrend, stockForecast } from '../src/lib/insights/analyze';

const now = Date.parse('2026-11-23T12:00:00Z');
const d = (daysAgo: number) => new Date(now - daysAgo * 86_400_000).toISOString();
const products = [
  { id: 'a', sku: 'A', title: 'Mum', total_stock: 6, low_stock_threshold: 5 },
  { id: 'b', sku: 'B', title: 'Vazo', total_stock: 100, low_stock_threshold: 5 },
  { id: 'c', sku: 'C', title: 'Kart', total_stock: 20, low_stock_threshold: 5 },
];
// A: 30 günde 30 adet (günde 1) → 6 gün yeter
const sales = [...Array.from({ length: 30 }, (_, i) => ({ product_id: 'a', qty: 1, date: d(i) })), { product_id: 'b', qty: 2, date: d(40) }, { product_id: 'b', qty: 1, date: d(45) }];
const f = stockForecast(products, sales, now);
assert.equal(f.length, 1);
assert.equal(f[0].sku, 'A');
assert.equal(f[0].daysLeft, 6);
assert.equal(f[0].suggest, 15, '21 günlük ihtiyaç − eldeki 6');

const t = salesTrend(products, sales, now);
assert.equal(t.totalCurrent, 30);
assert.ok(t.falling.some((x) => x.sku === 'B'), 'B düşüşte');
assert.ok(t.stale.some((x) => x.sku === 'C'), 'C hiç satmıyor');

const orders = [
  { id: '1', marketplace: 'trendyol', status: 'delivered', date: d(1), customer: 'Ayşe', net_profit: 50, revenue_net: 200, return_reason: null, items: [{ product_id: 'a', sku: 'A', title: 'Mum', quantity: 1, share: 1 }] },
  { id: '2', marketplace: 'n11', status: 'returned', date: d(2), customer: 'ayşe', net_profit: -30, revenue_net: 0, return_reason: 'Ürün hasarlı geldi', items: [{ product_id: 'a', sku: 'A', title: 'Mum', quantity: 1, share: 1 }] },
  { id: '3', marketplace: 'n11', status: 'delivered', date: d(3), customer: 'Mehmet', net_profit: -10, revenue_net: 100, return_reason: null, items: [{ product_id: 'b', sku: 'B', title: 'Vazo', quantity: 1, share: 1 }] },
];
const e = productEconomics(orders);
assert.equal(e.losing[0].sku, 'B');
assert.equal(e.reasons[0].reason, 'Ürün hasarlı geldi');
const mc = marketplaceAndCustomers(orders);
assert.equal(mc.repeatCustomers, 1, 'Ayşe iki kez aldı (büyük/küçük harf fark etmez)');
assert.equal(mc.marketplaces[0].marketplace, 'trendyol');
console.log('insights.test.ts: tüm kontroller geçti');
