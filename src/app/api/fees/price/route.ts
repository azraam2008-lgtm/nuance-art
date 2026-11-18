import { handle, HttpError, readJson, requireNumber } from '@/lib/api';
import { db, must } from '@/lib/supabase/server';
import { isMarketplace, MARKETPLACES, type MarketplaceName } from '@/lib/marketplaces/meta';
import { advise, type PriceScenario } from '@/lib/fees/pricing';
import { loadRates, loadRules, loadSettings, pickRule, ratesFor } from '@/lib/fees/service';

export const dynamic = 'force-dynamic';

interface Body {
  productId?: string;
  marketplaces?: string[];
  unitCostNet?: number;
  costVatRate?: number; // %
  vatRate?: number; //     %
  packagingNet?: number;
  desi?: number;
  targetType?: 'margin_on_cost' | 'margin_on_revenue' | 'profit';
  targetValue?: number; // margin: % / profit: TL
  adRate?: number; //      %
  returnRiskRate?: number; // %
  overrides?: Record<string, { commissionRate?: number | null; carrier?: string | null; sameDayTag?: boolean; fastTag?: boolean; handlingDays?: number; manualShippingNet?: number | null }>;
}

/**
 * Her pazaryeri için hedef kârı sağlayan en düşük satış fiyatını, x,90 vitrin fiyatını,
 * kademe (barem) karşılaştırmasını ve 1/2/3/5'li set analizini döndürür.
 * productId verilirse ürünün maliyeti, desisi ve pazaryeri ayarları otomatik kullanılır.
 */
export const POST = handle(async (req: Request) => {
  const b = await readJson<Body>(req);
  const mps = (b.marketplaces?.length ? b.marketplaces : [...MARKETPLACES]).filter(isMarketplace) as MarketplaceName[];
  let base = {
    unitCostNet: b.unitCostNet, costVatRate: b.costVatRate, vatRate: b.vatRate, packagingNet: b.packagingNet ?? 0, desi: b.desi,
  };
  const listingByMp: Record<string, { commission_rate: number | null; carrier: string | null; same_day_tag: boolean; fast_tag: boolean; handling_days: number; manual_shipping_cost: number | null }> = {};
  if (b.productId) {
    const p = must(await db().from('products').select('cost_price, cost_vat_rate, vat_rate, packaging_cost, desi').eq('id', b.productId).single()) as
      { cost_price: number; cost_vat_rate: number | null; vat_rate: number; packaging_cost: number; desi: number };
    base = {
      unitCostNet: b.unitCostNet ?? Number(p.cost_price), costVatRate: b.costVatRate ?? Number(p.cost_vat_rate ?? p.vat_rate),
      vatRate: b.vatRate ?? Number(p.vat_rate), packagingNet: b.packagingNet ?? Number(p.packaging_cost), desi: b.desi ?? Number(p.desi),
    };
    const ls = must(await db().from('marketplace_listings').select('marketplace_name, commission_rate, carrier, same_day_tag, fast_tag, handling_days, manual_shipping_cost').eq('product_id', b.productId)) as Array<{ marketplace_name: string } & (typeof listingByMp)[string]>;
    for (const l of ls) listingByMp[l.marketplace_name] = l;
  }
  const unitCostNet = requireNumber(base.unitCostNet, 'Birim maliyet');
  const costVatRate = requireNumber(base.costVatRate ?? 20, 'Maliyet KDV oranı') / 100;
  const vatRate = requireNumber(base.vatRate ?? 20, 'Satış KDV oranı') / 100;
  const desi = requireNumber(base.desi ?? 1, 'Desi');
  const targetType = b.targetType ?? 'margin_on_cost';
  const targetValue = requireNumber(b.targetValue ?? 30, 'Hedef', { min: -1000 });
  if (!['margin_on_cost', 'margin_on_revenue', 'profit'].includes(targetType)) throw new HttpError(400, 'Hedef türü geçersiz.');

  const [rules, rateRows, settings0] = await Promise.all([loadRules(), loadRates(), loadSettings()]);
  const settings = {
    ...settings0,
    adRate: b.adRate !== undefined ? Number(b.adRate) / 100 : settings0.adRate,
    returnRiskRate: b.returnRiskRate !== undefined ? Number(b.returnRiskRate) / 100 : settings0.returnRiskRate,
  };
  const today = new Date().toISOString();
  const results = mps.map((mp) => {
    const rule = pickRule(rules, mp, today);
    const l = listingByMp[mp];
    const o = b.overrides?.[mp] ?? {};
    const sc: PriceScenario = {
      rule, rates: ratesFor(rateRows, rule.config.shipping.desiTable, today), settings,
      unitCostNet, costVatRate, vatRate, packagingNet: Number(base.packagingNet ?? 0), desi,
      carrier: o.carrier ?? l?.carrier ?? rule.config.shipping.defaultCarrier,
      sameDayTag: o.sameDayTag ?? l?.same_day_tag ?? false,
      fastTag: o.fastTag ?? l?.fast_tag ?? false,
      handlingDays: o.handlingDays ?? l?.handling_days ?? 1,
      commissionRate: o.commissionRate != null ? o.commissionRate / 100 : l?.commission_rate != null ? Number(l.commission_rate) / 100 : null,
      manualShippingNet: o.manualShippingNet ?? l?.manual_shipping_cost ?? null,
      target: { type: targetType, value: targetType === 'profit' ? targetValue : targetValue / 100 },
    };
    const a = advise(sc);
    return {
      marketplace: mp,
      verified: rule.verified,
      ruleDate: rule.effectiveFrom,
      inputs: { carrier: sc.carrier, sameDayTag: sc.sameDayTag, fastTag: sc.fastTag, handlingDays: sc.handlingDays, commissionRate: (sc.commissionRate ?? rule.config.commission.defaultRate) * 100 },
      advice: a,
    };
  });
  return { results };
});
