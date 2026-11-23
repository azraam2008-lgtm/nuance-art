import type { OrderStatus } from '../meta';
import type {
  AdapterResult, BrandOption, CategoryOption, MarketplaceAdapter, MarketplaceCredentials, NormalizedOrder, OrderStatusUpdate, ProductPayload, RemoteProduct, StockUpdate,
} from '../types';
import { basicAuth, cachedCategories, chunk, dateWindows, errorMessage, flattenCategories, notSupported, num, rec, recs, request, searchIn, str } from '../http';

/**
 * Pazarama İş Ortağım API adaptörü.
 * Kimlik doğrulama: OAuth2 client_credentials → Bearer token
 *   token: https://isortagimgiris.pazarama.com/connect/token  (scope: merchantgatewayapi.fullaccess)
 *   api:   https://isortagimapi.pazarama.com
 * Uç noktalar Pazarama entegrasyon dokümanına göre yazılmıştır; satıcı paneli > Entegrasyon
 * dokümanından doğrulayın. Yollar extra_config ile değiştirilebilir.
 * extra_config: { baseUrl?, tokenUrl?, defaultCategoryId?, defaultBrandId? }
 */
export class PazaramaAdapter implements MarketplaceAdapter {
  readonly name = 'pazarama' as const;
  readonly mode = 'live' as const;
  private readonly base: string;
  private token: { value: string; exp: number } | null = null;

  constructor(private readonly c: MarketplaceCredentials) {
    this.base = (str(c.extra.baseUrl) || 'https://isortagimapi.pazarama.com').replace(/\/$/, '');
  }

  private async headers() {
    if (!this.token || Date.now() > this.token.exp) {
      const res = await request<{ data?: { accessToken?: string; expiresIn?: number }; access_token?: string; expires_in?: number }>(
        str(this.c.extra.tokenUrl) || 'https://isortagimgiris.pazarama.com/connect/token', {
          method: 'POST',
          headers: { Authorization: basicAuth(this.c.apiKey, this.c.apiSecret), 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ grant_type: 'client_credentials', scope: 'merchantgatewayapi.fullaccess' }).toString(),
          retries: 0,
        });
      const value = res?.data?.accessToken ?? res?.access_token;
      if (!value) throw new Error('Pazarama token alınamadı.');
      this.token = { value, exp: Date.now() + (num(res?.data?.expiresIn ?? res?.expires_in, 3600) - 60) * 1000 };
    }
    return { Authorization: `Bearer ${this.token.value}` };
  }

  async testConnection(): Promise<AdapterResult> {
    try {
      await request(`${this.base}/brand/getBrands?Page=1&Size=1`, { headers: await this.headers(), retries: 0 });
      return { ok: true, message: 'Bağlantı başarılı (token alındı, marka servisi yanıt verdi).' };
    } catch (e) {
      return { ok: false, message: errorMessage(e) };
    }
  }

  async createProduct(p: ProductPayload): Promise<AdapterResult> {
    const a = p.attributes;
    const categoryId = str(a.categoryId ?? this.c.extra.defaultCategoryId);
    const brandId = str(a.brandId ?? this.c.extra.defaultBrandId);
    if (!categoryId || !brandId) return { ok: false, status: 'error', message: 'Pazarama kategori ID ve marka ID gerekli.' };
    try {
      const res = await request<{ data?: { batchRequestId?: string }; success?: boolean; userMessage?: string }>(`${this.base}/product/create`, {
        method: 'POST', headers: await this.headers(),
        json: {
          products: [{
            name: p.title, displayName: p.title, description: p.description || p.title, brandId, categoryId,
            desi: num(a.desi, 1), code: p.barcode, groupCode: p.sku, stockCode: p.sku, stockCount: Math.max(0, p.stock),
            currencyType: 'TRY', listPrice: p.listPrice, salePrice: p.price, vatRate: p.vatRate,
            images: p.images.map((imageurl) => ({ imageurl })), attributes: Array.isArray(a.attributes) ? a.attributes : [],
          }],
        },
      });
      if (res?.success === false) return { ok: false, status: 'error', message: res.userMessage || 'Pazarama reddetti.' };
      return { ok: true, status: 'pending', externalId: p.barcode, ref: res?.data?.batchRequestId ?? null, message: 'Pazarama onayına gönderildi.' };
    } catch (e) {
      return { ok: false, status: 'error', message: errorMessage(e) };
    }
  }

  async checkListing(ref: string): Promise<AdapterResult> {
    try {
      const res = await request<{ data?: { status?: number | string; batchResult?: Array<{ reason?: string }> } }>(
        `${this.base}/product/getProductBatchResult?BatchRequestId=${encodeURIComponent(ref)}`, { headers: await this.headers() });
      const st = str(res?.data?.status).toLowerCase();
      if (st === '3' || st.includes('fail') || st.includes('error')) return { ok: false, status: 'error', message: (res?.data?.batchResult ?? []).map((x) => x.reason).join('; ') || 'Pazarama reddetti.' };
      if (st === '2' || st.includes('done') || st.includes('success')) return { ok: true, status: 'active', message: 'Pazarama onayladı.' };
      return { ok: true, status: 'pending', message: 'İşleniyor' };
    } catch (e) {
      return { ok: false, status: 'pending', message: errorMessage(e) };
    }
  }

  async updateStock(items: StockUpdate[]): Promise<AdapterResult> {
    try {
      for (const part of chunk(items, 500)) {
        await request(`${this.base}/product/updateStock-v2`, { method: 'POST', headers: await this.headers(), json: { items: part.map((i) => ({ code: i.barcode, stockCount: Math.max(0, i.quantity) })) } });
      }
      return { ok: true, message: `${items.length} ürün stoğu gönderildi.` };
    } catch (e) {
      return { ok: false, message: errorMessage(e) };
    }
  }

  async fetchOrders(since: Date, until: Date): Promise<NormalizedOrder[]> {
    const out: NormalizedOrder[] = [];
    for (const [from, to] of dateWindows(since, until, 7)) {
      for (let page = 1; page <= 50; page++) {
        const res = await request<{ data?: PzOrder[] }>(`${this.base}/order/getOrdersForApi`, {
          method: 'POST', headers: await this.headers(),
          json: { startDate: from.toISOString(), endDate: to.toISOString(), pageSize: 100, pageNumber: page },
        });
        const list = res?.data ?? [];
        for (const o of list) {
          const items = (o.items ?? []).map((i) => ({
            sku: str(i.product?.stockCode ?? i.stockCode), barcode: str(i.product?.code ?? i.code), title: str(i.product?.name ?? i.productName),
            quantity: num(i.quantity, 1), unitPrice: num(val(i.salePrice) ?? i.listPrice),
          }));
          out.push({
            externalOrderId: str(o.orderNumber ?? o.orderId),
            customerName: str(o.customerName),
            totalAmount: num(val(o.orderAmount), items.reduce((s, i) => s + i.quantity * i.unitPrice, 0)),
            status: mapPzStatus(num(o.orderStatus, 0)),
            orderDate: new Date(str(o.orderDate) || Date.now()).toISOString(),
            items,
            raw: o,
            shipment: { carrier: str(o.items?.[0]?.cargo?.companyName) || null, shippedAt: null },
          });
        }
        if (list.length < 100) break;
      }
    }
    return out;
  }

  async fetchProducts(page: number, size: number): Promise<RemoteProduct[]> {
    const res = await request<{ data?: Array<Record<string, unknown>> }>(`${this.base}/product/products?Page=${page + 1}&Size=${size}&Approved=true`, { headers: await this.headers() });
    return (res?.data ?? []).map((p) => ({
      externalId: str(p.code), sku: str(p.stockCode), barcode: str(p.code), title: str(p.name), description: str(p.description), category: str(p.categoryName),
      brand: str(p.brandName), vatRate: num(p.vatRate, 20), price: num(p.salePrice), listPrice: num(p.listPrice), costPrice: 0, stock: num(p.stockCount), images: [], attributes: {},
    }));
  }

  /**
   * Sipariş durumu → Pazarama (sipariş kalemi durum kodları: 12 Hazırlanıyor, 5 Kargoya verildi, 11 Teslim edildi).
   * Kodlar Ayarlar > Gelişmiş'te (statusCodes) değiştirilebilir. Gerçek hesapla doğrulanmadı.
   */
  async updateOrderStatus(u: OrderStatusUpdate): Promise<AdapterResult> {
    const o = rec(u.raw);
    const codes = { preparing: 12, shipped: 5, delivered: 11, ...rec(this.c.extra.statusCodes) } as Record<string, unknown>;
    const orderNumber = str(o.orderNumber ?? o.orderId) || u.externalOrderId;
    if (u.status === 'cancelled') return notSupported('Pazarama\'da satıcı iptali İş Ortağım panelinden yapılır. Stok panelde iade edildi.');
    if (u.status === 'new' || codes[u.status] == null) return notSupported('Bu durum Pazarama\'ya gönderilemez.');
    try {
      const items = recs(o.items);
      const targets = items.length ? items.map((i) => str(i.orderItemId ?? i.id)).filter(Boolean) : [''];
      for (const orderItemId of targets) {
        const res = await request<{ success?: boolean; userMessage?: string; message?: string }>(`${this.base}/order/updateOrderStatus`, {
          method: 'PUT', headers: await this.headers(),
          json: {
            orderNumber,
            ...(orderItemId ? { item: { orderItemId, status: num(codes[u.status]), ...(u.trackingNumber ? { shippingTrackingNumber: u.trackingNumber } : {}) } } : { status: num(codes[u.status]) }),
          },
        });
        if (res?.success === false) return { ok: false, message: res.userMessage || res.message || 'Pazarama durumu kabul etmedi.' };
      }
      return { ok: true, message: 'Pazarama\'da sipariş durumu güncellendi.' };
    } catch (e) {
      return { ok: false, message: errorMessage(e) };
    }
  }

  /** Pazarama kategori araması */
  async searchCategories(q: string): Promise<CategoryOption[]> {
    const all = await cachedCategories('pazarama', async () => {
      const res = await request<unknown>(`${this.base}/category/getCategoryTree`, { headers: await this.headers() });
      return flattenCategories(Array.isArray(res) ? res : rec(res).data);
    });
    return searchIn(all, q);
  }

  /** Pazarama marka araması */
  async searchBrands(q: string): Promise<BrandOption[]> {
    const res = await request<unknown>(`${this.base}/brand/getBrands?Name=${encodeURIComponent(q)}&Page=1&Size=30`, { headers: await this.headers() });
    return recs(Array.isArray(res) ? res : rec(res).data).map((b) => ({ id: str(b.id), name: str(b.name) })).filter((b) => b.id);
  }

  /** İçerik güncellemesi (ad, açıklama, görseller). Yol Ayarlar > Gelişmiş (productUpdatePath) ile değiştirilebilir. */
  async updateProduct(p: ProductPayload): Promise<AdapterResult> {
    try {
      const res = await request<{ data?: { batchRequestId?: string }; success?: boolean; userMessage?: string }>(
        `${this.base}${str(this.c.extra.productUpdatePath) || '/product/update'}`, {
          method: 'POST', headers: await this.headers(),
          json: { products: [{
            code: p.barcode, name: p.title, displayName: p.title, description: p.description || p.title,
            images: p.images.map((imageurl) => ({ imageurl })), ...(Array.isArray(p.attributes.attributes) ? { attributes: p.attributes.attributes } : {}),
          }] },
        });
      if (res?.success === false) return { ok: false, message: res.userMessage || 'Pazarama güncellemeyi reddetti.' };
      return { ok: true, status: 'pending', ref: res?.data?.batchRequestId ?? null, message: 'İçerik güncellemesi Pazarama\'ya gönderildi.' };
    } catch (e) {
      return { ok: false, message: errorMessage(e) };
    }
  }
}

const val = (x: { value?: number } | number | undefined) => (typeof x === 'object' && x !== null ? x.value : x);

function mapPzStatus(s: number): OrderStatus {
  // Pazarama sipariş durumları (dokümana göre): 3 Ödeme alındı, 5 Hazırlanıyor, 6 Kargoya verildi, 11 Teslim edildi, 12/13 İptal/İade
  if (s === 11) return 'delivered';
  if (s === 6) return 'shipped';
  if (s === 5 || s === 7 || s === 12) return 'preparing';
  if (s === 12 || s === 13 || s === 14) return 'cancelled';
  return 'new';
}

interface PzOrder {
  orderId?: string; orderNumber?: string; customerName?: string; orderDate?: string; orderStatus?: number;
  orderAmount?: { value?: number } | number;
  items?: Array<{ quantity?: number; stockCode?: string; code?: string; productName?: string; listPrice?: number; salePrice?: { value?: number } | number;
    product?: { stockCode?: string; code?: string; name?: string }; cargo?: { companyName?: string } }>;
}
