import { handle, HttpError, readJson, requireNumber } from '@/lib/api';
import { isMarketplace } from '@/lib/marketplaces/meta';
import { evaluate, type PriceScenario } from '@/lib/fees/pricing';
import { loadRates, loadRules, loadSettings, pickRule, ratesFor } from '@/lib/fees/service';

export const dynamic = 'force-dynamic';

interface Quote { marketplace: string; price: number; carrier?: string | null; sameDayTag?: boolean; fastTag?: boolean; handlingDays?: number; commissionRate?: number | null; manualShippingNet?: number | null }

/**
 * Belirli bir satış fiyatında her pazaryeri için kesintiler ve net kâr:
 * komisyon, platform/hizmet bedeli, kargo (barem/desi), stopaj, ürün maliyeti.
 * Yeni ürün sihirbazı ve ürün detay sayfası kullanır.
 */
export const POST = handle(async (req: Request) => {
  const b = await readJson<{ unitCostNet?: number; costVatRate?: number; vatRate?: number; desi?: number; packagingNet?: number; quotes?: Quote[] }>(req);
  const unitCostNet = requireNumber(b.unitCostNet ?? 0, 'Maliyet');
  const vatRate = requireNumber(b.vatRate ?? 20, 'KDV') / 100;
  const costVatRate = requireNumber(b.costVatRate ?? (b.vatRate ?? 20), 'Maliyet KDV') / 100;
  const desi = requireNumber(b.desi ?? 1, 'Desi');
  if (!Array.isArray(b.quotes) || !b.quotes.length) throw new HttpError(400, 'Teklif listesi boş.');
  const [rules, rateRows, settings] = await Promise.all([loadRules(), loadRates(), loadSettings()]);
  const now = new Date().toISOString();
  const results = b.quotes.filter((q) => isMarketplace(q.marketplace) && Number(q.price) > 0).map((q) => {
    const rule = pickRule(rules, q.marketplace, now);
    const sc: PriceScenario = {
      rule, rates: ratesFor(rateRows, rule.config.shipping.desiTable, now), settings, unitCostNet, costVatRate, vatRate, desi, packagingNet: Number(b.packagingNet ?? 0),
      carrier: q.carrier || rule.config.shipping.defaultCarrier, sameDayTag: !!q.sameDayTag, fastTag: !!q.fastTag, handlingDays: q.handlingDays ?? 1,
      commissionRate: q.commissionRate != null ? Number(q.commissionRate) / 100 : null, manualShippingNet: q.manualShippingNet ?? null,
      target: { type: 'profit', value: 0 },
    };
    const r = evaluate(Number(q.price), sc, 1);
    return {
      marketplace: q.marketplace, price: Number(q.price), verified: rule.verified,
      commissionRate: (sc.commissionRate ?? rule.config.commission.defaultRate) * 100,
      totals: r.totals, netProfit: r.netProfit, marginOnRevenue: r.marginOnRevenue, marginOnCost: r.marginOnCost,
      revenueNet: r.revenueNet, lines: r.lines.map((l) => ({ code: l.code, label: l.label, cost: l.cost, note: l.note })), notes: r.notes,
    };
  });
  return { results };
});
