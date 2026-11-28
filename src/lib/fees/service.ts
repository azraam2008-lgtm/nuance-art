import 'server-only';
import { db, must } from '@/lib/supabase/server';
import { baseOf, isClosedStatus, isMarketplace, MARKETPLACES } from '@/lib/marketplaces/meta';
import { computeGroup, DEFAULT_SETTINGS } from './engine';
import { DEFAULT_RATE_TABLES, DEFAULT_RULES, defaultRule } from './defaults';
import type { CarrierRates, CostPackage, CostResult, CostSettings, FeeRule } from './types';

/* =====================================================================
 * Kârlılık servisi: kuralları/tarifeleri veritabanından yükler, siparişleri
 * motorla hesaplar ve order_costs tablosuna yazar. Sipariş içe alındığında,
 * durumu değiştiğinde veya kargoya verildiğinde otomatik çağrılır.
 * ===================================================================== */

interface RuleRow { marketplace_name: string; effective_from: string; config: FeeRule['config']; verified: boolean; notes: string[]; sources: FeeRule['sources'] }
interface RateRow { rate_table: string; carrier: string; effective_from: string; prices: number[] }

// ---------------- Kurallar ----------------
export async function ensureSeeded() {
  const { count } = await db().from('fee_rules').select('id', { count: 'exact', head: true });
  if (!count) {
    must(await db().from('fee_rules').upsert(DEFAULT_RULES.map((r) => ({
      marketplace_name: r.marketplace, effective_from: r.effectiveFrom, config: r.config, verified: r.verified, notes: r.notes, sources: r.sources,
    })), { onConflict: 'marketplace_name,effective_from' }));
  }
  const { count: rc } = await db().from('carrier_rates').select('id', { count: 'exact', head: true });
  if (!rc) {
    const rows = Object.entries(DEFAULT_RATE_TABLES).flatMap(([table, t]) =>
      Object.entries(t.carriers).map(([carrier, prices]) => ({ rate_table: table, carrier, effective_from: t.effectiveFrom, prices, source: t.source })));
    must(await db().from('carrier_rates').upsert(rows, { onConflict: 'rate_table,carrier,effective_from' }));
  }
}

export async function loadRules(): Promise<FeeRule[]> {
  await ensureSeeded();
  const rows = must(await db().from('fee_rules').select('*').order('effective_from', { ascending: true })) as RuleRow[];
  return rows.map((r) => ({ marketplace: r.marketplace_name, effectiveFrom: r.effective_from, config: r.config, verified: r.verified, notes: r.notes ?? [], sources: r.sources ?? [] }));
}

export function pickRule(rules: FeeRule[], marketplace: string, dateIso: string): FeeRule {
  const day = dateIso.slice(0, 10);
  // İkinci mağaza (trendyol_2) ana pazaryerinin kurallarını kullanır
  const base = baseOf(marketplace);
  const list = rules.filter((r) => r.marketplace === base).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  const applicable = list.filter((r) => r.effectiveFrom <= day);
  const rule = applicable[applicable.length - 1] ?? list[0] ?? defaultRule(base);
  if (!rule) throw new Error(`${marketplace} için maliyet kuralı yok.`);
  return rule;
}

export async function loadRates(): Promise<RateRow[]> {
  await ensureSeeded();
  return must(await db().from('carrier_rates').select('rate_table, carrier, effective_from, prices').order('effective_from', { ascending: true })) as RateRow[];
}

export function ratesFor(rows: RateRow[], table: string | undefined, dateIso: string): CarrierRates {
  if (!table) return {};
  const day = dateIso.slice(0, 10);
  const out: CarrierRates = {};
  for (const r of rows.filter((x) => x.rate_table === table)) {
    if (r.effective_from <= day || !out[r.carrier]) out[r.carrier] = r.prices;
  }
  return out;
}

export async function loadSettings(): Promise<CostSettings & { fx: Record<string, number> }> {
  const rows = must(await db().from('app_settings').select('key, value').in('key', ['cost', 'fx'])) as Array<{ key: string; value: Record<string, unknown> }>;
  const cost = (rows.find((r) => r.key === 'cost')?.value ?? {}) as Partial<CostSettings>;
  const fx = (rows.find((r) => r.key === 'fx')?.value ?? {}) as { rates?: Record<string, number> };
  const rates = { USD: DEFAULT_SETTINGS.usdTry, ...(fx.rates ?? {}) };
  return { ...DEFAULT_SETTINGS, ...cost, usdTry: rates.USD, fx: rates };
}

/** TCMB günlük kurları (döviz satış). Ağ hatasında sessizce mevcut kurla devam eder. */
export async function refreshFx(): Promise<Record<string, number> | null> {
  try {
    const res = await fetch('https://www.tcmb.gov.tr/kurlar/today.xml', { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    const xml = await res.text();
    const rates: Record<string, number> = {};
    for (const code of ['USD', 'EUR', 'GBP', 'CAD', 'AUD']) {
      const m = xml.match(new RegExp(`CurrencyCode="${code}"[\\s\\S]*?<ForexSelling>([\\d.]+)</ForexSelling>`));
      if (m) rates[code] = Number(m[1]);
    }
    if (!rates.USD) return null;
    must(await db().from('app_settings').upsert({ key: 'fx', value: { rates, source: 'TCMB', updatedAt: new Date().toISOString() }, updated_at: new Date().toISOString() }));
    return rates;
  } catch {
    return null;
  }
}

// ---------------- Sipariş maliyeti ----------------
interface OrderRow {
  id: string; external_order_id: string; order_group: string; marketplace_name: string; status: string; order_date: string;
  shipped_at: string | null; carrier: string | null; desi: number | null; marketplace_same_day: boolean | null; marketplace_fast: boolean | null;
  actual_commission_net: number | null; actual_shipping_net: number | null; buyer_shipping_gross: number; seller_discount_gross: number;
  micro_export: boolean; kiosk: boolean;
  items: Array<{ product_id: string | null; sku: string; product_title: string; quantity: number; unit_price: number; vat_rate: number | null; unit_cost_net: number | null; cost_vat_rate: number | null; commission_rate: number | null }>;
}
interface ProductLite { id: string; sku: string; vat_rate: number; cost_price: number; cost_vat_rate: number | null; desi: number; packaging_cost: number; category: string }
interface ListingLite { product_id: string; marketplace_name: string; commission_rate: number | null; handling_days: number; same_day_tag: boolean; fast_tag: boolean; carrier: string | null; manual_shipping_cost: number | null }

const ORDER_SELECT = 'id, external_order_id, order_group, marketplace_name, status, order_date, shipped_at, carrier, desi, marketplace_same_day, marketplace_fast, actual_commission_net, actual_shipping_net, buyer_shipping_gross, seller_discount_gross, micro_export, kiosk, items:order_items(product_id, sku, product_title, quantity, unit_price, vat_rate, unit_cost_net, cost_vat_rate, commission_rate)';

/** Verilen siparişleri (ve aynı sipariş grubundaki kardeş paketleri) hesaplayıp kaydeder */
export async function computeOrderCosts(orderIds: string[]): Promise<number> {
  if (!orderIds.length) return 0;
  // URL uzunluğu sınırı (HTTP 431) nedeniyle kimlikler 100'erli gruplar halinde sorgulanır
  const seeds: Array<{ marketplace_name: string; order_group: string }> = [];
  for (let i = 0; i < orderIds.length; i += 100) {
    seeds.push(...(must(await db().from('orders').select('marketplace_name, order_group').in('id', orderIds.slice(i, i + 100))) as Array<{ marketplace_name: string; order_group: string }>));
  }
  const groups = new Map<string, Set<string>>();
  for (const s of seeds) groups.set(s.marketplace_name, (groups.get(s.marketplace_name) ?? new Set()).add(s.order_group));
  const orders: OrderRow[] = [];
  for (const [mp, set] of groups) {
    const keys = [...set];
    for (let i = 0; i < keys.length; i += 100) {
      orders.push(...(must(await db().from('orders').select(ORDER_SELECT).eq('marketplace_name', mp).in('order_group', keys.slice(i, i + 100))) as unknown as OrderRow[]));
    }
  }
  return computeAndStore(orders);
}

async function computeAndStore(orders: OrderRow[]): Promise<number> {
  if (!orders.length) return 0;
  const [rules, rateRows, settings] = await Promise.all([loadRules(), loadRates(), loadSettings()]);
  const productIds = [...new Set(orders.flatMap((o) => o.items.map((i) => i.product_id)).filter(Boolean))] as string[];
  const products = new Map<string, ProductLite>();
  const listings = new Map<string, ListingLite>();
  for (let i = 0; i < productIds.length; i += 100) {
    const ids = productIds.slice(i, i + 100);
    for (const p of must(await db().from('products').select('id, sku, vat_rate, cost_price, cost_vat_rate, desi, packaging_cost, category').in('id', ids)) as ProductLite[]) products.set(p.id, p);
    for (const l of must(await db().from('marketplace_listings').select('product_id, marketplace_name, commission_rate, handling_days, same_day_tag, fast_tag, carrier, manual_shipping_cost').in('product_id', ids)) as ListingLite[]) listings.set(`${l.product_id}|${l.marketplace_name}`, l);
  }

  const firstSale = await firstSalesThisMonth(orders, rules);

  const byGroup = new Map<string, OrderRow[]>();
  for (const o of orders) {
    const k = `${o.marketplace_name}|${o.order_group}`;
    if (!(byGroup.get(k) ?? []).some((x) => x.id === o.id)) byGroup.set(k, [...(byGroup.get(k) ?? []), o]);
  }

  const rows: Record<string, unknown>[] = [];
  for (const group of byGroup.values()) {
    const mp = group[0].marketplace_name;
    const rule = pickRule(rules, mp, group[0].order_date);
    const rates = ratesFor(rateRows, rule.config.shipping.desiTable, group[0].order_date);
    const packages: CostPackage[] = group.map((o) => {
      const first = o.items.find((i) => i.product_id);
      const listing = first?.product_id ? listings.get(`${first.product_id}|${mp}`) : undefined;
      const desi = o.desi ?? o.items.reduce((s, i) => s + (i.product_id ? Number(products.get(i.product_id)?.desi ?? 1) : 1) * i.quantity, 0);
      const shippedAt = o.shipped_at ?? (['shipped', 'delivered', 'returned'].includes(o.status) ? o.order_date : null);
      return {
        id: o.id,
        orderedAt: o.order_date,
        shippedAt,
        cancelled: isClosedStatus(o.status),
        desi,
        carrier: o.carrier ?? listing?.carrier ?? null,
        sameDayTag: listing?.same_day_tag ?? false,
        fastTag: listing?.fast_tag ?? false,
        handlingDays: listing?.handling_days ?? 1,
        marketplaceSameDay: o.marketplace_same_day,
        marketplaceFast: o.marketplace_fast,
        actualCommissionNet: o.actual_commission_net,
        actualShippingNet: o.actual_shipping_net,
        manualShippingNet: listing?.manual_shipping_cost ?? null,
        buyerShippingGross: Number(o.buyer_shipping_gross ?? 0),
        sellerDiscountGross: Number(o.seller_discount_gross ?? 0),
        microExport: o.micro_export,
        kiosk: o.kiosk,
        items: o.items.map((i) => {
          const p = i.product_id ? products.get(i.product_id) : undefined;
          const l = i.product_id ? listings.get(`${i.product_id}|${mp}`) : undefined;
          const vat = Number(i.vat_rate ?? p?.vat_rate ?? 20) / 100;
          return {
            sku: i.sku,
            title: i.product_title,
            quantity: i.quantity,
            unitPriceGross: Number(i.unit_price),
            vatRate: vat,
            unitCostNet: Number(i.unit_cost_net ?? p?.cost_price ?? 0),
            costVatRate: Number(i.cost_vat_rate ?? p?.cost_vat_rate ?? p?.vat_rate ?? 20) / 100,
            packagingNet: Number(p?.packaging_cost ?? 0),
            commissionRate: i.commission_rate != null ? Number(i.commission_rate) / 100 : l?.commission_rate != null ? Number(l.commission_rate) / 100 : null,
            category: p?.category,
            firstSaleThisMonth: firstSale.has(`${o.id}|${i.sku}`),
          };
        }),
      };
    });
    const results = computeGroup(packages, rule, rates, settings);
    for (const r of results) rows.push(toRow(r, rule));
  }
  for (let i = 0; i < rows.length; i += 500) {
    must(await db().from('order_costs').upsert(rows.slice(i, i + 500), { onConflict: 'order_id' }));
  }
  return rows.length;
}

function toRow(r: CostResult, rule: FeeRule) {
  return {
    order_id: r.packageId,
    status: r.status,
    rule_effective_from: rule.effectiveFrom,
    revenue_gross: r.revenueGross,
    revenue_net: r.revenueNet,
    commission: r.totals.commission,
    fees: r.totals.fee,
    shipping: r.totals.shipping,
    tax: r.totals.tax,
    product_cost: r.totals.product,
    other: r.totals.other,
    total_cost: r.totalCost,
    vat_payable: r.vatPayable,
    net_profit: r.netProfit,
    margin_on_revenue: Math.max(-999, Math.min(999, Math.round(r.marginOnRevenue * 10000) / 10000)),
    same_day_eligible: r.speed.sameDayEligible,
    same_day_met: r.speed.sameDayMet,
    fast_eligible: r.speed.fastEligible,
    fast_met: r.speed.fastMet,
    deadline: r.speed.deadline,
    lines: r.lines,
    notes: r.notes,
    computed_at: new Date().toISOString(),
  };
}

/** "Ayda satan ürün kodu başına" bedeller (Çiçeksepeti listeleme) için: SKU'nun o aydaki ilk satışı mı? */
async function firstSalesThisMonth(orders: OrderRow[], rules: FeeRule[]): Promise<Set<string>> {
  const out = new Set<string>();
  const mps = [...new Set(orders.map((o) => o.marketplace_name))].filter((mp) => rules.some((r) => r.marketplace === baseOf(mp) && r.config.fees.some((f) => f.per === 'sku_month' && !f.disabled)));
  for (const mp of mps) {
    const mine = orders.filter((o) => o.marketplace_name === mp);
    const months = [...new Set(mine.map((o) => o.order_date.slice(0, 7)))];
    for (const month of months) {
      const from = `${month}-01T00:00:00Z`;
      const d = new Date(from); d.setUTCMonth(d.getUTCMonth() + 1);
      const all = must(await db().from('orders').select('id, order_date, status, items:order_items(sku)').eq('marketplace_name', mp).gte('order_date', from).lt('order_date', d.toISOString()).not('status', 'in', '(cancelled,returned)').order('order_date').order('id')) as unknown as Array<{ id: string; items: Array<{ sku: string }> }>;
      const seen = new Set<string>();
      for (const o of all) for (const i of o.items) {
        if (!seen.has(i.sku)) { seen.add(i.sku); out.add(`${o.id}|${i.sku}`); }
      }
    }
  }
  return out;
}

/** Tüm siparişleri yeniden hesaplar (kural/tarife değişikliğinden sonra) */
export async function recomputeAll(filter?: { marketplace?: string; since?: string }): Promise<number> {
  let total = 0;
  for (let from = 0; ; from += 500) {
    let q = db().from('orders').select(ORDER_SELECT).order('order_date', { ascending: true }).range(from, from + 499);
    if (filter?.marketplace && isMarketplace(filter.marketplace)) q = q.eq('marketplace_name', filter.marketplace);
    if (filter?.since) q = q.gte('order_date', filter.since);
    const rows = must(await q) as unknown as OrderRow[];
    if (!rows.length) break;
    // Grubun eksik kardeş paketleri sayfa sınırında bölünmesin
    total += await computeOrderCosts(rows.map((r) => r.id));
    if (rows.length < 500) break;
  }
  return total;
}

export const ALL_MARKETPLACES = MARKETPLACES;
