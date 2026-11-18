import assert from 'node:assert/strict';
import { computeGroup, DEFAULT_SETTINGS } from '../src/lib/fees/engine';
import { advise, solvePrice, evaluate, type PriceScenario } from '../src/lib/fees/pricing';
import { DEFAULT_RULES, DEFAULT_RATE_TABLES } from '../src/lib/fees/defaults';
import type { CostPackage } from '../src/lib/fees/types';

const rule = (m: string) => DEFAULT_RULES.find((r) => r.marketplace === m)!;
const rates = (m: string) => DEFAULT_RATE_TABLES[m]?.carriers ?? {};
const near = (a: number, b: number, eps = 0.02, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} beklenen ${b}, bulunan ${a}`);
let passed = 0;
const t = (name: string, fn: () => void) => { fn(); passed++; console.log('✓', name); };

// Çarşamba 10:00 İstanbul sipariş, 14:00 kargo
const WED = '2026-11-18T07:00:00.000Z', WED_SHIP = '2026-11-18T11:00:00.000Z', THU_SHIP = '2026-11-19T09:00:00.000Z', FRI_SHIP = '2026-11-20T09:00:00.000Z';
const pkg = (o: Partial<CostPackage> & { price: number; qty?: number }): CostPackage => ({
  id: o.id ?? 'p', desi: o.desi ?? 1, carrier: o.carrier ?? 'TEX', orderedAt: o.orderedAt ?? WED, shippedAt: o.shippedAt ?? WED_SHIP,
  sameDayTag: o.sameDayTag ?? false, fastTag: o.fastTag ?? false, handlingDays: o.handlingDays ?? 1,
  items: [{ sku: 'X', quantity: o.qty ?? 1, unitPriceGross: o.price / (o.qty ?? 1), vatRate: 0.2, unitCostNet: 0, costVatRate: 0.2 }],
  ...o,
});
const ship = (r: ReturnType<typeof computeGroup>[0]) => r.lines.filter((l) => l.code.startsWith('shipping')).reduce((s, l) => s + (l.gross - l.vat), 0);
const fee = (r: ReturnType<typeof computeGroup>[0], code: string) => { const l = r.lines.find((x) => x.code === code); return l ? l.gross - l.vat : 0; };

t('Excel modeli: 14 TL maliyet, %10 KDV, %70 hedef, %20 komisyon, TEX, Bugün Kargoda → 93,42 TL, net kâr 10,78 TL', () => {
  const sc: PriceScenario = {
    rule: rule('trendyol'), rates: rates('trendyol'), settings: DEFAULT_SETTINGS, unitCostNet: 14, costVatRate: 0.1, vatRate: 0.1,
    desi: 1, carrier: 'TEX', sameDayTag: true, fastTag: false, handlingDays: 0, commissionRate: 0.2, target: { type: 'margin_on_cost', value: 0.7 },
  };
  const s = solvePrice(sc)!;
  near(s.price, 93.4227, 0.01, 'fiyat (Excel 93,4227 → kuruşa yukarı yuvarlanır)');
  near(s.result.netProfit, 10.78, 0.01, 'net kâr');
  near(s.result.totals.shipping, 38.74, 0.001, 'kargo');
  near(fee(s.result, 'platform_fee'), 4.99, 0.001, 'PHB');
  // Excel set analizi: 2'li 127,21 / 3'lü 161,00 / 5'li 271,77
  near(solvePrice(sc, 2)!.price, 127.2136, 0.01, '2li');
  near(solvePrice(sc, 3)!.price, 161.0045, 0.01, '3lü');
  near(solvePrice(sc, 5)!.price, 271.7727, 0.01, '5li');
  const a = advise(sc)!;
  assert.equal(a.charm, 93.9);
  // Excel: "Tekli satımda fiyatın %40'ından fazlası kargoya gidiyor" (KDV dahil kargo / fiyat = %49,8)
  assert.ok(a.messages.some((m) => m.text.includes('kargoya gidiyor')));
});

t('Barem Örnek 1: 170 TL — hızlı (1 gün termin) TEX 38,74; termin aşılırsa 73,33', () => {
  const r = rule('trendyol');
  near(ship(computeGroup([pkg({ price: 170 })], r, rates('trendyol'))[0]), 38.74, 0.001);
  near(ship(computeGroup([pkg({ price: 170, shippedAt: FRI_SHIP })], r, rates('trendyol'))[0]), 73.33, 0.001);
  near(ship(computeGroup([pkg({ price: 170, handlingDays: 3, shippedAt: THU_SHIP })], r, rates('trendyol'))[0]), 73.33, 0.001, '3 gün termin');
  near(ship(computeGroup([pkg({ price: 170, carrier: 'Aras' })], r, rates('trendyol'))[0]), 48.33, 0.001);
  near(ship(computeGroup([pkg({ price: 170, carrier: 'Yurtiçi', shippedAt: FRI_SHIP })], r, rates('trendyol'))[0]), 114.16, 0.001);
});

t('Barem Örnek 2: 250 TL — hızlı TEX 70,41 / standart 78,74', () => {
  const r = rule('trendyol');
  near(ship(computeGroup([pkg({ price: 250 })], r, rates('trendyol'))[0]), 70.41, 0.001);
  near(ship(computeGroup([pkg({ price: 250, shippedAt: FRI_SHIP })], r, rates('trendyol'))[0]), 78.74, 0.001);
});

t('Örnek 3: 375,90 TL barem dışı — desi tarifesi (TEX 3 desi 100,20; Aras 1 desi 88,96)', () => {
  const r = rule('trendyol');
  near(ship(computeGroup([pkg({ price: 375.9, desi: 3 })], r, rates('trendyol'))[0]), 100.2, 0.001);
  near(ship(computeGroup([pkg({ price: 375.9, carrier: 'Aras' })], r, rates('trendyol'))[0]), 88.96, 0.001);
});

t('Barem 10 desi sınırı: 170 TL ama 12 desi → desi tarifesi (TEX 182,20)', () => {
  near(ship(computeGroup([pkg({ price: 170, desi: 12 })], rule('trendyol'), rates('trendyol'))[0]), 182.2, 0.001);
});

t('Paket bölme Örnek 1: toplam 350 TL → A 200 TL/4 desi ve B 150 TL/7 desi desi bazlı', () => {
  const res = computeGroup([pkg({ id: 'A', price: 200, desi: 4 }), pkg({ id: 'B', price: 150, desi: 7 })], rule('trendyol'), rates('trendyol'));
  near(ship(res[0]), 107.2, 0.001, 'A TEX 4 desi');
  near(ship(res[1]), 133.41, 0.001, 'B TEX 7 desi');
});

t('Paket bölme Örnek 2: toplam 70 TL → A 50 TL/3 desi barem, B 20 TL/5 desi desi bazlı', () => {
  const res = computeGroup([pkg({ id: 'A', price: 50, desi: 3 }), pkg({ id: 'B', price: 20, desi: 5 })], rule('trendyol'), rates('trendyol'));
  near(ship(res[0]), 38.74, 0.001, 'A barem');
  near(ship(res[1]), 114.1, 0.001, 'B TEX 5 desi');
});

t('Platform hizmet bedeli: Bugün Kargoda + aynı gün 4,99; ertesi gün 10,99; etiketsiz 10,99; mikro ihracat 0', () => {
  const r = rule('trendyol');
  near(fee(computeGroup([pkg({ price: 100, sameDayTag: true })], r, rates('trendyol'))[0], 'platform_fee'), 4.99, 0.001);
  near(fee(computeGroup([pkg({ price: 100, sameDayTag: true, shippedAt: THU_SHIP })], r, rates('trendyol'))[0], 'platform_fee'), 10.99, 0.001);
  near(fee(computeGroup([pkg({ price: 100 })], r, rates('trendyol'))[0], 'platform_fee'), 10.99, 0.001);
  near(fee(computeGroup([pkg({ price: 100, microExport: true })], r, rates('trendyol'))[0], 'platform_fee'), 0, 0.001);
  // Saat 16:00'da (kesim 14:00 sonrası) verilen sipariş Bugün Kargoda siparişi sayılmaz
  near(fee(computeGroup([pkg({ price: 100, sameDayTag: true, orderedAt: '2026-11-18T13:00:00.000Z', shippedAt: '2026-11-18T15:00:00.000Z' })], r, rates('trendyol'))[0], 'platform_fee'), 10.99, 0.001);
  // Henüz kargolanmadı → tahmin (zamanında gönderileceği varsayılır)
  const est = computeGroup([pkg({ price: 100, sameDayTag: true, shippedAt: null })], r, rates('trendyol'))[0];
  assert.equal(est.status, 'estimate'); near(fee(est, 'platform_fee'), 4.99, 0.001);
});

t('Kurdele 25→20 senaryosu Trendyol: 3 adet × 49,90 = 149,70 TL siparişin net kârı tutarlı', () => {
  const p = pkg({ price: 149.7, qty: 3, sameDayTag: true });
  p.items[0].unitCostNet = 18; p.items[0].costVatRate = 0.2;
  const r = computeGroup([p], rule('trendyol'), rates('trendyol'))[0];
  const expected = 149.7 / 1.2 - 54 - 149.7 * 0.2 / 1.2 - 4.99 - 38.74 - 149.7 / 1.2 * 0.01;
  near(r.netProfit, expected, 0.01);
});

t('Hepsiburada: HepsiJET 0–1 gün <200 → 43,99 + 10,99 hizmet; 3 gün termin → barem yok', () => {
  const r = rule('hepsiburada');
  const a = computeGroup([pkg({ price: 150, carrier: 'HepsiJET' })], r, {})[0];
  near(ship(a), 43.99, 0.001); near(fee(a, 'service_fee'), 10.99, 0.001);
  const b = computeGroup([pkg({ price: 150, carrier: 'HepsiJET', handlingDays: 3, shippedAt: THU_SHIP })], r, {})[0];
  near(ship(b), 81.99, 0.001, 'fallback');
  const c = computeGroup([pkg({ price: 150, carrier: 'Aras' })], r, {})[0];
  near(ship(c), 81.99, 0.001, 'Aras barem dışı');
});

t('N11: 120 TL PTT barem 38,74 + %2,35 posta; %1 + %0,67 hizmet bedeli', () => {
  const r = computeGroup([pkg({ price: 120, carrier: 'PTT' })], rule('n11'), {})[0];
  near(ship(r), 38.74 * 1.0235, 0.001);
  near(fee(r, 'marketing_fee'), 1, 0.001); near(fee(r, 'marketplace_fee'), 0.67, 0.001);
});

t('Çiçeksepeti: komisyon (ürün+kargo) KDV hariç, listeleme yalnızca ayın ilk satışında', () => {
  const p = pkg({ price: 240, carrier: 'Aras', buyerShippingGross: 60 }); p.items[0].firstSaleThisMonth = true;
  const r = computeGroup([p], rule('ciceksepeti'), {})[0];
  const comm = r.lines.find((l) => l.code === 'commission')!;
  near(comm.gross, (200 + 50) * 0.2 * 1.2, 0.01);
  near(r.lines.find((l) => l.code === 'listing_fee')!.gross, 10.9, 0.001);
  const p2 = pkg({ price: 240, carrier: 'Aras' });
  assert.equal(computeGroup([p2], rule('ciceksepeti'), {})[0].lines.find((l) => l.code === 'listing_fee'), undefined);
});

t('idefix: resmi tablo Sürat 5 desi 125,14; komisyon + stopaj', () => {
  near(ship(computeGroup([pkg({ price: 500, carrier: 'Sürat', desi: 5 })], rule('idefix'), rates('idefix'))[0]), 125.14, 0.001);
});

t('Koçtaş: komisyon KDV dahil oran; kiosk %3', () => {
  const r = computeGroup([pkg({ price: 1000, carrier: 'Yurtiçi', kiosk: true })], rule('koctas'), {})[0];
  near(r.lines.find((l) => l.code === 'commission')!.gross, 150, 0.001);
  near(r.lines.find((l) => l.code === 'kiosk_fee')!.gross, 30, 0.001);
});

t('Etsy: satış KDV 0, stopaj yok, bedellere %20 KDV (indirilemez), 0,20 USD × adet', () => {
  const p = pkg({ price: 1000, qty: 2, carrier: 'PTT Global', buyerShippingGross: 200, manualShippingNet: 300 });
  const r = computeGroup([p], rule('etsy'), {}, { ...DEFAULT_SETTINGS, usdTry: 40 })[0];
  assert.equal(r.revenueNet, 1200); assert.equal(r.outputVat, 0);
  near(r.lines.find((l) => l.code === 'commission')!.cost, 1200 * 0.065 * 1.2, 0.01);
  near(r.lines.find((l) => l.code === 'listing_fee')!.cost, 0.2 * 40 * 2 * 1.2, 0.01);
  assert.equal(r.lines.find((l) => l.code === 'stopaj'), undefined);
  assert.equal(r.lines.find((l) => l.code === 'offsite_ads'), undefined);
});

t('İptal: kargolanmadan → 0; kargolandıktan sonra iade → gidiş + dönüş kargo zararı', () => {
  const a = computeGroup([pkg({ price: 150, cancelled: true, shippedAt: null })], rule('trendyol'), rates('trendyol'))[0];
  assert.equal(a.netProfit, 0);
  const b = computeGroup([pkg({ price: 150, cancelled: true })], rule('trendyol'), rates('trendyol'))[0];
  near(b.netProfit, -(38.74 * 2), 0.01);
});

t('Komisyon indirimi (ör. yeni mağaza %50) tanımlanırsa uygulanır', () => {
  const r = structuredClone(rule('trendyol'));
  r.config.commission.discount = { rate: 0.5, label: 'Yeni mağaza %50 komisyon indirimi', until: '2026-12-31' };
  const res = computeGroup([pkg({ price: 120 })], r, rates('trendyol'))[0];
  near(res.lines.find((l) => l.code === 'commission')!.gross, 12, 0.001);
});

t('Fiyat önerici her pazaryerinde çözüm üretir', () => {
  for (const r of DEFAULT_RULES) {
    const sc: PriceScenario = { rule: r, rates: rates(r.marketplace), settings: DEFAULT_SETTINGS, unitCostNet: 100, costVatRate: 0.2, vatRate: 0.2, desi: 2,
      carrier: r.config.shipping.defaultCarrier, sameDayTag: true, fastTag: true, handlingDays: 1, manualShippingNet: 150, target: { type: 'margin_on_cost', value: 0.3 } };
    const s = solvePrice(sc)!;
    assert.ok(s && s.result.netProfit >= 36 - 0.01, r.marketplace);
    assert.ok(evaluate(s.price - 0.05, sc).netProfit < s.result.netProfit, r.marketplace + ' minimum');
  }
});

console.log(`\n${passed} test geçti.`);
