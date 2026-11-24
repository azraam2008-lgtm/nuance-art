import type { OrderStatus } from '../meta';
import type {
  AdapterResult, CategoryOption, MarketplaceAdapter, MarketplaceCredentials, NormalizedOrder, OrderStatusUpdate, ProductPayload, RemoteProduct, StockUpdate,
} from '../types';
import { cachedCategories, chunk, dateWindows, errorMessage, flattenCategories, notSupported, num, rec, recs, request, searchIn, str } from '../http';

/**
 * N11 REST API adaptörü (yeni nesil "ms" servisleri).
 * Kimlik doğrulama: "appkey" ve "appsecret" başlıkları.
 * Ürün oluşturma ve fiyat/stok güncelleme asenkron "task" olarak işlenir; taskId ile takip edilir.
 * extra_config: { baseUrl?, defaultCategoryId?, shipmentTemplate?, preparingDay?, integratorName? }
 */
export class N11Adapter implements MarketplaceAdapter {
  readonly name = 'n11' as const;
  readonly mode = 'live' as const;
  private readonly base: string;

  constructor(private readonly c: MarketplaceCredentials) {
    this.base = (str(c.extra.baseUrl) || 'https://api.n11.com').replace(/\/$/, '');
  }

  private get headers() { return { appkey: this.c.apiKey, appsecret: this.c.apiSecret }; }
  private get integrator() { return str(this.c.extra.integratorName) || 'Kervan'; }

  async testConnection(): Promise<AdapterResult> {
    try {
      const res = await request<{ totalElements?: number }>(`${this.base}/ms/product-query?page=0&size=1`, { headers: this.headers, retries: 0 });
      return { ok: true, message: `Bağlantı başarılı. ${res?.totalElements ?? 0} ürün bulundu.` };
    } catch (e) {
      return { ok: false, message: errorMessage(e) };
    }
  }

  async createProduct(p: ProductPayload): Promise<AdapterResult> {
    const a = p.attributes;
    const categoryId = num(a.categoryId ?? this.c.extra.defaultCategoryId);
    if (!categoryId) return { ok: false, status: 'error', message: 'N11 kategori ID gerekli.' };
    const body = {
      payload: {
        integrator: this.integrator,
        skus: [{
          title: p.title.slice(0, 65),
          description: p.description || p.title,
          categoryId,
          currencyType: 'TL',
          productMainId: p.groupCode,
          preparingDay: num(a.preparingDay ?? this.c.extra.preparingDay, 3),
          shipmentTemplate: str(a.shipmentTemplate ?? this.c.extra.shipmentTemplate),
          stockCode: p.sku,
          barcode: p.barcode,
          quantity: Math.max(0, p.stock),
          images: p.images.slice(0, 8).map((url, i) => ({ url, order: i + 1 })),
          attributes: Array.isArray(a.attributes) ? a.attributes : [],
          salePrice: p.price,
          listPrice: p.listPrice,
          vatRate: p.vatRate,
        }],
      },
    };
    try {
      const res = await request<{ id?: number | string; status?: string; reasons?: string[] }>(
        `${this.base}/ms/product/tasks/product-create`, { method: 'POST', headers: this.headers, json: body });
      if (res?.status === 'REJECT') return { ok: false, status: 'error', message: (res.reasons ?? []).join('; ') || 'N11 isteği reddetti.' };
      return { ok: true, status: 'pending', externalId: p.sku, ref: res?.id != null ? String(res.id) : null, message: `N11 görevi oluşturuldu (taskId: ${res?.id ?? '-'}).` };
    } catch (e) {
      return { ok: false, status: 'error', message: errorMessage(e) };
    }
  }

  async checkListing(ref: string): Promise<AdapterResult> {
    try {
      const res = await request<{ status?: string; skus?: { content?: Array<{ status?: string; reasons?: string[] }> } }>(
        `${this.base}/ms/product/task-details/page-query`, { method: 'POST', headers: this.headers, json: { taskId: Number(ref), pageable: { page: 0, size: 10 } } });
      const sku = res?.skus?.content?.[0];
      if (sku?.status === 'FAIL') return { ok: false, status: 'error', message: (sku.reasons ?? []).join('; ') || 'N11 reddetti.' };
      if (res?.status === 'PROCESSED' && sku?.status === 'SUCCESS') return { ok: true, status: 'active', message: 'N11 onayladı.' };
      return { ok: true, status: 'pending', message: `Görev durumu: ${res?.status ?? 'işleniyor'}` };
    } catch (e) {
      return { ok: false, status: 'pending', message: errorMessage(e) };
    }
  }

  async updateStock(items: StockUpdate[]): Promise<AdapterResult> {
    try {
      const ids: string[] = [];
      for (const part of chunk(items, 1000)) {
        const res = await request<{ id?: number | string; status?: string; reasons?: string[] }>(
          `${this.base}/ms/product/tasks/price-stock-update`, {
            method: 'POST', headers: this.headers,
            json: { payload: { integrator: this.integrator, skus: part.map((i) => ({ stockCode: i.sku, listPrice: i.listPrice, salePrice: i.price, quantity: Math.max(0, i.quantity), currencyType: 'TL' })) } },
          });
        if (res?.status === 'REJECT') return { ok: false, message: (res.reasons ?? []).join('; ') || 'N11 stok güncellemesini reddetti.' };
        if (res?.id != null) ids.push(String(res.id));
      }
      return { ok: true, message: `${items.length} ürün stoğu gönderildi.`, ref: ids.join(',') || null };
    } catch (e) {
      return { ok: false, message: errorMessage(e) };
    }
  }

  async fetchOrders(since: Date, until: Date): Promise<NormalizedOrder[]> {
    const out: NormalizedOrder[] = [];
    for (const [from, to] of dateWindows(since, until, 14)) {
      for (let page = 0; page < 50; page++) {
        const q = new URLSearchParams({ startDate: String(from.getTime()), endDate: String(to.getTime()), page: String(page), size: '100' });
        const res = await request<{ content?: N11Package[]; totalPages?: number }>(
          `${this.base}/rest/delivery/v1/shipmentPackages?${q}`, { headers: this.headers });
        for (const pkg of res?.content ?? []) {
          const items = (pkg.lines ?? []).map((l) => ({
            sku: str(l.stockCode), barcode: str(l.barcode), title: str(l.productName),
            quantity: num(l.quantity, 1), unitPrice: num(l.price ?? l.sellerInvoiceAmount),
          }));
          out.push({
            externalOrderId: `${str(pkg.orderNumber)}/${str(pkg.id)}`,
            customerName: str(pkg.customerfullName || pkg.customerFullName),
            totalAmount: num(pkg.totalAmount, items.reduce((s, i) => s + i.quantity * i.unitPrice, 0)),
            status: mapN11Status(str(pkg.shipmentPackageStatus)),
            orderDate: new Date(num(pkg.packageHistories?.[0]?.createdDate ?? pkg.lastModifiedDate, Date.now())).toISOString(),
            items,
            raw: pkg,
          });
        }
        if (!res?.totalPages || page + 1 >= res.totalPages) break;
      }
    }
    return out;
  }

  async fetchProducts(page: number, size: number): Promise<RemoteProduct[]> {
    const res = await request<{ content?: Array<Record<string, unknown>> }>(`${this.base}/ms/product-query?page=${page}&size=${size}`, { headers: this.headers });
    return (res?.content ?? []).map((p) => ({
      externalId: str(p.n11ProductId ?? p.stockCode), sku: str(p.stockCode), barcode: str(p.barcode), title: str(p.title),
      description: str(p.description), category: str(p.categoryId), brand: str(p.brand), vatRate: num(p.vatRate, 20),
      price: num(p.salePrice), listPrice: num(p.listPrice), costPrice: 0, stock: num(p.quantity),
      images: Array.isArray(p.imageUrls) ? (p.imageUrls as string[]) : [], attributes: {},
    }));
  }

  /**
   * Sipariş durumu → N11. Hazırlanıyor → sipariş satırları "Picking" (onaylandı) yapılır.
   * Kargoda/Teslim edildi bilgisi N11'e kargo firmasından gelir; iptal N11 Satıcı Ofisi'nden yapılır.
   */
  async updateOrderStatus(u: OrderStatusUpdate): Promise<AdapterResult> {
    const lines = recs(rec(u.raw).lines).map((l) => num(l.orderLineId ?? l.id)).filter(Boolean);
    try {
      switch (u.status) {
        case 'preparing':
          if (!lines.length) return { ok: false, message: 'N11 sipariş satırları bulunamadı (sipariş yeniden senkronlanmalı).' };
          await request(`${this.base}/rest/order/v1/update`, {
            method: 'PUT', headers: this.headers, json: { lines: lines.map((lineId) => ({ lineId })), status: 'Picking' },
          });
          return { ok: true, message: 'N11\'de sipariş onaylandı (Hazırlanıyor).' };
        case 'cancelled':
          return notSupported('N11 API\'si satıcı iptalini desteklemiyor; siparişi N11 Satıcı Ofisi\'nden iptal edin. Stok panelde iade edildi.');
        case 'shipped': case 'delivered':
          return notSupported('N11\'de "Kargoda" ve "Teslim edildi" bilgisi kargo firmasından otomatik gelir.');
        default:
          return notSupported('N11\'de sipariş "Yeni" durumuna geri alınamaz.');
      }
    } catch (e) {
      return { ok: false, message: errorMessage(e) };
    }
  }

  /** N11 kategori araması */
  async searchCategories(q: string): Promise<CategoryOption[]> {
    const all = await cachedCategories('n11', async () => {
      const res = await request<unknown>(`${this.base}/cdn/categories`, { headers: this.headers });
      return flattenCategories(Array.isArray(res) ? res : rec(res).categories ?? rec(res).content);
    });
    return searchIn(all, q);
  }

  /** İçerik güncellemesi (başlık, açıklama, görseller) — N11 görev olarak işler */
  async updateProduct(p: ProductPayload): Promise<AdapterResult> {
    try {
      const res = await request<{ id?: number | string; status?: string; reasons?: string[] }>(`${this.base}/ms/product/tasks/product-update`, {
        method: 'POST', headers: this.headers,
        json: { payload: { integrator: this.integrator, skus: [{
          stockCode: p.sku, title: p.title.slice(0, 65), description: p.description || p.title,
          images: p.images.slice(0, 8).map((url, i) => ({ url, order: i + 1 })),
          ...(Array.isArray(p.attributes.attributes) ? { attributes: p.attributes.attributes } : {}),
        }] } },
      });
      if (res?.status === 'REJECT') return { ok: false, message: (res.reasons ?? []).join('; ') || 'N11 güncellemeyi reddetti.' };
      return { ok: true, status: 'pending', ref: res?.id != null ? String(res.id) : null, message: `İçerik güncellemesi N11'e gönderildi (taskId: ${res?.id ?? '-'}).` };
    } catch (e) {
      return { ok: false, message: errorMessage(e) };
    }
  }
}

function mapN11Status(s: string): OrderStatus {
  switch (s) {
    case 'Created': return 'new';
    case 'Picking': return 'preparing';
    case 'Shipped': return 'shipped';
    case 'Delivered': return 'delivered';
    case 'Approved': return 'approved';
    case 'Cancelled': case 'UnPacked': case 'UnSupplied': return 'cancelled';
    case 'Returned': return 'returned';
    default: return 'new';
  }
}

interface N11Package {
  id?: number | string; orderNumber?: string; customerfullName?: string; customerFullName?: string; totalAmount?: number;
  shipmentPackageStatus?: string; lastModifiedDate?: number; packageHistories?: Array<{ createdDate?: number }>;
  lines?: Array<{ stockCode?: string; barcode?: string; productName?: string; quantity?: number; price?: number; sellerInvoiceAmount?: number }>;
}
