/* =====================================================================
 * Fiyat Önerici — kullanıcının "Gelişmiş Fiyat Modeli" Excel'inin
 * tüm pazaryerlerine genelleştirilmiş hali.
 *  - Hedef kârı sağlayan EN DÜŞÜK satış fiyatını bulur (barem kademelerini,
 *    şartlı bedelleri ve yüzdesel kesintileri hesaba katarak)
 *  - Akıllı barem asistanı: kademe tavanlarında (199,90 / 349,90 …) kâr karşılaştırması
 *  - Çoklu alım analizi: 1'li / 2'li / 3'lü / 5'li set
 * ===================================================================== */
import { computeGroup, r2 } from './engine';
import type { CarrierRates, CostResult, CostSettings, FeeRule } from './types';

export interface PriceScenario {
  rule: FeeRule;
  rates: CarrierRates;
  settings: CostSettings;
  unitCostNet: number;
  costVatRate: number;
  vatRate: number;
  packagingNet?: number;
  desi: number; //          tekli paket desisi
  desiPerExtraUnit?: number; // set başına eklenen her adet için desi artışı
  carrier?: string;
  sameDayTag: boolean;
  fastTag: boolean;
  handlingDays: number;
  commissionRate?: number | null;
  manualShippingNet?: number | null;
  target: { type: 'margin_on_cost' | 'margin_on_revenue' | 'profit'; value: number };
}

/** Hafta içi sabah verilmiş ve zamanında kargolanmış varsayımsal sipariş */
const SAMPLE_ORDER_AT = '2026-11-18T07:00:00.000Z'; // Çarşamba 10:00 İstanbul
const SAMPLE_SHIP_AT = '2026-11-18T11:00:00.000Z';

export function evaluate(priceGross: number, sc: PriceScenario, quantity = 1): CostResult {
  return computeGroup([{
    id: 'sim',
    items: [{
      sku: 'SIM', quantity, unitPriceGross: priceGross / quantity, vatRate: sc.vatRate,
      unitCostNet: sc.unitCostNet, costVatRate: sc.costVatRate, packagingNet: sc.packagingNet ?? 0,
      commissionRate: sc.commissionRate ?? null, firstSaleThisMonth: false,
    }],
    desi: sc.desi + (quantity - 1) * (sc.desiPerExtraUnit ?? 0),
    carrier: sc.carrier,
    orderedAt: SAMPLE_ORDER_AT,
    shippedAt: SAMPLE_SHIP_AT,
    sameDayTag: sc.sameDayTag,
    fastTag: sc.fastTag,
    handlingDays: sc.handlingDays,
    manualShippingNet: sc.manualShippingNet ?? null,
  }], sc.rule, sc.rates, sc.settings)[0];
}

function requiredProfit(sc: PriceScenario, priceGross: number, quantity: number): number {
  const t = sc.target;
  if (t.type === 'profit') return t.value * quantity;
  if (t.type === 'margin_on_cost') return sc.unitCostNet * quantity * (1 + sc.costVatRate) * t.value;
  return (priceGross / (1 + (sc.rule.config.salesVatOverride ?? sc.vatRate))) * t.value;
}

/** Fiyat kırılma noktaları: barem kademeleri ve şartlı bedel eşikleri */
export function breakpoints(rule: FeeRule): number[] {
  const set = new Set<number>();
  for (const t of rule.config.shipping.barem?.tiers ?? []) set.add(t.upTo);
  for (const f of rule.config.fees) {
    if (f.when?.orderGrossAbove !== undefined) set.add(f.when.orderGrossAbove + 0.01);
    if (f.when?.orderGrossAtMost !== undefined) set.add(f.when.orderGrossAtMost + 0.01);
  }
  return [...set].filter((x) => x > 0).sort((a, b) => a - b);
}

export function solvePrice(sc: PriceScenario, quantity = 1): { price: number; result: CostResult } | null {
  const bps = breakpoints(sc.rule);
  const edges = [0.01, ...bps, 5_000_000];
  const obj = (p: number) => evaluate(p, sc, quantity).netProfitExact - requiredProfit(sc, p, quantity);
  for (let i = 0; i < edges.length - 1; i++) {
    const lo = edges[i];
    const hi = edges[i + 1] - 0.01;
    if (hi < lo || obj(hi) < 0) continue;
    if (obj(lo) >= 0) return { price: r2(lo), result: evaluate(lo, sc, quantity) };
    let a = lo, b = hi;
    for (let k = 0; k < 60 && b - a > 0.001; k++) {
      const m = (a + b) / 2;
      if (obj(m) >= 0) b = m; else a = m;
    }
    const price = Math.ceil(b * 100) / 100;
    return { price, result: evaluate(price, sc, quantity) };
  }
  return null;
}

/** x,90 ile biten ve fiyattan küçük olmayan en yakın "vitrin" fiyatı */
export const charmPrice = (p: number) => r2(Math.ceil(p - 0.9 + 1e-9) + 0.9);

export interface PriceAdvice {
  price: number;
  charm: number;
  result: CostResult;
  charmResult: CostResult;
  targetProfit: number;
  ladder: Array<{ price: number; netProfit: number; shipping: number; meetsTarget: boolean; label: string }>;
  sets: Array<{ quantity: number; price: number | null; unitPrice: number | null; netProfit: number | null; shippingShare: number | null }>;
  messages: Array<{ kind: 'success' | 'warning' | 'info'; text: string }>;
}

export function advise(sc: PriceScenario): PriceAdvice | null {
  const solved = solvePrice(sc, 1);
  if (!solved) return null;
  const { price, result } = solved;
  const charm = charmPrice(price);
  const charmResult = evaluate(charm, sc, 1);
  const target = requiredProfit(sc, price, 1);
  const messages: PriceAdvice['messages'] = [];

  // Akıllı barem asistanı: kademe tavanlarında kâr
  const ladder = breakpoints(sc.rule).map((bp) => {
    const p = r2(bp - 0.1);
    const r = evaluate(p, sc, 1);
    return { price: p, netProfit: r.netProfit, shipping: r.totals.shipping, meetsTarget: r.netProfitExact >= requiredProfit(sc, p, 1) - 1e-6, label: `${p.toLocaleString('tr-TR')} ₺ (kademe tavanı)` };
  });
  for (const step of ladder) {
    if (price > step.price && price - step.price <= Math.max(25, step.price * 0.12)) {
      messages.push({ kind: 'warning', text: `Fiyat ${step.price.toLocaleString('tr-TR')} ₺ kademesini kıl payı geçiyor. ${step.price.toLocaleString('tr-TR')} ₺'de net kâr ${step.netProfit.toLocaleString('tr-TR')} ₺ (hedef ${r2(target).toLocaleString('tr-TR')} ₺) — kargo farkını değerlendirin.` });
    }
  }
  const best = [...ladder, { price, netProfit: result.netProfit, shipping: result.totals.shipping, meetsTarget: true, label: '' }]
    .filter((x) => x.meetsTarget).sort((a, b) => b.netProfit - a.netProfit)[0];
  if (best && best.price !== price && best.netProfit > result.netProfit + 1) {
    messages.push({ kind: 'success', text: `${best.price.toLocaleString('tr-TR')} ₺ fiyatında net kâr ${best.netProfit.toLocaleString('tr-TR')} ₺ ile daha yüksek.` });
  }

  const sets = [1, 2, 3, 5].map((q) => {
    const s = solvePrice(sc, q);
    if (!s) return { quantity: q, price: null, unitPrice: null, netProfit: null, shippingShare: null };
    return { quantity: q, price: s.price, unitPrice: r2(s.price / q), netProfit: s.result.netProfit, shippingShare: s.result.totals.shipping / s.price };
  });
  const single = sets[0];
  if (single.shippingShare !== null && single.shippingShare > 0.4) {
    messages.push({ kind: 'warning', text: `Tekli satışta fiyatın %${Math.round(single.shippingShare * 100)}'i kargoya gidiyor. 3'lü veya 5'li set kargo yükünü dağıtır.` });
  } else if (single.shippingShare !== null) {
    messages.push({ kind: 'info', text: 'Tekli satış yapılabilir, kargo yükü makul seviyede.' });
  }
  for (const n of result.notes) messages.push({ kind: 'info', text: n });

  return { price, charm, result, charmResult, targetProfit: r2(target), ladder, sets, messages };
}
