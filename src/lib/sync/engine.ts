import 'server-only';
import { db, must } from '@/lib/supabase/server';
import { decryptSecret } from '@/lib/crypto';
import { createAdapter } from '@/lib/marketplaces/registry';
import { MARKETPLACES, MARKETPLACE_META, ORDER_PREFIX, ORDER_STATUS_META, isMarketplace, type MarketplaceName, type OrderStatus } from '@/lib/marketplaces/meta';
import type { AdapterResult, MarketplaceAdapter, NormalizedOrder, ProductPayload, StockUpdate } from '@/lib/marketplaces/types';
import { errorMessage } from '@/lib/marketplaces/http';
import { computeOrderCosts, loadSettings } from '@/lib/fees/service';

/* =====================================================================
 * Senkronizasyon Motoru
 * - Ortak stok havuzu: products.total_stock tek gerçek kaynak.
 * - Sipariş geldiğinde apply_order (SQL, atomik + idempotent) stok düşer,
 *   ardından pushStock güncel net stoğu ürünün yayında olduğu TÜM pazaryerlerine gönderir.
 * - reconcile(): gönderilemeyen / sapan stokları ve onay bekleyen ilanları periyodik düzeltir.
 * ===================================================================== */

export interface ProductRow {
  id: string; sku: string; barcode: string; title: string; description: string; category: string; brand: string;
  vat_rate: number; price: number; list_price: number | null; cost_price: number; total_stock: number;
  low_stock_threshold: number; image_url: string | null; images: string[]; marketplace_attributes: Record<string, Record<string, unknown>>;
}

interface CredentialRow {
  marketplace_name: string; api_key: string; api_secret: string; seller_id: string; is_active: boolean;
  extra_config: Record<string, unknown>; last_order_sync_at: string | null;
}

type LogLevel = 'info' | 'success' | 'warning' | 'error';
type LogKind = 'order' | 'stock' | 'listing' | 'system';

export async function log(level: LogLevel, kind: LogKind, marketplace: MarketplaceName | null, message: string, context?: unknown) {
  const { error } = await db().from('sync_logs').insert({ level, kind, marketplace_name: marketplace, message, context: context ?? null });
  if (error) console.error('[sync_logs]', error.message);
}

// ---------------------------------------------------------------------
// Adaptör yükleme
// ---------------------------------------------------------------------
export async function loadAdapters(): Promise<Map<MarketplaceName, { adapter: MarketplaceAdapter | null; row: CredentialRow }>> {
  const rows = must(await db().from('marketplace_credentials').select('*')) as CredentialRow[];
  const settings = await loadSettings().catch(() => null);
  const map = new Map<MarketplaceName, { adapter: MarketplaceAdapter | null; row: CredentialRow }>();
  for (const name of MARKETPLACES) {
    const row = rows.find((r) => r.marketplace_name === name) ?? {
      marketplace_name: name, api_key: '', api_secret: '', seller_id: '', is_active: false, extra_config: {}, last_order_sync_at: null,
    };
    let secret = '';
    try { secret = decryptSecret(row.api_secret); } catch (e) { console.error(e); }
    const extra = { ...(row.extra_config ?? {}), __fx: settings?.fx ?? {} };
    const adapter = createAdapter(name, { apiKey: row.api_key, apiSecret: secret, sellerId: row.seller_id, extra }, row.is_active, {
      saveExtra: async (next) => { await db().from('marketplace_credentials').update({ extra_config: next }).eq('marketplace_name', name); },
    });
    map.set(name, { adapter, row });
  }
  return map;
}

export async function getAdapter(name: MarketplaceName): Promise<MarketplaceAdapter> {
  const a = (await loadAdapters()).get(name)?.adapter;
  if (!a) throw new Error(`${MARKETPLACE_META[name].label} bağlı değil. Ayarlar > API Bağlantıları'ndan bağlayın.`);
  return a;
}

/** Bağlı pazaryerlerinin listesi */
export async function connectedMarketplaces(): Promise<MarketplaceName[]> {
  return [...(await loadAdapters()).entries()].filter(([, v]) => v.adapter).map(([k]) => k);
}

export interface ListingOverrides { price_override?: number | null; handling_days?: number | null; same_day_tag?: boolean | null; fast_tag?: boolean | null }

/** Pazaryerine gönderilecek ürün: görseller kullanıcının sıraladığı düzende, fiyat varsa pazaryerine özel fiyat */
export function toPayload(p: ProductRow, mp: MarketplaceName, l?: ListingOverrides | null): ProductPayload {
  const images = [...(p.images ?? []), ...(p.image_url ? [p.image_url] : [])].filter((v, i, a) => v && a.indexOf(v) === i);
  const price = l?.price_override != null ? Number(l.price_override) : Number(p.price);
  return {
    sku: p.sku, barcode: p.barcode, title: p.title, description: p.description, category: p.category, brand: p.brand,
    vatRate: Number(p.vat_rate), price, listPrice: Math.max(price, Number(p.list_price ?? p.price)), costPrice: Number(p.cost_price),
    stock: p.total_stock, images,
    attributes: {
      ...(l?.handling_days != null ? { handlingDays: l.handling_days } : {}),
      ...(l?.same_day_tag ? { sameDay: true } : {}),
      ...(l?.fast_tag ? { fastDelivery: true } : {}),
      ...(p.marketplace_attributes?.[mp] ?? {}),
    },
  };
}

// ---------------------------------------------------------------------
// Çapraz yayınlama
// ---------------------------------------------------------------------
export async function publishProduct(productId: string, marketplaces: MarketplaceName[]): Promise<Record<string, AdapterResult>> {
  const product = must(await db().from('products').select('*').eq('id', productId).single()) as ProductRow;
  const adapters = await loadAdapters();
  const results: Record<string, AdapterResult> = {};
  const existing = must(await db().from('marketplace_listings').select('marketplace_name, price_override, handling_days, same_day_tag, fast_tag').eq('product_id', productId)) as Array<ListingOverrides & { marketplace_name: string }>;

  await Promise.all(marketplaces.map(async (mp) => {
    const adapter = adapters.get(mp)?.adapter;
    if (!adapter) {
      results[mp] = { ok: false, status: 'error', message: `${MARKETPLACE_META[mp].label} bağlı değil — Ayarlar > API Bağlantıları'ndan bağlayın.` };
      return;
    }
    await db().from('marketplace_listings').upsert(
      { product_id: productId, marketplace_name: mp, listing_status: 'pending', sync_error_message: null },
      { onConflict: 'product_id,marketplace_name' });
    let res: AdapterResult;
    try {
      res = await adapter.createProduct(toPayload(product, mp, existing.find((e) => e.marketplace_name === mp)));
    } catch (e) {
      res = { ok: false, status: 'error', message: errorMessage(e) };
    }
    results[mp] = res;
    await db().from('marketplace_listings').update({
      listing_status: res.ok ? (res.status ?? 'active') : 'error',
      external_product_id: res.externalId ?? null,
      sync_ref: res.ref ?? null,
      sync_error_message: res.ok ? null : res.message,
      last_synced_at: new Date().toISOString(),
      last_pushed_stock: res.ok ? product.total_stock : null,
    }).eq('product_id', productId).eq('marketplace_name', mp);
    await log(res.ok ? 'success' : 'error', 'listing', mp,
      `${MARKETPLACE_META[mp].label} ← ${product.sku} ${res.ok ? (res.status === 'pending' ? 'onaya gönderildi' : 'yayınlandı') : 'yayınlanamadı'}: ${res.message}`);
  }));
  return results;
}

// ---------------------------------------------------------------------
// Ortak stok → tüm pazaryerleri
// ---------------------------------------------------------------------
export interface PushSummary { [mp: string]: { ok: boolean; count: number; message: string } }

export async function pushStock(productIds: string[], sourceMarketplace: MarketplaceName | null = null): Promise<PushSummary> {
  if (!productIds.length) return {};
  if (productIds.length > 100) {
    const merged: PushSummary = {};
    for (let i = 0; i < productIds.length; i += 100) Object.assign(merged, await pushStock(productIds.slice(i, i + 100), sourceMarketplace));
    return merged;
  }
  const listings = must(await db()
    .from('marketplace_listings')
    .select('id, marketplace_name, external_product_id, price_override, product:products(id, sku, barcode, price, list_price, total_stock)')
    .in('product_id', productIds)
    .eq('listing_status', 'active')) as unknown as Array<{
      id: string; marketplace_name: string; external_product_id: string | null; price_override: number | null;
      product: { id: string; sku: string; barcode: string; price: number; list_price: number | null; total_stock: number };
    }>;

  const byMp = new Map<MarketplaceName, typeof listings>();
  for (const l of listings) {
    if (!isMarketplace(l.marketplace_name)) continue;
    byMp.set(l.marketplace_name, [...(byMp.get(l.marketplace_name) ?? []), l]);
  }
  if (!byMp.size) return {};

  const adapters = await loadAdapters();
  const summary: PushSummary = {};

  await Promise.all([...byMp.entries()].map(async ([mp, ls]) => {
    const adapter = adapters.get(mp)?.adapter;
    if (!adapter) return; // bağlı olmayan pazaryerine gönderim yapılmaz
    const items: StockUpdate[] = ls.map((l) => {
      const price = l.price_override != null ? Number(l.price_override) : Number(l.product.price);
      return {
        sku: l.product.sku, barcode: l.product.barcode, externalProductId: l.external_product_id,
        quantity: Math.max(0, l.product.total_stock), price, listPrice: Math.max(price, Number(l.product.list_price ?? l.product.price)),
      };
    });
    let res: AdapterResult;
    try {
      res = await adapter.updateStock(items);
    } catch (e) {
      res = { ok: false, message: errorMessage(e) };
    }
    const now = new Date().toISOString();
    await Promise.all(ls.map((l) => db().from('marketplace_listings').update(res.ok
      ? { last_pushed_stock: l.product.total_stock, last_synced_at: now, sync_error_message: null }
      : { sync_error_message: `Stok gönderilemedi: ${res.message}`, last_synced_at: now }).eq('id', l.id)));
    summary[mp] = { ok: res.ok, count: items.length, message: res.message };
    const detail = items.map((i) => `${i.sku} = ${i.quantity}`).join(', ');
    await log(res.ok ? 'success' : 'error', 'stock', mp,
      res.ok
        ? `${MARKETPLACE_META[mp].label} ← stok güncellendi: ${detail}${mp === sourceMarketplace ? ' (kaynak pazaryeri doğrulama)' : ''}`
        : `${MARKETPLACE_META[mp].label} ← stok GÖNDERİLEMEDİ (${detail}): ${res.message}. Cron ile tekrar denenecek.`);
  }));
  return summary;
}

// ---------------------------------------------------------------------
// Sipariş içe alma (polling, webhook ve simülasyon aynı yolu kullanır)
// ---------------------------------------------------------------------
export async function ingestOrder(mp: MarketplaceName, o: NormalizedOrder) {
  const res = must(await db().rpc('apply_order', {
    p_marketplace: mp,
    p_external_order_id: o.externalOrderId,
    p_customer_name: o.customerName,
    p_status: o.status,
    p_order_date: o.orderDate,
    p_items: o.items.map((i) => ({ sku: i.sku, ...(i.barcode ? { barcode: i.barcode } : {}), title: i.title, quantity: i.quantity, unit_price: i.unitPrice,
      ...(i.commissionRate != null ? { commission_rate: i.commissionRate } : {}) })),
    p_total_amount: o.totalAmount,
    p_raw: o.raw ?? null,
  })) as { order_id: string; is_new: boolean; affected_product_ids: string[]; unmatched_skus: string[] };

  await updateShipmentFields(res.order_id, o);

  if (res.is_new) {
    const summary = o.items.map((i) => `${i.quantity}x ${i.sku}`).join(', ');
    await log('info', 'order', mp, `${MARKETPLACE_META[mp].label} → yeni sipariş #${o.externalOrderId} (${summary}) — ${o.customerName}`);
  } else if (res.affected_product_ids.length) {
    await log('warning', 'order', mp, `${MARKETPLACE_META[mp].label} → #${o.externalOrderId} durumu: ${ORDER_STATUS_META[o.status].label}, stok iade edildi.`);
  }
  if (res.unmatched_skus?.length) {
    await log('warning', 'order', mp, `#${o.externalOrderId}: panelde eşleşmeyen SKU/barkod: ${res.unmatched_skus.join(', ')}. Stok düşülmedi.`);
  }
  if (res.affected_product_ids.length) {
    const prods = must(await db().from('products').select('sku, total_stock, low_stock_threshold').in('id', res.affected_product_ids)) as Array<{ sku: string; total_stock: number; low_stock_threshold: number }>;
    for (const p of prods) {
      await log(p.total_stock < p.low_stock_threshold ? 'warning' : 'info', 'stock', null,
        `${p.sku}: ortak stok → ${p.total_stock}${p.total_stock < p.low_stock_threshold ? ' ⚠ KRİTİK SEVİYE' : ''}${p.total_stock < 0 ? ' (aşırı satış!)' : ''}`);
    }
    await pushStock(res.affected_product_ids, mp);
  }
  await recompute([res.order_id]);
  return res;
}

/** Pazaryerinin bildirdiği kargo/termin/tutar bilgilerini siparişe yazar (boş gelenler mevcut değeri ezmez) */
async function updateShipmentFields(orderId: string, o: NormalizedOrder) {
  const u: Record<string, unknown> = {};
  const sh = o.shipment;
  if (sh?.carrier) u.carrier = sh.carrier;
  if (sh?.desi != null) u.desi = sh.desi;
  if (sh?.shippedAt) u.shipped_at = sh.shippedAt;
  if (sh?.sameDay != null) u.marketplace_same_day = sh.sameDay;
  if (sh?.fast != null) u.marketplace_fast = sh.fast;
  if (sh?.microExport != null) u.micro_export = sh.microExport;
  if (sh?.kiosk != null) u.kiosk = sh.kiosk;
  if (o.actualCommissionNet != null) u.actual_commission_net = o.actualCommissionNet;
  if (o.actualShippingNet != null) u.actual_shipping_net = o.actualShippingNet;
  if (o.buyerShippingGross != null) u.buyer_shipping_gross = o.buyerShippingGross;
  if (o.sellerDiscountGross != null) u.seller_discount_gross = o.sellerDiscountGross;
  if (o.currency) u.currency = o.currency;
  if (o.fxRate) u.fx_rate = o.fxRate;
  if (Object.keys(u).length) await db().from('orders').update(u).eq('id', orderId);
}

/** Maliyet/kâr hesabını çalıştırır; hata sipariş akışını durdurmaz, günlüğe yazılır */
export async function recompute(orderIds: string[]) {
  try {
    await computeOrderCosts(orderIds);
  } catch (e) {
    await log('error', 'system', null, `Kârlılık hesabı yapılamadı: ${errorMessage(e)}`);
  }
}

/** Siparişi kargoya verildi olarak işaretler (Bugün Kargoda / termin kontrolü bu zamana göre yapılır) */
export async function markShipped(orderId: string, at?: string) {
  const order = must(await db().from('orders').select('external_order_id, marketplace_name, status').eq('id', orderId).single()) as { external_order_id: string; marketplace_name: MarketplaceName; status: OrderStatus };
  if (order.status === 'cancelled') throw new Error('İptal edilmiş sipariş kargoya verilemez.');
  const shippedAt = at ?? new Date().toISOString();
  const u: Record<string, unknown> = { shipped_at: shippedAt };
  if (order.status === 'new' || order.status === 'preparing') u.status = 'shipped';
  must(await db().from('orders').update(u).eq('id', orderId).select('id'));
  await recompute([orderId]);
  const cost = must(await db().from('order_costs').select('net_profit, same_day_eligible, same_day_met, fast_eligible, fast_met').eq('order_id', orderId).maybeSingle()) as
    { net_profit: number; same_day_eligible: boolean; same_day_met: boolean | null; fast_eligible: boolean; fast_met: boolean | null } | null;
  const speed = cost?.same_day_eligible ? (cost.same_day_met ? 'aynı gün ✓' : 'aynı gün kaçırıldı ✗') : cost?.fast_eligible ? (cost.fast_met ? 'termin içinde ✓' : 'termin aşıldı ✗') : 'standart';
  await log(cost?.same_day_met === false || cost?.fast_met === false ? 'warning' : 'success', 'order', order.marketplace_name,
    `#${order.external_order_id} kargoya verildi (${speed}) — net kâr ${cost?.net_profit ?? '-'} ₺`);
  return cost;
}

export async function changeOrderStatus(orderId: string, status: OrderStatus) {
  const res = must(await db().rpc('set_order_status', { p_order_id: orderId, p_status: status })) as { affected_product_ids: string[] };
  const order = must(await db().from('orders').select('external_order_id, marketplace_name').eq('id', orderId).single()) as { external_order_id: string; marketplace_name: MarketplaceName };
  await log(status === 'cancelled' ? 'warning' : 'info', 'order', order.marketplace_name,
    `#${order.external_order_id} durumu → ${ORDER_STATUS_META[status].label}${res.affected_product_ids.length ? ' (stok havuza iade edildi)' : ''}`);
  if (res.affected_product_ids.length) await pushStock(res.affected_product_ids, null);
  await recompute([orderId]);
  return res;
}

// ---------------------------------------------------------------------
// Periyodik sipariş çekme (cron) — webhook olmasa da hiçbir sipariş kaçmaz
// ---------------------------------------------------------------------
export async function pollOrders(only?: MarketplaceName[]) {
  const adapters = await loadAdapters();
  const summary: Record<string, { fetched: number; created: number; error?: string }> = {};
  for (const [mp, { adapter, row }] of adapters) {
    if (only && !only.includes(mp)) continue;
    if (!adapter || adapter.mode === 'demo') continue;
    const until = new Date();
    const since = row.last_order_sync_at
      ? new Date(new Date(row.last_order_sync_at).getTime() - 15 * 60_000) // 15 dk örtüşme: gecikmeli siparişler kaçmasın
      : new Date(until.getTime() - 3 * 86_400_000);
    try {
      const orders = await adapter.fetchOrders(since, until);
      let created = 0;
      for (const o of orders) {
        const r = await ingestOrder(mp, o);
        if (r.is_new) created++;
      }
      await db().from('marketplace_credentials').update({ last_order_sync_at: until.toISOString() }).eq('marketplace_name', mp);
      summary[mp] = { fetched: orders.length, created };
    } catch (e) {
      summary[mp] = { fetched: 0, created: 0, error: errorMessage(e) };
      await log('error', 'order', mp, `${MARKETPLACE_META[mp].label} sipariş çekme hatası: ${errorMessage(e)}`);
    }
  }
  return summary;
}

// ---------------------------------------------------------------------
// Mutabakat: onay bekleyen ilanlar + gönderilemeyen/sapan stoklar
// ---------------------------------------------------------------------
export async function reconcile() {
  const adapters = await loadAdapters();

  const pending = must(await db().from('marketplace_listings')
    .select('id, marketplace_name, sync_ref, product:products(sku, barcode)')
    .eq('listing_status', 'pending').not('sync_ref', 'is', null).limit(100)) as unknown as Array<{ id: string; marketplace_name: MarketplaceName; sync_ref: string; product: { sku: string; barcode: string } }>;
  let approved = 0;
  for (const l of pending) {
    const ad = adapters.get(l.marketplace_name)?.adapter;
    if (!ad) continue;
    const res = await ad.checkListing(l.sync_ref, l.product);
    if (res.status && res.status !== 'pending') {
      await db().from('marketplace_listings').update({
        listing_status: res.status, sync_error_message: res.ok ? null : res.message, last_synced_at: new Date().toISOString(),
      }).eq('id', l.id);
      await log(res.ok ? 'success' : 'error', 'listing', l.marketplace_name, `${MARKETPLACE_META[l.marketplace_name].label}: ${l.product.sku} — ${res.message}`);
      if (res.ok) approved++;
    }
  }

  const listings = must(await db().from('marketplace_listings')
    .select('product_id, last_pushed_stock, sync_error_message, product:products(total_stock)')
    .eq('listing_status', 'active')) as unknown as Array<{ product_id: string; last_pushed_stock: number | null; sync_error_message: string | null; product: { total_stock: number } }>;
  const drift = [...new Set(listings
    .filter((l) => l.sync_error_message || l.last_pushed_stock === null || l.last_pushed_stock !== l.product.total_stock)
    .map((l) => l.product_id))];
  if (drift.length) await pushStock(drift, null);

  return { pendingChecked: pending.length, approved, stockResynced: drift.length };
}

// ---------------------------------------------------------------------
// Demo: sipariş simülasyonu (gerçek sipariş akışıyla birebir aynı yol)
// ---------------------------------------------------------------------
const FIRST = ['Ayşe', 'Mehmet', 'Zeynep', 'Ahmet', 'Elif', 'Mustafa', 'Fatma', 'Emre', 'Selin', 'Burak', 'Merve', 'Can', 'Deniz', 'Hakan', 'Gizem'];
const LAST = ['Yılmaz', 'Kaya', 'Demir', 'Şahin', 'Çelik', 'Yıldız', 'Aydın', 'Öztürk', 'Arslan', 'Doğan', 'Kılıç', 'Koç'];
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];

export async function simulateOrder(mp: MarketplaceName, productId?: string, quantity?: number) {
  let product: ProductRow | null = null;
  if (productId) {
    product = must(await db().from('products').select('*').eq('id', productId).single()) as ProductRow;
  } else {
    const listed = must(await db().from('marketplace_listings').select('product_id').eq('marketplace_name', mp).eq('listing_status', 'active')) as Array<{ product_id: string }>;
    const ids = listed.map((l) => l.product_id);
    if (!ids.length) throw new Error(`${MARKETPLACE_META[mp].at} aktif ilan yok. Önce bir ürün yayınlayın.`);
    const candidates = must(await db().from('products').select('*').in('id', ids).gt('total_stock', 0)) as ProductRow[];
    if (!candidates.length) throw new Error(`${MARKETPLACE_META[mp].at} stoğu olan ürün yok.`);
    product = pick(candidates);
  }
  const qty = Math.max(1, quantity ?? Math.min(product.total_stock || 1, 1 + Math.floor(Math.random() * 2)));
  const prefix = ORDER_PREFIX[mp];
  const order: NormalizedOrder = {
    externalOrderId: `${prefix}${Date.now().toString().slice(-10)}${Math.floor(Math.random() * 90 + 10)}`,
    customerName: `${pick(FIRST)} ${pick(LAST)}`,
    totalAmount: Number(product.price) * qty,
    status: 'new',
    orderDate: new Date().toISOString(),
    items: [{ sku: product.sku, barcode: product.barcode, title: product.title, quantity: qty, unitPrice: Number(product.price) }],
    raw: { simulated: true },
  };
  const res = await ingestOrder(mp, order);
  return { ...res, externalOrderId: order.externalOrderId, sku: product.sku, quantity: qty };
}
