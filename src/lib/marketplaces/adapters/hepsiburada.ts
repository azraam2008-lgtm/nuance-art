import type { OrderStatus } from '../meta';
import type {
  AdapterResult, CategoryOption, MarketplaceAdapter, MarketplaceCredentials, NormalizedOrder, OrderStatusUpdate, ProductPayload, RemoteProduct, StockUpdate,
} from '../types';
import { basicAuth, cachedCategories, chunk, errorMessage, flattenCategories, notSupported, num, rec, recs, request, searchIn, str } from '../http';

/**
 * Hepsiburada Marketplace API adaptörü.
 * Kimlik doğrulama: Basic base64(merchantId:secretKey) + "User-Agent: {entegratör kullanıcı adı}"
 * Servisler farklı alt alan adlarındadır (canlı / "-sit" test ortamı):
 *   listing  → https://listing-external.hepsiburada.com   (stok/fiyat, ilan listesi)
 *   product  → https://mpop.hepsiburada.com               (katalog ürün yükleme)
 *   oms      → https://oms-external.hepsiburada.com       (siparişler)
 * extra_config: { listingBaseUrl?, productBaseUrl?, omsBaseUrl?, defaultCategoryId?, stockUploadPath? }
 */
export class HepsiburadaAdapter implements MarketplaceAdapter {
  readonly name = 'hepsiburada' as const;
  readonly mode = 'live' as const;
  private readonly listingBase: string;
  private readonly productBase: string;
  private readonly omsBase: string;

  constructor(private readonly c: MarketplaceCredentials) {
    this.listingBase = (str(c.extra.listingBaseUrl) || 'https://listing-external.hepsiburada.com').replace(/\/$/, '');
    this.productBase = (str(c.extra.productBaseUrl) || 'https://mpop.hepsiburada.com').replace(/\/$/, '');
    this.omsBase = (str(c.extra.omsBaseUrl) || 'https://oms-external.hepsiburada.com').replace(/\/$/, '');
  }

  private get headers() {
    return { Authorization: basicAuth(this.c.sellerId, this.c.apiSecret), 'User-Agent': this.c.apiKey || 'NuanceArt' };
  }
  private get mid() { return encodeURIComponent(this.c.sellerId); }

  async testConnection(): Promise<AdapterResult> {
    try {
      const res = await request<{ totalCount?: number }>(
        `${this.listingBase}/listings/merchantid/${this.mid}?offset=0&limit=1`, { headers: this.headers, retries: 0 });
      return { ok: true, message: `Bağlantı başarılı. ${res?.totalCount ?? 0} ilan bulundu.` };
    } catch (e) {
      return { ok: false, message: errorMessage(e) };
    }
  }

  async createProduct(p: ProductPayload): Promise<AdapterResult> {
    const a = p.attributes;
    const categoryId = num(a.categoryId ?? this.c.extra.defaultCategoryId);
    if (!categoryId) return { ok: false, status: 'error', message: 'Hepsiburada kategori ID gerekli.' };
    const attributes: Record<string, unknown> = {
      merchantSku: p.sku,
      VaryantGroupID: p.groupCode,
      Barcode: p.barcode,
      UrunAdi: p.title,
      UrunAciklamasi: p.description || p.title,
      Marka: p.brand || str(a.brand) || 'Markasız',
      GarantiSuresi: num(a.warrantyMonths, 0),
      kg: str(a.desi ?? 1),
      tax_vat_rate: String(p.vatRate),
      price: p.price.toFixed(2).replace('.', ','),
      stock: String(Math.max(0, p.stock)),
      ...(typeof a.extraAttributes === 'object' && a.extraAttributes ? (a.extraAttributes as Record<string, unknown>) : {}),
    };
    p.images.slice(0, 5).forEach((url, i) => { attributes[`Image${i + 1}`] = url; });
    const payload = [{ categoryId, merchant: this.c.sellerId, attributes }];
    try {
      const form = new FormData();
      form.append('file', new Blob([JSON.stringify(payload)], { type: 'application/json' }), 'products.json');
      const res = await request<{ success?: boolean; data?: { trackingId?: string }; message?: string }>(
        `${this.productBase}/product/api/products/import`, { method: 'POST', headers: this.headers, body: form });
      const trackingId = res?.data?.trackingId ?? null;
      return { ok: true, status: 'pending', externalId: p.sku, ref: trackingId, message: `Katalog onayına gönderildi (trackingId: ${trackingId ?? '-'}).` };
    } catch (e) {
      return { ok: false, status: 'error', message: errorMessage(e) };
    }
  }

  async checkListing(ref: string): Promise<AdapterResult> {
    try {
      const res = await request<{ data?: Array<{ productStatus?: string; validationResults?: Array<{ message?: string }> }> }>(
        `${this.productBase}/product/api/products/status/${encodeURIComponent(ref)}`, { headers: this.headers });
      const item = res?.data?.[0];
      const st = str(item?.productStatus).toLowerCase();
      if (st.includes('reject') || st.includes('fail')) {
        return { ok: false, status: 'error', message: (item?.validationResults ?? []).map((v) => v.message).join('; ') || 'Hepsiburada reddetti.' };
      }
      if (st.includes('match') || st.includes('approved') || st.includes('satış')) return { ok: true, status: 'active', message: 'Hepsiburada onayladı.' };
      return { ok: true, status: 'pending', message: `Durum: ${item?.productStatus ?? 'işleniyor'}` };
    } catch (e) {
      return { ok: false, status: 'pending', message: errorMessage(e) };
    }
  }

  async updateStock(items: StockUpdate[]): Promise<AdapterResult> {
    const path = (str(this.c.extra.stockUploadPath) || '/listings/merchantid/{merchantId}/stock-uploads').replace('{merchantId}', this.mid);
    try {
      const ids: string[] = [];
      for (const part of chunk(items, 4000)) {
        const res = await request<{ id?: string }>(`${this.listingBase}${path}`, {
          method: 'POST', headers: this.headers,
          json: part.map((i) => ({
            ...(i.externalProductId && i.externalProductId !== i.sku ? { hepsiburadaSku: i.externalProductId } : {}),
            merchantSku: i.sku,
            availableStock: Math.max(0, i.quantity),
          })),
        });
        if (res?.id) ids.push(res.id);
      }
      return { ok: true, message: `${items.length} ürün stoğu gönderildi.`, ref: ids.join(',') || null };
    } catch (e) {
      return { ok: false, message: errorMessage(e) };
    }
  }

  async fetchOrders(since: Date, until: Date): Promise<NormalizedOrder[]> {
    const lines: HbLine[] = [];
    const fmt = (d: Date) => d.toISOString().slice(0, 19);
    const q = (offset: number) => new URLSearchParams({ offset: String(offset), limit: '100', beginDate: fmt(since), endDate: fmt(until) });
    // Ödemesi tamamlanmış (yeni) siparişler
    for (let offset = 0; offset < 10_000; offset += 100) {
      const res = await request<{ items?: HbLine[]; totalCount?: number }>(`${this.omsBase}/orders/merchantid/${this.mid}?${q(offset)}`, { headers: this.headers });
      lines.push(...(res?.items ?? []));
      if ((res?.items?.length ?? 0) < 100) break;
    }
    // İptal edilen siparişler
    try {
      const res = await request<{ items?: HbLine[] }>(`${this.omsBase}/orders/merchantid/${this.mid}/cancelled?${q(0)}`, { headers: this.headers });
      lines.push(...(res?.items ?? []).map((l) => ({ ...l, status: 'Cancelled' })));
    } catch { /* iptal servisi yetkisi yoksa yeni siparişlerle devam */ }

    const grouped = new Map<string, HbLine[]>();
    for (const l of lines) {
      const key = str(l.orderNumber || l.orderId);
      if (!key) continue;
      grouped.set(key, [...(grouped.get(key) ?? []), l]);
    }
    return [...grouped.entries()].map(([orderNumber, ls]) => {
      const first = ls[0];
      const items = ls.map((l) => ({
        sku: str(l.merchantSku || l.sku), barcode: str(l.barcode), title: str(l.productName || l.name),
        quantity: num(l.quantity, 1), unitPrice: num(l.unitPrice ?? l.price),
      }));
      const status = ls.some((l) => str(l.status).toLowerCase().includes('cancel')) ? 'cancelled' : mapHbStatus(str(first.status));
      return {
        externalOrderId: orderNumber,
        customerName: str(first.customerName || first.customer?.name || first.shippingAddress?.name),
        totalAmount: ls.reduce((s, l) => s + num(l.totalPrice, num(l.unitPrice ?? l.price) * num(l.quantity, 1)), 0),
        status,
        orderDate: new Date(str(first.orderDate) || Date.now()).toISOString(),
        items,
        raw: ls,
      } satisfies NormalizedOrder;
    });
  }

  async fetchProducts(page: number, size: number): Promise<RemoteProduct[]> {
    const res = await request<{ listings?: Array<Record<string, unknown>> }>(
      `${this.listingBase}/listings/merchantid/${this.mid}?offset=${page * size}&limit=${size}`, { headers: this.headers });
    return (res?.listings ?? []).map((l) => ({
      externalId: str(l.hepsiburadaSku), sku: str(l.merchantSku), barcode: str(l.merchantSku), title: str(l.merchantSku),
      description: '', category: '', brand: '', vatRate: 20, price: num(l.price), listPrice: num(l.price), costPrice: 0,
      stock: num(l.availableStock), images: [], attributes: {},
    }));
  }

  /**
   * Sipariş durumu → Hepsiburada.
   *  Hazırlanıyor → kalemler paketlenir (paket oluşturma). İptal → satıcı iptali (kalem bazında).
   *  Kargoda / Teslim edildi: HepsiJET ve anlaşmalı kargolar bu bilgiyi Hepsiburada'ya kendisi iletir.
   */
  async updateOrderStatus(u: OrderStatusUpdate): Promise<AdapterResult> {
    const lines = recs(u.raw).map((l) => ({ id: str(l.id ?? l.lineItemId), quantity: num(l.quantity, 1) })).filter((l) => l.id);
    if (!lines.length && (u.status === 'preparing' || u.status === 'cancelled')) return { ok: false, message: 'Hepsiburada sipariş kalemleri bulunamadı (sipariş yeniden senkronlanmalı).' };
    try {
      switch (u.status) {
        case 'preparing': {
          const res = await request<{ packageNumber?: string }>(`${this.omsBase}/packages/merchantid/${this.mid}`, {
            method: 'POST', headers: this.headers, json: { lineItemRequests: lines.map((l) => ({ id: l.id, quantity: l.quantity })) },
          });
          return { ok: true, message: `Hepsiburada'da paket oluşturuldu${res?.packageNumber ? ` (#${res.packageNumber})` : ''}.` };
        }
        case 'cancelled':
          for (const l of lines) {
            await request(`${this.omsBase}/lineitems/merchantid/${this.mid}/id/${encodeURIComponent(l.id)}/cancelbymerchant`, {
              method: 'POST', headers: this.headers, json: { reasonId: num(this.c.extra.cancelReasonId, 3) },
            });
          }
          return { ok: true, message: 'Hepsiburada\'da sipariş iptal edildi.' };
        case 'shipped': case 'delivered':
          return notSupported('Hepsiburada\'da "Kargoda" ve "Teslim edildi" bilgisi kargo firmasından otomatik gelir.');
        default:
          return notSupported('Hepsiburada\'da sipariş "Yeni" durumuna geri alınamaz.');
      }
    } catch (e) {
      return { ok: false, message: errorMessage(e) };
    }
  }

  /** Hepsiburada kategori araması (yalnızca ürün açılabilen yaprak kategoriler) */
  async searchCategories(q: string): Promise<CategoryOption[]> {
    const all = await cachedCategories('hepsiburada', async () => {
      const out: CategoryOption[] = [];
      for (let page = 0; page < 30; page++) {
        const res = await request<{ data?: Array<Record<string, unknown>>; totalPages?: number; last?: boolean }>(
          `${this.productBase}/product/api/categories/get-all-categories?leaf=true&status=ACTIVE&available=true&page=${page}&size=2000&version=1`, { headers: this.headers });
        for (const c of res?.data ?? []) {
          const paths = Array.isArray(c.paths) ? (c.paths as unknown[]).map((x) => str(x)) : [];
          out.push({ id: num(c.categoryId ?? c.id), name: str(c.name), path: paths.length ? [...paths, str(c.name)].join(' › ') : str(c.name) });
        }
        if (res?.last || !res?.totalPages || page + 1 >= res.totalPages) break;
      }
      return out;
    });
    return searchIn(all, q);
  }

  /** İçerik güncellemesi: Hepsiburada'da ürün bilgileri aynı içe aktarma servisiyle güncellenir (onaya gider) */
  async updateProduct(p: ProductPayload): Promise<AdapterResult> {
    const r = await this.createProduct(p);
    return r.ok ? { ...r, message: `İçerik güncellemesi Hepsiburada onayına gönderildi (trackingId: ${r.ref ?? '-'}).` } : r;
  }
}

function mapHbStatus(s: string): OrderStatus {
  const v = s.toLowerCase();
  if (v.includes('deliver')) return 'delivered';
  if (v.includes('ship') || v.includes('intransit')) return 'shipped';
  if (v.includes('pack') || v.includes('process')) return 'preparing';
  if (v.includes('return') || v.includes('claim')) return 'returned';
  if (v.includes('cancel')) return 'cancelled';
  return 'new';
}

interface HbLine {
  orderNumber?: string; orderId?: string; merchantSku?: string; sku?: string; barcode?: string; productName?: string; name?: string;
  quantity?: number; unitPrice?: unknown; price?: unknown; totalPrice?: unknown; status?: string; orderDate?: string;
  customerName?: string; customer?: { name?: string }; shippingAddress?: { name?: string };
}
