import type { OrderStatus } from '../meta';
import type {
  AdapterResult, BrandOption, CategoryOption, MarketplaceAdapter, MarketplaceCredentials, NormalizedOrder, OrderStatusUpdate, ProductPayload, RemoteProduct, StockUpdate,
} from '../types';
import { cachedCategories, chunk, dateWindows, errorMessage, flattenCategories, notSupported, num, rec, recs, request, searchIn, str, parseMarketDate } from '../http';

/**
 * idefix Pazaryeri API adaptörü.
 * Taban adres: https://merchantapi.idefix.com
 * Stok/fiyat: POST /pim/catalog/{vendorId}/inventory-upload  (developer.idefix.com — doğrulandı)
 * Kimlik doğrulama: "X-API-KEY: base64(apiKey:apiSecret)" varsayıldı — developer.idefix.com/authorization
 * sayfasından doğrulayın; farklıysa extra_config.authHeader ile değiştirin.
 * Diğer yollar extra_config ile değiştirilebilir: productCreatePath, ordersPath, batchPath, productsPath.
 * idefix "deliveryType: same_day_shipping" destekler: ürünün Bugün Kargoda etiketi bu alana yazılır.
 */
export class IdefixAdapter implements MarketplaceAdapter {
  readonly name = 'idefix' as const;
  readonly mode = 'live' as const;
  private readonly base: string;

  constructor(private readonly c: MarketplaceCredentials) {
    this.base = (str(c.extra.baseUrl) || 'https://merchantapi.idefix.com').replace(/\/$/, '');
  }

  private get headers(): Record<string, string> {
    const header = str(this.c.extra.authHeader) || 'X-API-KEY';
    return { [header]: Buffer.from(`${this.c.apiKey}:${this.c.apiSecret}`).toString('base64') };
  }
  private path(key: string, def: string) {
    return (str(this.c.extra[key]) || def).replace('{vendorId}', encodeURIComponent(this.c.sellerId));
  }

  async testConnection(): Promise<AdapterResult> {
    try {
      await request(`${this.base}${this.path('productsPath', '/pim/catalog/{vendorId}/list')}?page=0&limit=1`, { headers: this.headers, retries: 0 });
      return { ok: true, message: 'Bağlantı başarılı.' };
    } catch (e) {
      return { ok: false, message: errorMessage(e) };
    }
  }

  async createProduct(p: ProductPayload): Promise<AdapterResult> {
    const a = p.attributes;
    const categoryId = num(a.categoryId ?? this.c.extra.defaultCategoryId);
    const brandId = num(a.brandId ?? this.c.extra.defaultBrandId);
    if (!categoryId || !brandId) return { ok: false, status: 'error', message: 'idefix kategori ID ve marka ID gerekli.' };
    try {
      const res = await request<{ batchRequestId?: string }>(`${this.base}${this.path('productCreatePath', '/pim/pool/{vendorId}/create')}`, {
        method: 'POST', headers: this.headers,
        json: {
          products: [{
            barcode: p.barcode, title: p.title, productMainId: p.groupCode, brandId, categoryId, inventoryQuantity: Math.max(0, p.stock),
            vendorStockCode: p.sku, description: p.description || p.title, price: p.price, comparePrice: p.listPrice, vatRate: p.vatRate,
            deliveryDuration: num(a.handlingDays, 1), deliveryType: a.sameDay ? 'same_day_shipping' : 'regular',
            images: p.images.map((url) => ({ url })), attributes: Array.isArray(a.attributes) ? a.attributes : [],
          }],
        },
      });
      return { ok: true, status: 'pending', externalId: p.barcode, ref: res?.batchRequestId ?? null, message: 'idefix onayına gönderildi.' };
    } catch (e) {
      return { ok: false, status: 'error', message: errorMessage(e) };
    }
  }

  async checkListing(ref: string): Promise<AdapterResult> {
    try {
      const res = await request<{ status?: string; items?: Array<{ status?: string; failureReasons?: string[] }> }>(
        `${this.base}${this.path('batchPath', '/pim/catalog/{vendorId}/batch-result')}/${encodeURIComponent(ref)}`, { headers: this.headers });
      const it = res?.items?.[0];
      if (str(it?.status).toLowerCase().includes('fail')) return { ok: false, status: 'error', message: (it?.failureReasons ?? []).join('; ') || 'idefix reddetti.' };
      if (str(res?.status).toLowerCase().includes('complete')) return { ok: true, status: 'active', message: 'idefix onayladı.' };
      return { ok: true, status: 'pending', message: 'İşleniyor' };
    } catch (e) {
      return { ok: false, status: 'pending', message: errorMessage(e) };
    }
  }

  async updateStock(items: StockUpdate[]): Promise<AdapterResult> {
    try {
      const refs: string[] = [];
      for (const part of chunk(items, 500)) {
        const res = await request<{ batchRequestId?: string }>(`${this.base}${this.path('inventoryPath', '/pim/catalog/{vendorId}/inventory-upload')}`, {
          method: 'POST', headers: this.headers,
          json: { items: part.map((i) => ({ barcode: i.barcode, price: i.price, comparePrice: i.listPrice || 0, inventoryQuantity: Math.max(0, i.quantity) })) },
        });
        if (res?.batchRequestId) refs.push(res.batchRequestId);
      }
      return { ok: true, message: `${items.length} ürün stoğu gönderildi.`, ref: refs.join(',') || null };
    } catch (e) {
      return { ok: false, message: errorMessage(e) };
    }
  }

  async fetchOrders(since: Date, until: Date): Promise<NormalizedOrder[]> {
    const out: NormalizedOrder[] = [];
    for (const [from, to] of dateWindows(since, until, 14)) {
      for (let page = 0; page < 50; page++) {
        const q = new URLSearchParams({ startDate: String(from.getTime()), endDate: String(to.getTime()), page: String(page), limit: '100' });
        const res = await request<{ items?: IdxShipment[]; content?: IdxShipment[]; totalPages?: number }>(
          `${this.base}${this.path('ordersPath', '/oms/{vendorId}/list')}?${q}`, { headers: this.headers });
        const list = res?.items ?? res?.content ?? [];
        for (const s of list) {
          const items = (s.items ?? s.lines ?? []).map((l) => ({
            sku: str(l.vendorStockCode ?? l.merchantSku), barcode: str(l.barcode), title: str(l.productName ?? l.title),
            quantity: num(l.quantity, 1), unitPrice: num(l.price ?? l.unitPrice),
          }));
          const shipped = (s.histories ?? []).find((h) => str(h.status).toLowerCase().includes('shipped'));
          out.push({
            externalOrderId: `${str(s.orderNumber)}/${str(s.id)}`,
            customerName: `${str(s.customerFirstName ?? s.firstName)} ${str(s.customerLastName ?? s.lastName)}`.trim(),
            totalAmount: num(s.totalPrice, items.reduce((t, i) => t + i.quantity * i.unitPrice, 0)),
            status: mapIdxStatus(str(s.status)),
            orderDate: parseMarketDate(s.orderDate || s.createdAt),
            items,
            raw: s,
            shipment: {
              carrier: str(s.cargoCompany) || null,
              desi: s.desi != null ? num(s.desi) : null,
              shippedAt: shipped?.date ? new Date(num(shipped.date, 0) || str(shipped.date)).toISOString() : null,
              sameDay: s.deliveryType ? s.deliveryType === 'same_day_shipping' : null,
            },
          });
        }
        if (!res?.totalPages || page + 1 >= res.totalPages) break;
      }
    }
    return out;
  }

  async fetchProducts(page: number, size: number): Promise<RemoteProduct[]> {
    const res = await request<{ items?: Array<Record<string, unknown>> }>(`${this.base}${this.path('productsPath', '/pim/catalog/{vendorId}/list')}?page=${page}&limit=${size}`, { headers: this.headers });
    return (res?.items ?? []).map((p) => ({
      externalId: str(p.barcode), sku: str(p.vendorStockCode), barcode: str(p.barcode), title: str(p.title), description: '', category: '', brand: '',
      vatRate: 20, price: num(p.price), listPrice: num(p.comparePrice), costPrice: 0, stock: num(p.inventoryQuantity), images: [], attributes: {},
    }));
  }

  /**
   * Sipariş durumu → idefix sevkiyat durumu (picking / invoiced / shipped / cancelled).
   * Yol Ayarlar > Gelişmiş'te (orderStatusPath) değiştirilebilir. Gerçek hesapla doğrulanmadı.
   */
  async updateOrderStatus(u: OrderStatusUpdate): Promise<AdapterResult> {
    const s = rec(u.raw);
    const shipmentId = str(s.id) || u.externalOrderId.split('/')[1];
    if (!shipmentId) return { ok: false, message: 'idefix sevkiyat numarası bulunamadı (sipariş yeniden senkronlanmalı).' };
    const items = recs(s.items ?? s.lines).map((l) => ({ id: num(l.id ?? l.lineId), quantity: num(l.quantity, 1) })).filter((l) => l.id);
    const map: Partial<Record<string, string>> = { preparing: u.invoiceNumber ? 'invoiced' : 'picking', shipped: 'shipped', cancelled: 'unsupplied' };
    const target = map[u.status];
    if (!target) return notSupported(u.status === 'delivered' ? 'idefix\'te teslimat bilgisi kargo firmasından otomatik gelir.' : 'Bu durum idefix\'e gönderilemez.');
    if (u.status === 'shipped' && !u.trackingNumber) return notSupported('idefix anlaşmalı kargoda "Kargoda" bilgisi otomatik gelir. Kendi kargonuzla gönderiyorsanız takip numarası girin.');
    try {
      const path = (str(this.c.extra.orderStatusPath) || '/oms/{vendorId}/{shipmentId}/update-shipment-status')
        .replace('{vendorId}', encodeURIComponent(this.c.sellerId)).replace('{shipmentId}', encodeURIComponent(shipmentId));
      await request(`${this.base}${path}`, {
        method: 'PUT', headers: this.headers,
        json: {
          status: target, items,
          ...(u.invoiceNumber ? { invoiceNumber: u.invoiceNumber } : {}),
          ...(u.trackingNumber ? { trackingNumber: u.trackingNumber, cargoCompany: u.carrier ?? undefined } : {}),
        },
      });
      return { ok: true, message: `idefix\'te sevkiyat durumu "${target}" yapıldı.` };
    } catch (e) {
      return { ok: false, message: errorMessage(e) };
    }
  }

  /** idefix kategori araması (yol Ayarlar > Gelişmiş: categoriesPath) */
  async searchCategories(q: string): Promise<CategoryOption[]> {
    const all = await cachedCategories('idefix', async () => {
      const res = await request<unknown>(`${this.base}${this.path('categoriesPath', '/pim/product-category')}`, { headers: this.headers });
      return flattenCategories(Array.isArray(res) ? res : rec(res).categories ?? rec(res).items ?? rec(res).data);
    });
    return searchIn(all, q);
  }

  /** idefix marka araması (yol Ayarlar > Gelişmiş: brandsPath) */
  async searchBrands(q: string): Promise<BrandOption[]> {
    const res = await request<unknown>(`${this.base}${this.path('brandsPath', '/pim/brand')}?title=${encodeURIComponent(q)}&page=0&limit=30`, { headers: this.headers });
    return recs(Array.isArray(res) ? res : rec(res).brands ?? rec(res).items ?? rec(res).data)
      .map((b) => ({ id: num(b.id), name: str(b.title ?? b.name) })).filter((b) => b.id);
  }

  /** İçerik güncellemesi (yol Ayarlar > Gelişmiş: productUpdatePath) */
  async updateProduct(p: ProductPayload): Promise<AdapterResult> {
    try {
      const res = await request<{ batchRequestId?: string }>(`${this.base}${this.path('productUpdatePath', '/pim/pool/{vendorId}/update')}`, {
        method: 'POST', headers: this.headers,
        json: { products: [{
          barcode: p.barcode, title: p.title, productMainId: p.groupCode, vendorStockCode: p.sku, description: p.description || p.title,
          images: p.images.map((url) => ({ url })), ...(Array.isArray(p.attributes.attributes) ? { attributes: p.attributes.attributes } : {}),
        }] },
      });
      return { ok: true, status: 'pending', ref: res?.batchRequestId ?? null, message: 'İçerik güncellemesi idefix\'e gönderildi.' };
    } catch (e) {
      return { ok: false, message: errorMessage(e) };
    }
  }
}

function mapIdxStatus(s: string): OrderStatus {
  const v = s.toLowerCase();
  if (v.includes('deliver')) return 'delivered';
  if (v.includes('ship') || v.includes('transit')) return 'shipped';
  if (v.includes('invoice')) return 'invoiced';
  if (v.includes('pick') || v.includes('prepar')) return 'preparing';
  if (v.includes('return') || v.includes('refund')) return 'returned';
  if (v.includes('cancel') || v.includes('unsuppl')) return 'cancelled';
  return 'new';
}

interface IdxShipment {
  id?: string | number; orderNumber?: string; status?: string; orderDate?: number; createdAt?: string; totalPrice?: number;
  customerFirstName?: string; customerLastName?: string; firstName?: string; lastName?: string; cargoCompany?: string; desi?: number; deliveryType?: string;
  histories?: Array<{ status?: string; date?: number | string }>;
  items?: IdxLine[]; lines?: IdxLine[];
}
interface IdxLine { vendorStockCode?: string; merchantSku?: string; barcode?: string; productName?: string; title?: string; quantity?: number; price?: number; unitPrice?: number }
