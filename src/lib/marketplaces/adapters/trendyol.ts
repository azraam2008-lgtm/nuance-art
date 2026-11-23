import type { OrderStatus } from '../meta';
import type {
  AttributeDef, BrandOption, CategoryOption,
  AdapterResult, MarketplaceAdapter, MarketplaceCredentials, NormalizedOrder,
  OrderStatusUpdate, ProductPayload, RemoteProduct, StockUpdate,
} from '../types';
import { basicAuth, chunk, dateWindows, errorMessage, notSupported, num, rec, recs, request, str } from '../http';

/**
 * Trendyol Satıcı (Supplier) API adaptörü.
 * Kimlik doğrulama: Basic base64(apiKey:apiSecret) + "User-Agent: {sellerId} - SelfIntegration"
 * Varsayılan taban adres: https://apigw.trendyol.com/integration
 * Test ortamı için Ayarlar > Gelişmiş > baseUrl alanına stage adresini girin.
 * extra_config: { baseUrl?, defaultCategoryId?, defaultBrandId?, cargoCompanyId?, integratorName? }
 */
export class TrendyolAdapter implements MarketplaceAdapter {
  readonly name = 'trendyol' as const;
  readonly mode = 'live' as const;
  private readonly base: string;

  constructor(private readonly c: MarketplaceCredentials) {
    this.base = (str(c.extra.baseUrl) || 'https://apigw.trendyol.com/integration').replace(/\/$/, '');
  }

  private get headers() {
    return {
      Authorization: basicAuth(this.c.apiKey, this.c.apiSecret),
      'User-Agent': `${this.c.sellerId} - ${str(this.c.extra.integratorName) || 'SelfIntegration'}`,
    };
  }

  private url(path: string) {
    return `${this.base}${path.replace('{sellerId}', encodeURIComponent(this.c.sellerId))}`;
  }

  async testConnection(): Promise<AdapterResult> {
    try {
      const res = await request<{ totalElements?: number }>(
        this.url('/product/sellers/{sellerId}/products?page=0&size=1'), { headers: this.headers, retries: 0 });
      return { ok: true, message: `Bağlantı başarılı. Mağazada ${res?.totalElements ?? 0} ürün var.` };
    } catch (e) {
      return { ok: false, message: errorMessage(e) };
    }
  }

  async createProduct(p: ProductPayload): Promise<AdapterResult> {
    const a = p.attributes;
    const categoryId = num(a.categoryId ?? this.c.extra.defaultCategoryId);
    const brandId = num(a.brandId ?? this.c.extra.defaultBrandId);
    if (!categoryId || !brandId) {
      return { ok: false, status: 'error', message: 'Trendyol kategori ID ve marka ID gerekli (ürün özelliklerinde veya Ayarlar > varsayılanlarda tanımlayın).' };
    }
    const body = {
      items: [{
        barcode: p.barcode,
        title: p.title.slice(0, 100),
        productMainId: p.sku,
        brandId,
        categoryId,
        quantity: Math.max(0, p.stock),
        stockCode: p.sku,
        dimensionalWeight: num(a.dimensionalWeight, 1),
        description: p.description || p.title,
        currencyType: 'TRY',
        listPrice: p.listPrice,
        salePrice: p.price,
        vatRate: p.vatRate,
        cargoCompanyId: num(a.cargoCompanyId ?? this.c.extra.cargoCompanyId) || undefined,
        images: p.images.slice(0, 8).map((url) => ({ url })),
        attributes: Array.isArray(a.attributes) ? a.attributes : [],
        ...(a.handlingDays != null || a.sameDay || a.fastDelivery ? {
          deliveryOption: {
            deliveryDuration: Math.max(1, num(a.handlingDays, 1)),
            ...(a.sameDay ? { fastDeliveryType: 'SAME_DAY_SHIPPING' } : a.fastDelivery ? { fastDeliveryType: 'FAST_DELIVERY' } : {}),
          },
        } : {}),
      }],
    };
    try {
      const res = await request<{ batchRequestId?: string }>(
        this.url('/product/sellers/{sellerId}/products'), { method: 'POST', headers: this.headers, json: body });
      return {
        ok: true, status: 'pending', externalId: p.barcode, ref: res?.batchRequestId ?? null,
        message: `Ürün Trendyol onayına gönderildi (batch: ${res?.batchRequestId ?? '-'}).`,
      };
    } catch (e) {
      return { ok: false, status: 'error', message: errorMessage(e) };
    }
  }

  /** Yayındaki ürünün içerik güncellemesi (başlık, açıklama, görseller, özellikler). Fiyat/stok updateStock ile gider. */
  async updateProduct(p: ProductPayload): Promise<AdapterResult> {
    const a = p.attributes;
    const categoryId = num(a.categoryId ?? this.c.extra.defaultCategoryId);
    const brandId = num(a.brandId ?? this.c.extra.defaultBrandId);
    if (!categoryId || !brandId) return { ok: false, message: 'Trendyol kategori ve marka seçili değil.' };
    try {
      const res = await request<{ batchRequestId?: string }>(this.url('/product/sellers/{sellerId}/products'), {
        method: 'PUT', headers: this.headers,
        json: { items: [{
          barcode: p.barcode, title: p.title.slice(0, 100), productMainId: p.sku, brandId, categoryId, stockCode: p.sku,
          dimensionalWeight: num(a.dimensionalWeight, 1), description: p.description || p.title, vatRate: p.vatRate,
          cargoCompanyId: num(a.cargoCompanyId ?? this.c.extra.cargoCompanyId) || undefined,
          images: p.images.slice(0, 8).map((url) => ({ url })), attributes: Array.isArray(a.attributes) ? a.attributes : [],
        }] },
      });
      return { ok: true, status: 'pending', ref: res?.batchRequestId ?? null, message: `Güncelleme Trendyol'a gönderildi (batch: ${res?.batchRequestId ?? '-'}).` };
    } catch (e) {
      return { ok: false, message: errorMessage(e) };
    }
  }

  async searchCategories(q: string): Promise<CategoryOption[]> {
    const all = await this.categoryTree();
    const needle = q.toLocaleLowerCase('tr-TR');
    return all.filter((c) => c.path.toLocaleLowerCase('tr-TR').includes(needle)).slice(0, 40);
  }

  private async categoryTree(): Promise<CategoryOption[]> {
    if (categoryCache && categoryCache.exp > Date.now()) return categoryCache.items;
    const res = await request<{ categories?: TyCategory[] }>(`${this.base}/product/product-categories`, { headers: this.headers });
    const out: CategoryOption[] = [];
    const walk = (list: TyCategory[], parents: string[]) => {
      for (const c of list) {
        const path = [...parents, str(c.name)];
        if (c.subCategories?.length) walk(c.subCategories, path);
        else out.push({ id: num(c.id), name: str(c.name), path: path.join(' › ') });
      }
    };
    walk(res?.categories ?? [], []);
    categoryCache = { items: out, exp: Date.now() + 6 * 3600_000 };
    return out;
  }

  async searchBrands(q: string): Promise<BrandOption[]> {
    const res = await request<Array<{ id: number; name: string }> | { brands?: Array<{ id: number; name: string }> }>(
      `${this.base}/product/brands/by-name?name=${encodeURIComponent(q)}`, { headers: this.headers });
    const list = Array.isArray(res) ? res : res?.brands ?? [];
    return list.slice(0, 30).map((b) => ({ id: b.id, name: b.name }));
  }

  async categoryAttributes(categoryId: number): Promise<AttributeDef[]> {
    const res = await request<{ categoryAttributes?: Array<{ allowCustom?: boolean; required?: boolean; varianter?: boolean; attribute?: { id: number; name: string }; attributeValues?: Array<{ id: number; name: string }> }> }>(
      `${this.base}/product/product-categories/${categoryId}/attributes`, { headers: this.headers });
    return (res?.categoryAttributes ?? []).filter((x) => x.attribute).map((x) => ({
      id: x.attribute!.id, name: x.attribute!.name, required: !!x.required, allowCustom: !!x.allowCustom, varianter: !!x.varianter,
      values: (x.attributeValues ?? []).map((v) => ({ id: v.id, name: v.name })),
    })).sort((a, b) => Number(b.required) - Number(a.required));
  }

  async checkListing(ref: string): Promise<AdapterResult> {
    try {
      const res = await request<{ status?: string; items?: Array<{ status?: string; failureReasons?: string[] }> }>(
        this.url(`/product/sellers/{sellerId}/products/batch-requests/${encodeURIComponent(ref)}`), { headers: this.headers });
      const item = res?.items?.[0];
      if (item?.status === 'FAILED') return { ok: false, status: 'error', message: (item.failureReasons ?? []).join('; ') || 'Trendyol ürünü reddetti.' };
      if (res?.status === 'COMPLETED' && item?.status === 'SUCCESS') return { ok: true, status: 'active', message: 'Trendyol onayladı.' };
      return { ok: true, status: 'pending', message: `İşleniyor (${res?.status ?? 'bilinmiyor'})` };
    } catch (e) {
      return { ok: false, status: 'pending', message: errorMessage(e) };
    }
  }

  async updateStock(items: StockUpdate[]): Promise<AdapterResult> {
    try {
      const refs: string[] = [];
      for (const part of chunk(items, 1000)) {
        const res = await request<{ batchRequestId?: string }>(
          this.url('/inventory/sellers/{sellerId}/products/price-and-inventory'), {
            method: 'POST', headers: this.headers,
            json: { items: part.map((i) => ({ barcode: i.barcode, quantity: Math.max(0, i.quantity), salePrice: i.price, listPrice: i.listPrice })) },
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
    // Trendyol sipariş sorgusunda en fazla 2 haftalık aralık kabul edilir.
    for (const [from, to] of dateWindows(since, until, 14)) {
      for (let page = 0; page < 50; page++) {
        const q = new URLSearchParams({
          startDate: String(from.getTime()), endDate: String(to.getTime()),
          page: String(page), size: '200', orderByField: 'PackageLastModifiedDate', orderByDirection: 'DESC',
        });
        const res = await request<{ content?: TrendyolPackage[]; totalPages?: number }>(
          this.url(`/order/sellers/{sellerId}/orders?${q}`), { headers: this.headers });
        for (const pkg of res?.content ?? []) out.push(this.mapOrder(pkg));
        if (!res?.totalPages || page + 1 >= res.totalPages) break;
      }
    }
    return out;
  }

  private mapOrder(pkg: TrendyolPackage): NormalizedOrder {
    const items = (pkg.lines ?? []).map((l) => ({
      sku: str(l.merchantSku || l.sku), barcode: str(l.barcode), title: str(l.productName),
      quantity: num(l.quantity, 1), unitPrice: num(l.price ?? l.amount),
    }));
    return {
      // Bir sipariş birden çok pakete bölünebilir; her paket ayrı stok hareketidir.
      externalOrderId: `${str(pkg.orderNumber)}/${str(pkg.id)}`,
      customerName: `${str(pkg.customerFirstName)} ${str(pkg.customerLastName)}`.trim(),
      totalAmount: num(pkg.totalPrice, items.reduce((s, i) => s + i.quantity * i.unitPrice, 0)),
      status: mapTrendyolStatus(str(pkg.status)),
      orderDate: new Date(num(pkg.orderDate, Date.now())).toISOString(),
      items,
      raw: pkg,
      shipment: {
        carrier: normalizeCarrier(str(pkg.cargoProviderName)),
        desi: pkg.cargoDeci != null ? num(pkg.cargoDeci) : null,
        shippedAt: shippedAtOf(pkg),
        sameDay: pkg.fastDeliveryType ? pkg.fastDeliveryType === 'SameDayShipping' : null,
        fast: pkg.fastDelivery ?? null,
        microExport: !!pkg.micro,
      },
    };
  }

  async fetchProducts(page: number, size: number): Promise<RemoteProduct[]> {
    const res = await request<{ content?: TrendyolProduct[] }>(
      this.url(`/product/sellers/{sellerId}/products?approved=true&page=${page}&size=${size}`), { headers: this.headers });
    return (res?.content ?? []).map((p) => ({
      externalId: str(p.id || p.barcode),
      sku: str(p.stockCode || p.productMainId || p.barcode),
      barcode: str(p.barcode),
      title: str(p.title),
      description: str(p.description),
      category: str(p.categoryName),
      brand: str(p.brand),
      vatRate: num(p.vatRate, 20),
      price: num(p.salePrice),
      listPrice: num(p.listPrice ?? p.salePrice),
      costPrice: 0,
      stock: num(p.quantity),
      images: (p.images ?? []).map((i) => str(i.url)).filter(Boolean),
      attributes: { categoryId: p.pimCategoryId, brandId: p.brandId },
    }));
  }

  /**
   * Sipariş durumu → Trendyol paket durumu.
   *  Hazırlanıyor → "Picking" (fatura no verilirse "Invoiced"); İptal → tedarik edilemedi (UnSupplied).
   *  Kargoda: Trendyol anlaşmalı kargoda paket kargo firması teslim alınca otomatik "Kargoda" olur;
   *  kendi kargonuzla gönderiyorsanız takip numarası bildirilir.
   */
  async updateOrderStatus(u: OrderStatusUpdate): Promise<AdapterResult> {
    const pkg = rec(u.raw);
    const pkgId = str(pkg.id) || u.externalOrderId.split('/')[1];
    if (!pkgId) return { ok: false, message: 'Trendyol paket numarası bulunamadı (sipariş yeniden senkronlanmalı).' };
    const lines = recs(pkg.lines).map((l) => ({ lineId: num(l.id), quantity: num(l.quantity, 1) })).filter((l) => l.lineId);
    const base = this.url(`/order/sellers/{sellerId}/shipment-packages/${encodeURIComponent(pkgId)}`);
    try {
      switch (u.status) {
        case 'preparing':
          if (!lines.length) return { ok: false, message: 'Trendyol sipariş satırları bulunamadı.' };
          await request(base, { method: 'PUT', headers: this.headers, json: { lines, params: {}, status: 'Picking' } });
          if (u.invoiceNumber) {
            await request(base, { method: 'PUT', headers: this.headers, json: { lines, params: { invoiceNumber: u.invoiceNumber }, status: 'Invoiced' } });
          }
          return { ok: true, message: `Trendyol'da "Hazırlanıyor" (Picking${u.invoiceNumber ? ' → Invoiced' : ''}) yapıldı.` };
        case 'shipped':
          if (u.trackingNumber) {
            await request(`${base}/update-tracking-number`, { method: 'PUT', headers: this.headers, json: { trackingNumber: u.trackingNumber } });
            return { ok: true, message: `Trendyol'a kargo takip numarası bildirildi (${u.trackingNumber}).` };
          }
          return notSupported('Trendyol\'da paket, kargo firması teslim aldığında otomatik "Kargoda" olur. Kendi kargonuzla gönderiyorsanız takip numarası girin.');
        case 'delivered': {
          const tracking = u.trackingNumber || str(pkg.cargoTrackingNumber);
          if (!tracking) return notSupported('Trendyol teslimatı kargo firmasından otomatik alır.');
          await request(this.url(`/order/sellers/{sellerId}/manual-deliver/${encodeURIComponent(tracking)}`), { method: 'PUT', headers: this.headers });
          return { ok: true, message: 'Trendyol\'a "Teslim edildi" bildirildi.' };
        }
        case 'cancelled':
          if (!lines.length) return { ok: false, message: 'Trendyol sipariş satırları bulunamadı.' };
          await request(`${base}/items/unsupplied`, { method: 'PUT', headers: this.headers, json: { lines, reasonId: num(this.c.extra.cancelReasonId, 500) } });
          return { ok: true, message: 'Trendyol\'da sipariş "tedarik edilemedi" olarak iptal edildi.' };
        default:
          return notSupported('Trendyol\'da sipariş "Yeni" durumuna geri alınamaz.');
      }
    } catch (e) {
      return { ok: false, message: errorMessage(e) };
    }
  }
}

/** Trendyol kargo sağlayıcı adını motorun kullandığı firma koduna çevirir */
export function normalizeCarrier(name: string): string | null {
  const n = name.toLocaleLowerCase('tr-TR');
  if (!n) return null;
  if (n.includes('trendyol express') || n.includes('tex')) return 'TEX';
  if (n.includes('aras')) return 'Aras';
  if (n.includes('ptt')) return 'PTT';
  if (n.includes('yurtiçi') || n.includes('yurtici')) return 'Yurtiçi';
  if (n.includes('sürat') || n.includes('surat')) return 'Sürat';
  if (n.includes('kolay')) return 'Kolay Gelsin';
  if (n.includes('dhl')) return 'DHL eCommerce';
  if (n.includes('ceva')) return 'CEVA';
  if (n.includes('horoz')) return 'Horoz';
  if (n.includes('mng')) return 'MNG';
  return name;
}

function shippedAtOf(pkg: TrendyolPackage): string | null {
  const h = (pkg.packageHistories ?? []).find((x) => x.status === 'Shipped');
  return h?.createdDate ? new Date(num(h.createdDate)).toISOString() : null;
}

export function mapTrendyolStatus(s: string): OrderStatus {
  switch (s) {
    case 'Created': case 'Awaiting': return 'new';
    case 'Picking': case 'Invoiced': case 'Repack': return 'preparing';
    case 'Shipped': case 'AtCollectionPoint': return 'shipped';
    case 'Delivered': return 'delivered';
    case 'Cancelled': case 'UnDelivered': case 'Returned': case 'UnSupplied': return 'cancelled';
    default: return 'new';
  }
}

let categoryCache: { items: CategoryOption[]; exp: number } | null = null;
interface TyCategory { id?: number; name?: string; subCategories?: TyCategory[] }

interface TrendyolPackage {
  id?: number | string; orderNumber?: string; customerFirstName?: string; customerLastName?: string;
  totalPrice?: number; status?: string; orderDate?: number; cargoProviderName?: string; cargoDeci?: number;
  fastDelivery?: boolean; fastDeliveryType?: string; micro?: boolean; packageHistories?: Array<{ status?: string; createdDate?: number }>;
  lines?: Array<{ merchantSku?: string; sku?: string; barcode?: string; productName?: string; quantity?: number; price?: number; amount?: number }>;
}
interface TrendyolProduct {
  id?: string; barcode?: string; stockCode?: string; productMainId?: string; title?: string; description?: string;
  categoryName?: string; pimCategoryId?: number; brand?: string; brandId?: number; vatRate?: number; salePrice?: number;
  listPrice?: number; quantity?: number; images?: Array<{ url?: string }>;
}
