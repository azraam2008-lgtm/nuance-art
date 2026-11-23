import type { OrderStatus } from '../meta';
import type {
  AdapterResult, CategoryOption, MarketplaceAdapter, MarketplaceCredentials, NormalizedOrder, OrderStatusUpdate, ProductPayload, RemoteProduct, StockUpdate,
} from '../types';
import { cachedCategories, errorMessage, flattenCategories, notSupported, num, rec, recs, request, searchIn, str } from '../http';

/**
 * Etsy Open API v3 adaptörü.
 * - x-api-key: Keystring (Shared Secret girildiyse "keystring:sharedsecret")
 * - OAuth 2.0 (PKCE) erişim jetonu: extra_config.accessToken / refreshToken (süresi dolunca otomatik yenilenir)
 * - sellerId = Shop ID
 * Tutarlar mağaza para biriminde gelir ve TRY'ye çevrilir (Ayarlar > Döviz kurları; TCMB'den günlük güncellenir).
 * Ürün oluşturmak için extra_config.taxonomyId ve shippingProfileId gerekir (Etsy kuralı).
 */
export class EtsyAdapter implements MarketplaceAdapter {
  readonly name = 'etsy' as const;
  readonly mode = 'live' as const;
  private readonly base = 'https://openapi.etsy.com/v3/application';

  constructor(private readonly c: MarketplaceCredentials, private readonly saveExtra?: (extra: Record<string, unknown>) => Promise<void>) {}

  private fx(currency: string): number {
    if (!currency || currency === 'TRY') return 1;
    const rates = (this.c.extra.__fx ?? {}) as Record<string, number>;
    const r = rates[currency];
    if (!r) throw new Error(`${currency} → TRY kuru tanımlı değil (Ayarlar > Döviz).`);
    return r;
  }

  private async token(): Promise<string> {
    const exp = num(this.c.extra.accessTokenExpiresAt, 0);
    if (str(this.c.extra.accessToken) && Date.now() < exp - 60_000) return str(this.c.extra.accessToken);
    const refresh = str(this.c.extra.refreshToken);
    if (!refresh) throw new Error('Etsy OAuth refresh token tanımlı değil (Ayarlar > Gelişmiş > refreshToken).');
    const res = await request<{ access_token?: string; refresh_token?: string; expires_in?: number }>('https://api.etsy.com/v3/public/oauth/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', client_id: this.c.apiKey, refresh_token: refresh }).toString(), retries: 0,
    });
    if (!res?.access_token) throw new Error('Etsy erişim jetonu yenilenemedi.');
    this.c.extra.accessToken = res.access_token;
    this.c.extra.refreshToken = res.refresh_token ?? refresh;
    this.c.extra.accessTokenExpiresAt = Date.now() + num(res.expires_in, 3600) * 1000;
    if (this.saveExtra) {
      const { __fx: _ignored, ...rest } = this.c.extra; // eslint-disable-line @typescript-eslint/no-unused-vars
      await this.saveExtra(rest);
    }
    return res.access_token;
  }

  private async headers(auth = true): Promise<Record<string, string>> {
    const key = this.c.apiSecret ? `${this.c.apiKey}:${this.c.apiSecret}` : this.c.apiKey;
    return { 'x-api-key': key, ...(auth ? { Authorization: `Bearer ${await this.token()}` } : {}) };
  }
  private get shop() { return encodeURIComponent(this.c.sellerId); }

  async testConnection(): Promise<AdapterResult> {
    try {
      const res = await request<{ shop_name?: string; currency_code?: string }>(`${this.base}/shops/${this.shop}`, { headers: await this.headers(), retries: 0 });
      return { ok: true, message: `Bağlantı başarılı: ${res?.shop_name ?? 'mağaza'} (${res?.currency_code ?? '-'}).` };
    } catch (e) {
      return { ok: false, message: errorMessage(e) };
    }
  }

  async createProduct(p: ProductPayload): Promise<AdapterResult> {
    const taxonomyId = num(p.attributes.taxonomyId ?? this.c.extra.taxonomyId);
    const shippingProfileId = num(p.attributes.shippingProfileId ?? this.c.extra.shippingProfileId);
    if (!taxonomyId || !shippingProfileId) return { ok: false, status: 'error', message: 'Etsy taxonomyId ve shippingProfileId gerekli (Ayarlar > Gelişmiş).' };
    try {
      const currency = str(this.c.extra.shopCurrency) || 'USD';
      const price = Math.round((p.price / this.fx(currency)) * 100) / 100;
      const res = await request<{ listing_id?: number }>(`${this.base}/shops/${this.shop}/listings`, {
        method: 'POST', headers: await this.headers(),
        json: {
          quantity: Math.max(1, p.stock), title: p.title.slice(0, 140), description: p.description || p.title, price,
          who_made: str(this.c.extra.whoMade) || 'i_did', when_made: str(this.c.extra.whenMade) || 'made_to_order',
          taxonomy_id: taxonomyId, shipping_profile_id: shippingProfileId, sku: [p.sku], type: 'physical', state: 'draft',
        },
      });
      let imgNote = '';
      if (res?.listing_id && p.images.length) {
        imgNote = await this.uploadImages(String(res.listing_id), p.images).then(() => ' Fotoğraflar yüklendi.', (e) => ` Fotoğraflar yüklenemedi: ${errorMessage(e)}.`);
      }
      return { ok: true, status: 'pending', externalId: res?.listing_id != null ? String(res.listing_id) : null,
        message: `Etsy'de taslak ilan oluşturuldu.${imgNote} Etsy taslakları otomatik yayınlamaz; Etsy Shop Manager'dan "Publish" deyin.` };
    } catch (e) {
      return { ok: false, status: 'error', message: errorMessage(e) };
    }
  }

  async checkListing(ref: string): Promise<AdapterResult> {
    return { ok: true, status: 'pending', message: `Etsy ilanı #${ref} taslak durumunda.` };
  }

  /** Etsy envanteri ilan bazında tutulur: mevcut envanter okunur, adetler güncellenip geri yazılır. */
  async updateStock(items: StockUpdate[]): Promise<AdapterResult> {
    try {
      const h = await this.headers();
      for (const i of items) {
        if (!i.externalProductId) continue;
        const inv = await request<{ products?: Array<{ sku?: string; property_values?: unknown[]; offerings?: Array<{ price?: { amount: number; divisor: number }; quantity?: number; is_enabled?: boolean }> }> }>(
          `${this.base}/listings/${encodeURIComponent(i.externalProductId)}/inventory`, { headers: h });
        const products = (inv?.products ?? []).map((pr) => ({
          sku: pr.sku ?? i.sku,
          property_values: pr.property_values ?? [],
          offerings: (pr.offerings ?? []).map((o) => ({ price: o.price ? o.price.amount / o.price.divisor : 0, quantity: Math.max(0, i.quantity), is_enabled: i.quantity > 0 ? true : !!o.is_enabled })),
        }));
        await request(`${this.base}/listings/${encodeURIComponent(i.externalProductId)}/inventory`, { method: 'PUT', headers: h, json: { products } });
      }
      return { ok: true, message: `${items.length} ilanın stoğu güncellendi.` };
    } catch (e) {
      return { ok: false, message: errorMessage(e) };
    }
  }

  async fetchOrders(since: Date, until: Date): Promise<NormalizedOrder[]> {
    const out: NormalizedOrder[] = [];
    const h = await this.headers();
    for (let offset = 0; offset < 5_000; offset += 100) {
      const q = new URLSearchParams({ min_created: String(Math.floor(since.getTime() / 1000)), max_created: String(Math.floor(until.getTime() / 1000)), limit: '100', offset: String(offset) });
      const res = await request<{ results?: EtsyReceipt[]; count?: number }>(`${this.base}/shops/${this.shop}/receipts?${q}`, { headers: h });
      for (const r of res?.results ?? []) {
        const currency = r.grandtotal?.currency_code ?? 'USD';
        const fx = this.fx(currency);
        const money = (m?: { amount: number; divisor: number }) => (m ? (m.amount / m.divisor) * fx : 0);
        const items = (r.transactions ?? []).map((t) => ({ sku: str(t.sku), title: str(t.title), quantity: num(t.quantity, 1), unitPrice: money(t.price) }));
        const shippedTs = r.shipments?.[0]?.shipment_notification_timestamp;
        out.push({
          externalOrderId: String(r.receipt_id),
          customerName: str(r.name),
          totalAmount: money(r.grandtotal),
          status: mapEtsyStatus(r),
          orderDate: new Date(num(r.create_timestamp) * 1000).toISOString(),
          items,
          raw: r,
          buyerShippingGross: money(r.total_shipping_cost),
          sellerDiscountGross: money(r.discount_amt),
          currency,
          fxRate: fx,
          shipment: { carrier: str(r.shipments?.[0]?.carrier_name) || null, shippedAt: shippedTs ? new Date(shippedTs * 1000).toISOString() : null },
        });
      }
      if ((res?.results?.length ?? 0) < 100) break;
    }
    return out;
  }

  async fetchProducts(page: number, size: number): Promise<RemoteProduct[]> {
    const res = await request<{ results?: Array<{ listing_id: number; title?: string; description?: string; quantity?: number; skus?: string[]; price?: { amount: number; divisor: number; currency_code: string } }> }>(
      `${this.base}/shops/${this.shop}/listings?state=active&limit=${size}&offset=${page * size}`, { headers: await this.headers() });
    return (res?.results ?? []).map((l) => {
      const price = l.price ? (l.price.amount / l.price.divisor) * this.fx(l.price.currency_code) : 0;
      return { externalId: String(l.listing_id), sku: l.skus?.[0] ?? String(l.listing_id), barcode: l.skus?.[0] ?? String(l.listing_id), title: str(l.title), description: str(l.description),
        category: '', brand: '', vatRate: 0, price, listPrice: price, costPrice: 0, stock: num(l.quantity), images: [], attributes: {} };
    });
  }

  /** Sipariş durumu → Etsy. Yalnızca "Kargoda" bildirilebilir (takip numarası varsa alıcıya iletilir). */
  async updateOrderStatus(u: OrderStatusUpdate): Promise<AdapterResult> {
    if (u.status !== 'shipped') {
      return notSupported(u.status === 'cancelled' ? 'Etsy\'de iptal/iade Etsy Shop Manager\'dan yapılır. Stok panelde iade edildi.' : 'Etsy yalnızca "Kargoda" bilgisini kabul eder.');
    }
    try {
      const receiptId = str(rec(u.raw).receipt_id) || u.externalOrderId;
      await request(`${this.base}/shops/${this.shop}/receipts/${encodeURIComponent(receiptId)}/tracking`, {
        method: 'POST', headers: await this.headers(),
        json: { ...(u.trackingNumber ? { tracking_code: u.trackingNumber } : {}), ...(u.carrier ? { carrier_name: u.carrier } : {}), send_bcc: false },
      });
      return { ok: true, message: 'Etsy\'de sipariş "gönderildi" yapıldı.' };
    } catch (e) {
      return { ok: false, message: errorMessage(e) };
    }
  }

  /** Etsy kategori (taxonomy) araması */
  async searchCategories(q: string): Promise<CategoryOption[]> {
    const all = await cachedCategories('etsy', async () => {
      const res = await request<{ results?: unknown[] }>(`${this.base}/seller-taxonomy/nodes`, { headers: await this.headers(false) });
      return flattenCategories(res?.results ?? [], { children: ['children'] });
    });
    return searchIn(all, q);
  }

  /** Görselleri Etsy ilanına yükler (Etsy URL kabul etmez; dosya olarak gönderilir) */
  private async uploadImages(listingId: string, urls: string[]) {
    const h = await this.headers();
    for (const [i, url] of urls.slice(0, 10).entries()) {
      const img = await fetch(url, { cache: 'no-store' });
      if (!img.ok) continue;
      const form = new FormData();
      form.append('image', new Blob([await img.arrayBuffer()], { type: img.headers.get('content-type') ?? 'image/jpeg' }), `foto-${i + 1}.jpg`);
      form.append('rank', String(i + 1));
      await request(`${this.base}/shops/${this.shop}/listings/${encodeURIComponent(listingId)}/images`, { method: 'POST', headers: h, body: form });
    }
  }

  /** İçerik güncellemesi: başlık/açıklama; ilanda hiç görsel yoksa görseller de yüklenir */
  async updateProduct(p: ProductPayload, externalId: string | null): Promise<AdapterResult> {
    if (!externalId) return { ok: false, message: 'Etsy ilan numarası yok.' };
    try {
      const h = await this.headers();
      await request(`${this.base}/shops/${this.shop}/listings/${encodeURIComponent(externalId)}`, {
        method: 'PATCH', headers: h, json: { title: p.title.slice(0, 140), description: p.description || p.title },
      });
      const imgs = await request<{ count?: number }>(`${this.base}/listings/${encodeURIComponent(externalId)}/images`, { headers: h });
      if (!imgs?.count && p.images.length) await this.uploadImages(externalId, p.images);
      return { ok: true, message: `Etsy ilanı güncellendi${!imgs?.count && p.images.length ? ' (görseller yüklendi)' : ''}.` };
    } catch (e) {
      return { ok: false, message: errorMessage(e) };
    }
  }
}

function mapEtsyStatus(r: EtsyReceipt): OrderStatus {
  const s = str(r.status).toLowerCase();
  if (s === 'canceled' || s === 'fully refunded') return 'cancelled';
  if (s === 'completed') return 'delivered';
  if (r.is_shipped) return 'shipped';
  return 'new';
}

interface EtsyReceipt {
  receipt_id: number; name?: string; status?: string; is_shipped?: boolean; create_timestamp?: number;
  grandtotal?: { amount: number; divisor: number; currency_code: string }; total_shipping_cost?: { amount: number; divisor: number }; discount_amt?: { amount: number; divisor: number };
  shipments?: Array<{ carrier_name?: string; shipment_notification_timestamp?: number }>;
  transactions?: Array<{ sku?: string; title?: string; quantity?: number; price?: { amount: number; divisor: number } }>;
}
