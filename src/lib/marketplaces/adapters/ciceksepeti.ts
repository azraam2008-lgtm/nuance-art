import type { OrderStatus } from '../meta';
import type {
  AdapterResult, CategoryOption, MarketplaceAdapter, MarketplaceCredentials, NormalizedOrder, OrderStatusUpdate, ProductPayload, RemoteProduct, StockUpdate,
} from '../types';
import { cachedCategories, chunk, dateWindows, errorMessage, flattenCategories, notSupported, num, rec, recs, request, searchIn, str } from '../http';

/**
 * Çiçeksepeti Marketplace API adaptörü.
 * Kimlik doğrulama: "x-api-key" başlığı.
 * Canlı: https://apis.ciceksepeti.com/api/v1  — Test: https://sandbox-apis.ciceksepeti.com/api/v1
 * extra_config: { baseUrl?, defaultCategoryId?, deliveryMessageType?, deliveryType? }
 */
export class CiceksepetiAdapter implements MarketplaceAdapter {
  readonly name = 'ciceksepeti' as const;
  readonly mode = 'live' as const;
  private readonly base: string;

  constructor(private readonly c: MarketplaceCredentials) {
    this.base = (str(c.extra.baseUrl) || 'https://apis.ciceksepeti.com/api/v1').replace(/\/$/, '');
  }

  private get headers() { return { 'x-api-key': this.c.apiKey }; }

  async testConnection(): Promise<AdapterResult> {
    try {
      const res = await request<{ totalCount?: number }>(`${this.base}/Products?PageSize=1&Page=1`, { headers: this.headers, retries: 0 });
      return { ok: true, message: `Bağlantı başarılı. ${res?.totalCount ?? 0} ürün bulundu.` };
    } catch (e) {
      return { ok: false, message: errorMessage(e) };
    }
  }

  async createProduct(p: ProductPayload): Promise<AdapterResult> {
    const a = p.attributes;
    const categoryId = num(a.categoryId ?? this.c.extra.defaultCategoryId);
    if (!categoryId) return { ok: false, status: 'error', message: 'Çiçeksepeti kategori ID gerekli.' };
    const body = {
      products: [{
        productName: p.title,
        mainProductCode: p.sku,
        stockCode: p.sku,
        categoryId,
        description: p.description || p.title,
        deliveryMessageType: num(a.deliveryMessageType ?? this.c.extra.deliveryMessageType, 5),
        deliveryType: num(a.deliveryType ?? this.c.extra.deliveryType, 2),
        stockQuantity: Math.max(0, p.stock),
        salesPrice: p.price,
        listPrice: p.listPrice,
        barcode: p.barcode,
        images: p.images.slice(0, 5),
        Attributes: Array.isArray(a.attributes) ? a.attributes : [],
      }],
    };
    try {
      const res = await request<{ batchId?: string }>(`${this.base}/Products`, { method: 'POST', headers: this.headers, json: body });
      return { ok: true, status: 'pending', externalId: p.sku, ref: res?.batchId ?? null, message: `Çiçeksepeti onayına gönderildi (batch: ${res?.batchId ?? '-'}).` };
    } catch (e) {
      return { ok: false, status: 'error', message: errorMessage(e) };
    }
  }

  async checkListing(ref: string): Promise<AdapterResult> {
    try {
      const res = await request<{ items?: Array<{ status?: string; failureReasons?: Array<{ message?: string }> }> }>(
        `${this.base}/Products/batch-status/${encodeURIComponent(ref)}`, { headers: this.headers });
      const item = res?.items?.[0];
      const st = str(item?.status).toLowerCase();
      if (st === 'failed') return { ok: false, status: 'error', message: (item?.failureReasons ?? []).map((f) => f.message).join('; ') || 'Çiçeksepeti reddetti.' };
      if (st === 'success') return { ok: true, status: 'active', message: 'Çiçeksepeti onayladı.' };
      return { ok: true, status: 'pending', message: `Durum: ${item?.status ?? 'işleniyor'}` };
    } catch (e) {
      return { ok: false, status: 'pending', message: errorMessage(e) };
    }
  }

  async updateStock(items: StockUpdate[]): Promise<AdapterResult> {
    try {
      const ids: string[] = [];
      for (const part of chunk(items, 200)) {
        const res = await request<{ batchId?: string }>(`${this.base}/Products/price-and-stock`, {
          method: 'PUT', headers: this.headers,
          json: { items: part.map((i) => ({ stockCode: i.sku, stockQuantity: Math.max(0, i.quantity), listPrice: i.listPrice, salesPrice: i.price })) },
        });
        if (res?.batchId) ids.push(res.batchId);
      }
      return { ok: true, message: `${items.length} ürün stoğu gönderildi.`, ref: ids.join(',') || null };
    } catch (e) {
      return { ok: false, message: errorMessage(e) };
    }
  }

  async fetchOrders(since: Date, until: Date): Promise<NormalizedOrder[]> {
    const lines: CsLine[] = [];
    for (const [from, to] of dateWindows(since, until, 14)) {
      for (let page = 0; page < 50; page++) {
        const res = await request<{ supplierOrderListWithBranch?: CsLine[]; pageCount?: number }>(`${this.base}/Order/GetOrders`, {
          method: 'POST', headers: this.headers,
          json: { startDate: from.toISOString(), endDate: to.toISOString(), pageSize: 100, page },
        });
        lines.push(...(res?.supplierOrderListWithBranch ?? []));
        if (!res?.pageCount || page + 1 >= res.pageCount) break;
      }
    }
    const grouped = new Map<string, CsLine[]>();
    for (const l of lines) {
      const key = str(l.orderId);
      if (key) grouped.set(key, [...(grouped.get(key) ?? []), l]);
    }
    return [...grouped.entries()].map(([orderId, ls]) => {
      const f = ls[0];
      return {
        externalOrderId: orderId,
        customerName: str(f.senderName || f.receiverName),
        totalAmount: ls.reduce((s, l) => s + num(l.totalPrice), 0),
        status: mapCsStatus(str(f.orderProductStatus)),
        orderDate: new Date(str(f.orderCreateDate) || Date.now()).toISOString(),
        items: ls.map((l) => ({ sku: str(l.code), title: str(l.name), quantity: num(l.quantity, 1), unitPrice: num(l.itemPrice ?? l.totalPrice) / (l.itemPrice ? 1 : num(l.quantity, 1)) })),
        raw: ls,
      } satisfies NormalizedOrder;
    });
  }

  async fetchProducts(page: number, size: number): Promise<RemoteProduct[]> {
    const res = await request<{ products?: Array<Record<string, unknown>> }>(`${this.base}/Products?PageSize=${size}&Page=${page + 1}`, { headers: this.headers });
    return (res?.products ?? []).map((p) => ({
      externalId: str(p.productCode ?? p.stockCode), sku: str(p.stockCode), barcode: str(p.barcode), title: str(p.productName),
      description: str(p.description), category: str(p.categoryName), brand: '', vatRate: 20, price: num(p.salesPrice),
      listPrice: num(p.listPrice), costPrice: 0, stock: num(p.stockQuantity), images: Array.isArray(p.images) ? (p.images as string[]) : [], attributes: {},
    }));
  }

  /**
   * Sipariş durumu → Çiçeksepeti. Hazırlanıyor → kalemler "kargoya hazır" yapılır (Çiçeksepeti anlaşmalı kargo).
   * Kendi kargonuzla gönderimde takip numarası "Kargoda" adımında bildirilir.
   */
  async updateOrderStatus(u: OrderStatusUpdate): Promise<AdapterResult> {
    const ids = recs(u.raw).map((l) => num(l.orderItemId ?? l.orderProductId)).filter(Boolean);
    if (!ids.length && u.status !== 'new') return { ok: false, message: 'Çiçeksepeti sipariş kalemleri bulunamadı (sipariş yeniden senkronlanmalı).' };
    try {
      switch (u.status) {
        case 'preparing':
          await request(`${this.base}/Order/readyforcargowithcsintegration`, {
            method: 'PUT', headers: this.headers, json: { orderItemsGroup: [{ orderItemIds: ids }] },
          });
          return { ok: true, message: 'Çiçeksepeti\'nde sipariş "kargoya hazır" yapıldı.' };
        case 'shipped':
          if (!u.trackingNumber) return notSupported('Çiçeksepeti anlaşmalı kargoda "Kargoda" bilgisi otomatik gelir. Kendi kargonuzla gönderiyorsanız takip numarası girin.');
          await request(`${this.base}/Order/readyforcargowithtrackingnumber`, {
            method: 'PUT', headers: this.headers,
            json: { orderItemsGroup: [{ orderItemIds: ids, trackingNumber: u.trackingNumber, cargoCompany: u.carrier ?? '' }] },
          });
          return { ok: true, message: `Çiçeksepeti\'ne takip numarası bildirildi (${u.trackingNumber}).` };
        case 'cancelled':
          return notSupported('Çiçeksepeti\'nde satıcı iptali Satıcı Paneli\'nden yapılır. Stok panelde iade edildi.');
        case 'delivered':
          return notSupported('Çiçeksepeti\'nde teslimat bilgisi kargo firmasından otomatik gelir.');
        default:
          return notSupported('Çiçeksepeti\'nde sipariş "Yeni" durumuna geri alınamaz.');
      }
    } catch (e) {
      return { ok: false, message: errorMessage(e) };
    }
  }

  /** Çiçeksepeti kategori araması */
  async searchCategories(q: string): Promise<CategoryOption[]> {
    const all = await cachedCategories('ciceksepeti', async () => {
      const res = await request<unknown>(`${this.base}/Categories`, { headers: this.headers });
      return flattenCategories(Array.isArray(res) ? res : rec(res).categories);
    });
    return searchIn(all, q);
  }

  /** İçerik güncellemesi (ad, açıklama, görseller) */
  async updateProduct(p: ProductPayload): Promise<AdapterResult> {
    try {
      const res = await request<{ batchId?: string }>(`${this.base}/Products`, {
        method: 'PUT', headers: this.headers,
        json: { products: [{
          productName: p.title, mainProductCode: p.sku, stockCode: p.sku, description: p.description || p.title,
          deliveryMessageType: num(p.attributes.deliveryMessageType ?? this.c.extra.deliveryMessageType, 5),
          deliveryType: num(p.attributes.deliveryType ?? this.c.extra.deliveryType, 2),
          images: p.images.slice(0, 5), Attributes: Array.isArray(p.attributes.attributes) ? p.attributes.attributes : [],
        }] },
      });
      return { ok: true, status: 'pending', ref: res?.batchId ?? null, message: `İçerik güncellemesi Çiçeksepeti'ne gönderildi (batch: ${res?.batchId ?? '-'}).` };
    } catch (e) {
      return { ok: false, message: errorMessage(e) };
    }
  }
}

function mapCsStatus(s: string): OrderStatus {
  const v = s.toLowerCase();
  if (v.includes('teslim') || v.includes('deliver')) return 'delivered';
  if (v.includes('kargo') || v.includes('ship')) return 'shipped';
  if (v.includes('hazır') || v.includes('prepar')) return 'preparing';
  if (v.includes('iptal') || v.includes('iade') || v.includes('cancel')) return 'cancelled';
  return 'new';
}

interface CsLine {
  orderId?: number | string; senderName?: string; receiverName?: string; totalPrice?: number; itemPrice?: number;
  orderProductStatus?: string; orderCreateDate?: string; code?: string; name?: string; quantity?: number;
}
