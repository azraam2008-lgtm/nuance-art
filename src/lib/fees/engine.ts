/* =====================================================================
 * Maliyet / Kârlılık Motoru (saf fonksiyonlar — veritabanına bağımlı değil)
 *
 * Her paket için: ciro, komisyon, platform/hizmet bedelleri, kargo (barem /
 * desi / paket bölme), e-ticaret stopajı, ürün maliyeti, reklam & iade riski,
 * KDV etkisi ve net kâr hesaplanır. Kurallar FeeRuleConfig ile tanımlanır.
 *
 * Kâr formülü (kullanıcının Excel modeliyle birebir aynı):
 *   Net Kâr = KDV hariç ciro − Σ (gider − indirilebilir KDV) − stopaj − reklam − risk
 * ===================================================================== */
import type {
  CarrierRates, Condition, CostItem, CostLine, CostPackage, CostResult, CostSettings,
  FeeDef, FeeRule, LineGroup, SpeedInfo, VatMode,
} from './types';

const FEE_VAT = 0.2;
const IST_OFFSET = 3 * 3600_000; // Türkiye: UTC+3, yaz saati yok
export const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export const DEFAULT_SETTINGS: CostSettings = {
  adRate: 0,
  returnRiskRate: 0,
  usdTry: 41.5,
  stopajAsCost: true,
  exportCostVatRecoverable: false,
};

// ---------------------------------------------------------------------
// Zaman: Bugün Kargoda / termin hesabı (İstanbul saatiyle, hafta sonu hariç)
// ---------------------------------------------------------------------
function istParts(iso: string) {
  const d = new Date(new Date(iso).getTime() + IST_OFFSET);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), hour: d.getUTCHours(), dow: d.getUTCDay() };
}

/** Sipariş gününden itibaren `businessDays` iş günü sonrası günün sonu (İstanbul 23:59:59) */
export function deadlineAfter(orderedAt: string, businessDays: number): string {
  const p = istParts(orderedAt);
  const day = new Date(Date.UTC(p.y, p.m, p.d));
  const isWeekend = (x: Date) => x.getUTCDay() === 0 || x.getUTCDay() === 6;
  if (businessDays <= 0) {
    while (isWeekend(day)) day.setUTCDate(day.getUTCDate() + 1);
  } else {
    let added = 0;
    while (added < businessDays) {
      day.setUTCDate(day.getUTCDate() + 1);
      if (!isWeekend(day)) added++;
    }
  }
  return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 23, 59, 59) - IST_OFFSET).toISOString();
}

export function speedOf(pkg: CostPackage, cutoffHour = 14): SpeedInfo {
  const p = istParts(pkg.orderedAt);
  const weekday = p.dow >= 1 && p.dow <= 5;
  const sameDayEligible = pkg.marketplaceSameDay ?? (!!pkg.sameDayTag && weekday && p.hour < cutoffHour);
  const handling = pkg.handlingDays ?? 2;
  const fastEligible = pkg.marketplaceFast ?? (sameDayEligible || !!pkg.fastTag || handling <= 1);
  const sameDeadline = deadlineAfter(pkg.orderedAt, 0);
  const fastDeadline = sameDayEligible ? sameDeadline : deadlineAfter(pkg.orderedAt, Math.max(1, handling <= 1 ? 1 : handling));
  const shipped = pkg.shippedAt ? new Date(pkg.shippedAt).getTime() : null;
  return {
    sameDayEligible,
    sameDayMet: sameDayEligible ? (shipped === null ? null : shipped <= new Date(sameDeadline).getTime()) : false,
    fastEligible,
    fastMet: fastEligible ? (shipped === null ? null : shipped <= new Date(fastDeadline).getTime()) : false,
    deadline: sameDayEligible ? sameDeadline : fastEligible ? fastDeadline : deadlineAfter(pkg.orderedAt, handling),
  };
}

interface Ctx {
  pkg: CostPackage;
  speed: SpeedInfo;
  carrier: string;
  orderGross: number;
}

function matches(c: Condition | undefined, x: Ctx): boolean {
  if (!c) return true;
  if (c.sameDayShipped !== undefined) {
    const v = x.speed.sameDayEligible && (x.speed.sameDayMet ?? true);
    if (v !== c.sameDayShipped) return false;
  }
  if (c.fastShipment !== undefined) {
    const v = x.speed.fastEligible && (x.speed.fastMet ?? true);
    if (v !== c.fastShipment) return false;
  }
  if (c.microExport !== undefined && !!x.pkg.microExport !== c.microExport) return false;
  if (c.kiosk !== undefined && !!x.pkg.kiosk !== c.kiosk) return false;
  if (c.carrierIn && !c.carrierIn.includes(x.carrier)) return false;
  if (c.orderGrossAtMost !== undefined && !(x.orderGross <= c.orderGrossAtMost)) return false;
  if (c.orderGrossAbove !== undefined && !(x.orderGross > c.orderGrossAbove)) return false;
  return true;
}

function vatSplit(amount: number, mode: VatMode): { gross: number; vat: number } {
  if (mode === 'included') return { gross: amount, vat: amount - amount / (1 + FEE_VAT) };
  if (mode === 'added') return { gross: amount * (1 + FEE_VAT), vat: amount * FEE_VAT };
  return { gross: amount, vat: 0 };
}

function line(code: string, label: string, group: LineGroup, gross: number, vat: number, recoverable: boolean, note?: string): CostLine {
  return { code, label, group, gross, vat, recoverable, cost: gross - (recoverable ? vat : 0), note };
}

// ---------------------------------------------------------------------
// Ana hesap: bir siparişin (aynı sipariş numarasına ait) tüm paketleri
// ---------------------------------------------------------------------
export function computeGroup(
  packages: CostPackage[],
  rule: FeeRule,
  rates: CarrierRates,
  settings: CostSettings = DEFAULT_SETTINGS,
): CostResult[] {
  const cfg = rule.config;
  const live = packages.filter((p) => !p.cancelled);
  const orderGross = live.reduce((s, p) => s + itemsGross(p.items) - (p.sellerDiscountGross ?? 0), 0);

  // Paket bölme: sipariş barem altındaysa yalnızca en düşük desili tek paket barem fiyatı alır
  let baremPackageId: string | null = null;
  const barem = cfg.shipping.barem;
  if (barem && barem.splitPolicy === 'cheapest_one' && live.length > 1) {
    baremPackageId = [...live].sort((a, b) => a.desi - b.desi)[0].id;
  }

  return packages.map((pkg, idx) =>
    computePackage(pkg, rule, rates, settings, {
      orderGross,
      isFirstInGroup: idx === packages.findIndex((p) => !p.cancelled),
      baremAllowed: !barem || barem.splitPolicy === 'all' || live.length <= 1 || pkg.id === baremPackageId,
      splitCount: live.length,
    }));
}

function itemsGross(items: CostItem[]) {
  return items.reduce((s, i) => s + i.quantity * i.unitPriceGross, 0);
}

function computePackage(
  pkg: CostPackage,
  rule: FeeRule,
  rates: CarrierRates,
  st: CostSettings,
  g: { orderGross: number; isFirstInGroup: boolean; baremAllowed: boolean; splitCount: number },
): CostResult {
  const cfg = rule.config;
  const notes: string[] = [];
  const lines: CostLine[] = [];
  const speed = speedOf(pkg, cfg.sameDay?.cutoffHour ?? 14);
  const carrier = pkg.carrier || cfg.shipping.defaultCarrier;
  const ctx: Ctx = { pkg, speed, carrier, orderGross: g.orderGross };
  const feeRec = cfg.feeVatRecoverable;

  // --- Ciro ---
  const rawGross = itemsGross(pkg.items);
  const discount = Math.min(pkg.sellerDiscountGross ?? 0, rawGross);
  const k = rawGross > 0 ? 1 - discount / rawGross : 1;
  const salesVat = (i: CostItem) => cfg.salesVatOverride ?? i.vatRate;
  const itemLines = pkg.items.map((i) => {
    const gross = i.quantity * i.unitPriceGross * k;
    return { item: i, gross, net: gross / (1 + salesVat(i)) };
  });
  const itemsG = itemLines.reduce((s, x) => s + x.gross, 0);
  const itemsN = itemLines.reduce((s, x) => s + x.net, 0);
  const shipG = pkg.buyerShippingGross ?? 0;
  const shipN = shipG / (1 + (cfg.salesVatOverride ?? FEE_VAT));
  const revenueGross = pkg.cancelled ? 0 : itemsG + shipG;
  const revenueNet = pkg.cancelled ? 0 : itemsN + shipN;

  // --- Kargo (iptal/iade durumunda da hesaplanır) ---
  const shipping = shippingCost(pkg, rule, rates, ctx, g, notes);

  if (pkg.cancelled) {
    if (pkg.shippedAt && shipping) {
      lines.push(line('shipping_out', 'Kargo (gidiş)', 'shipping', shipping.net * 1.2, shipping.net * 0.2, true, shipping.label));
      lines.push(line('shipping_return', 'İade kargosu (dönüş)', 'shipping', shipping.net * 1.2, shipping.net * 0.2, true,
        'Varsayım: dönüş gidişle aynı tarife. 2026 itibarıyla iade kargo bedeli satıcıya ait.'));
      notes.push('İade/iptal: komisyon ve bedeller iade edildi, ürün stoğa döndü; kargo maliyeti kaldı.');
    } else {
      notes.push('Kargoya verilmeden iptal: maliyet oluşmadı.');
    }
    return finish(pkg, lines, notes, speed, 0, 0, 0, 'final');
  }

  // --- Komisyon ---
  const disc = cfg.commission.discount;
  const discActive = !!disc && (!disc.from || pkg.orderedAt >= disc.from) && (!disc.until || pkg.orderedAt <= disc.until + 'T23:59:59');
  let commissionBase = 0;
  let commissionAmount = 0;
  const rateUsed: number[] = [];
  for (const x of itemLines) {
    let rate = x.item.commissionRate ?? (x.item.category ? cfg.commission.categoryRates?.[x.item.category] : undefined) ?? cfg.commission.defaultRate;
    if (discActive) rate *= 1 - disc!.rate;
    rateUsed.push(rate);
    const shipShare = itemsG > 0 ? (x.gross / itemsG) : 0;
    let base = 0;
    switch (cfg.commission.basis) {
      case 'gross': base = x.gross; break;
      case 'net': base = x.net; break;
      case 'gross_plus_shipping': base = x.gross + shipG * shipShare; break;
      case 'net_plus_shipping': base = x.net + shipN * shipShare; break;
    }
    commissionBase += base;
    commissionAmount += base * rate;
  }
  if (pkg.actualCommissionNet != null) {
    const net = pkg.actualCommissionNet;
    const vat = cfg.commission.vat === 'none' ? 0 : net * FEE_VAT;
    lines.push(line('commission', 'Komisyon (pazaryeri bildirimi)', 'commission', net + vat, vat, feeRec));
  } else {
    const { gross, vat } = vatSplit(commissionAmount, cfg.commission.vat);
    const uniq = [...new Set(rateUsed.map((r) => (r * 100).toFixed(2)))];
    lines.push(line('commission', `Komisyon (%${uniq.join(' / %')})`, 'commission', gross, vat, feeRec,
      `${basisLabel(cfg.commission.basis)} ${r2(commissionBase)} ₺ × oran · ${vatLabel(cfg.commission.vat)}${discActive ? ` · ${disc!.label} uygulandı` : ''}`));
  }

  // --- Platform / hizmet bedelleri ---
  const units = pkg.items.reduce((s, i) => s + i.quantity, 0);
  for (const f of cfg.fees) {
    if (f.disabled) continue;
    if (f.per === 'order' && !g.isFirstInGroup) continue;
    if (!matches(f.when, ctx)) continue;
    const useAlt = f.alt && matches(f.alt.when, ctx);
    let amount = 0;
    if (f.kind === 'fixed') {
      const base = (useAlt ? f.alt!.amount : f.amount ?? 0) * (f.currency === 'USD' ? st.usdTry : 1);
      const count = f.per === 'unit' ? units : f.per === 'sku_month' ? pkg.items.filter((i) => i.firstSaleThisMonth).length : 1;
      if (count === 0) continue;
      amount = base * count;
    } else {
      const b = f.basis ?? 'gross';
      const base = b === 'gross' ? itemsG : b === 'net' ? itemsN : b === 'gross_plus_shipping' ? itemsG + shipG : itemsN + shipN;
      amount = base * (f.rate ?? 0);
    }
    const { gross, vat } = vatSplit(amount, f.vat);
    lines.push(line(f.code, useAlt ? f.alt!.label : f.label, 'fee', gross, vat, feeRec, f.note));
  }

  // --- Kargo ---
  if (shipping) {
    lines.push(line('shipping', 'Kargo', 'shipping', shipping.net * 1.2, shipping.net * 0.2, true, shipping.label));
  }

  // --- E-ticaret stopajı (%1, KDV hariç tutar üzerinden) ---
  if (cfg.stopaj.rate > 0) {
    const amt = revenueNet * cfg.stopaj.rate;
    lines.push({ code: 'stopaj', label: `E-ticaret stopajı (%${r2(cfg.stopaj.rate * 100)})`, group: 'tax', gross: amt, vat: 0, recoverable: false,
      cost: st.stopajAsCost ? amt : 0, note: 'Gelir/kurumlar vergisinden mahsup edilebilir' + (st.stopajAsCost ? '; ihtiyatlı olarak gider sayıldı.' : '; gider sayılmadı.') });
  }

  // --- Ürün maliyeti + ambalaj ---
  const costRecoverable = (cfg.salesVatOverride ?? 1) > 0 || st.exportCostVatRecoverable;
  const pNet = pkg.items.reduce((s, i) => s + i.quantity * i.unitCostNet, 0);
  const pVat = pkg.items.reduce((s, i) => s + i.quantity * i.unitCostNet * i.costVatRate, 0);
  lines.push(line('product_cost', 'Ürün maliyeti', 'product', pNet + pVat, pVat, costRecoverable));
  const packNet = pkg.items.reduce((s, i) => s + i.quantity * (i.packagingNet ?? 0), 0);
  if (packNet > 0) lines.push(line('packaging', 'Ambalaj', 'product', packNet * 1.2, packNet * 0.2, costRecoverable));
  if (!costRecoverable && pVat > 0) notes.push('İhracat satışı: alış KDV\'si gider sayıldı (KDV iadesi alınıyorsa Ayarlar\'dan değiştirin).');

  // --- Reklam ve iade/ceza riski (satış fiyatı üzerinden) ---
  if (st.adRate > 0) lines.push(line('ads', `Reklam (%${r2(st.adRate * 100)})`, 'other', itemsG * st.adRate, 0, false));
  if (st.returnRiskRate > 0) lines.push(line('return_risk', `İade/ceza riski (%${r2(st.returnRiskRate * 100)})`, 'other', itemsG * st.returnRiskRate, 0, false));

  if (speed.sameDayEligible && speed.sameDayMet === false) notes.push('Bugün Kargoda etiketine rağmen aynı gün kargoya verilmedi: indirimli hizmet bedeli ve hızlı barem kaybedildi.');
  else if (speed.fastEligible && speed.fastMet === false) notes.push('Termin süresi aşıldı: hızlı gönderim avantajları uygulanmadı.');

  const productCostGross = pNet + pVat;
  return finish(pkg, lines, notes, speed, revenueGross, revenueNet, productCostGross, pkg.shippedAt ? 'final' : 'estimate');
}

function finish(pkg: CostPackage, lines: CostLine[], notes: string[], speed: SpeedInfo, revenueGross: number, revenueNet: number,
  productCostGross: number, status: 'estimate' | 'final'): CostResult {
  const totals: Record<LineGroup, number> = { commission: 0, fee: 0, shipping: 0, tax: 0, product: 0, other: 0 };
  for (const l of lines) totals[l.group] += l.cost;
  const totalCost = lines.reduce((s, l) => s + l.cost, 0);
  const recVat = lines.reduce((s, l) => s + (l.recoverable ? l.vat : 0), 0);
  const netProfit = revenueNet - totalCost;
  return {
    packageId: pkg.id,
    status,
    revenueGross: r2(revenueGross),
    revenueNet: r2(revenueNet),
    outputVat: r2(revenueGross - revenueNet),
    lines: lines.map((l) => ({ ...l, gross: r2(l.gross), vat: r2(l.vat), cost: r2(l.cost) })),
    totals: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, r2(v)])) as Record<LineGroup, number>,
    totalCost: r2(totalCost),
    vatPayable: r2(revenueGross - revenueNet - recVat),
    netProfit: r2(netProfit),
    netProfitExact: netProfit,
    marginOnRevenue: revenueNet > 0 ? netProfit / revenueNet : 0,
    marginOnCost: productCostGross > 0 ? netProfit / productCostGross : 0,
    speed,
    notes,
  };
}

// ---------------------------------------------------------------------
// Kargo: barem altı / desi tablosu / paket bölme / elle girilen
// ---------------------------------------------------------------------
function shippingCost(
  pkg: CostPackage, rule: FeeRule, rates: CarrierRates, ctx: Ctx,
  g: { orderGross: number; baremAllowed: boolean; splitCount: number }, notes: string[],
): { net: number; label: string } | null {
  const sh = rule.config.shipping;
  if (sh.payer === 'buyer') return null;
  if (pkg.actualShippingNet != null) return { net: pkg.actualShippingNet, label: 'Pazaryerinin faturaladığı tutar' };

  const carrier = ctx.carrier;
  const desi = Math.max(0, Math.ceil((pkg.desi || 0) - 1e-9));
  const posta = (n: number) => n * (1 + (sh.postaHizmetRate ?? 0));
  const postaNote = sh.postaHizmetRate ? ` + %${r2(sh.postaHizmetRate * 100)} posta hizmet bedeli` : '';

  // 1) Barem altı
  if (sh.barem) {
    const b = sh.barem;
    const tier = b.tiers.find((t) => g.orderGross < t.upTo);
    if (tier) {
      const fastOk = ctx.speed.fastEligible && (ctx.speed.fastMet ?? true);
      const desiOk = b.maxDesi === undefined || desi <= b.maxDesi;
      const carrierOk = !b.carriers || b.carriers.includes(carrier);
      if (!g.baremAllowed) {
        notes.push(`Paket bölme: sipariş barem altında ama bu paket desi bazlı ücretlendirildi (yalnızca en düşük desili 1 paket barem alır).`);
      } else if (!desiOk) {
        notes.push(`${desi} desi, barem sınırını (${b.maxDesi} desi) aşıyor: desi tarifesi uygulandı.`);
      } else if (!carrierOk) {
        notes.push(`${carrier} barem desteğine dahil değil (${b.carriers!.join(', ')}): desi tarifesi uygulandı.`);
      } else if (b.requiresFast && !fastOk) {
        notes.push('Barem için hızlı gönderim (0–1 gün) şartı sağlanmadı: desi tarifesi uygulandı.');
      } else {
        const fastPrice = fastOk ? tier.fast?.[carrier] : undefined;
        const price = fastPrice ?? tier.standard?.[carrier];
        if (price !== undefined) {
          const kind = fastPrice !== undefined ? 'hızlı gönderim' : 'standart';
          return { net: posta(price), label: `Barem altı (${kind}, sipariş < ${tier.upTo} ₺) · ${carrier}${postaNote}` };
        }
        notes.push(`${carrier} için barem fiyatı tanımlı değil: desi tarifesi uygulandı.`);
      }
    }
  }

  // 2) Desi tablosu
  const table = rates[carrier];
  if (table && desi < table.length && table[desi] != null) {
    return { net: posta(table[desi]), label: `${carrier} · ${desi} desi tarifesi${postaNote}${g.splitCount > 1 ? ' (paket bölme)' : ''}` };
  }

  // 3) Elle girilen / varsayılan
  const manual = pkg.manualShippingNet ?? sh.fallbackFlat;
  if (manual != null) {
    notes.push(table
      ? `${carrier} tablosu ${table.length - 1} desiye kadar; ${desi} desi için elle girilen tutar kullanıldı.`
      : `${carrier} için kargo tablosu yok: elle girilen/varsayılan kargo maliyeti kullanıldı (Ayarlar > Kargo Tabloları).`);
    return { net: manual, label: `Elle girilen kargo maliyeti · ${carrier}` };
  }
  notes.push(`${carrier} için kargo tarifesi bulunamadı ve varsayılan tutar girilmemiş: kargo 0 kabul edildi.`);
  return { net: 0, label: 'Kargo tarifesi eksik' };
}

const basisLabel = (b: string) => ({ gross: 'KDV dahil satış', net: 'KDV hariç satış', gross_plus_shipping: 'KDV dahil satış + kargo', net_plus_shipping: 'KDV hariç satış + kargo' } as Record<string, string>)[b] ?? b;
const vatLabel = (v: VatMode) => (v === 'included' ? 'oran KDV dahil' : v === 'added' ? '+%20 KDV' : 'KDV yok');

export function feeLabel(f: FeeDef) {
  return f.kind === 'fixed' ? `${f.amount} ${f.currency ?? 'TRY'} ${vatLabel(f.vat)}` : `%${r2((f.rate ?? 0) * 100)} ${vatLabel(f.vat)}`;
}
