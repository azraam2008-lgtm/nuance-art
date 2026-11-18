import { evaluate, type PriceScenario } from './pricing';
import { loadRates, loadRules, loadSettings, pickRule, ratesFor } from './service';
import { isMarketplace } from '@/lib/marketplaces/meta';

export interface ProfitProduct { price: number; cost_price: number; cost_vat_rate: number | null; vat_rate: number; desi: number; packaging_cost: number }
export interface ProfitListing { marketplace_name: string; price_override?: number | null; commission_rate: number | null; carrier: string | null; same_day_tag: boolean; fast_tag: boolean; handling_days: number; manual_shipping_cost: number | null }
export interface ListingProfit {
  price: number; commission: number; fee: number; shipping: number; tax: number; netProfit: number; margin: number; commissionRate: number; verified: boolean;
  lines: Array<{ label: string; cost: number; note?: string }>; notes: string[];
}

/** Ürünlerin her pazaryeri ilanı için, ilandaki fiyat ve ayarlarla tahmini kesinti ve net kâr */
export async function profitsFor<P extends ProfitProduct & { listings: ProfitListing[] }>(products: P[]): Promise<Array<P & { profits: Record<string, ListingProfit> }>> {
  const [rules, rateRows, settings] = await Promise.all([loadRules(), loadRates(), loadSettings()]);
  const now = new Date().toISOString();
  return products.map((p) => {
    const profits: Record<string, ListingProfit> = {};
    for (const l of p.listings ?? []) {
      if (!isMarketplace(l.marketplace_name)) continue;
      const price = Number(l.price_override ?? p.price);
      if (!(price > 0)) continue;
      try {
        const rule = pickRule(rules, l.marketplace_name, now);
        const sc: PriceScenario = {
          rule, rates: ratesFor(rateRows, rule.config.shipping.desiTable, now), settings,
          unitCostNet: Number(p.cost_price), costVatRate: Number(p.cost_vat_rate ?? p.vat_rate) / 100, vatRate: Number(p.vat_rate) / 100,
          desi: Number(p.desi) || 1, packagingNet: Number(p.packaging_cost) || 0,
          carrier: l.carrier || rule.config.shipping.defaultCarrier, sameDayTag: !!l.same_day_tag, fastTag: !!l.fast_tag, handlingDays: l.handling_days ?? 1,
          commissionRate: l.commission_rate != null ? Number(l.commission_rate) / 100 : null, manualShippingNet: l.manual_shipping_cost ?? null,
          target: { type: 'profit', value: 0 },
        };
        const r = evaluate(price, sc, 1);
        profits[l.marketplace_name] = {
          price, commission: r.totals.commission, fee: r.totals.fee, shipping: r.totals.shipping, tax: r.totals.tax,
          netProfit: r.netProfit, margin: r.marginOnRevenue, commissionRate: (sc.commissionRate ?? rule.config.commission.defaultRate) * 100, verified: rule.verified,
          lines: r.lines.map((x) => ({ label: x.label, cost: x.cost, note: x.note })), notes: r.notes,
        };
      } catch { /* kural yoksa atla */ }
    }
    return { ...p, profits };
  });
}
