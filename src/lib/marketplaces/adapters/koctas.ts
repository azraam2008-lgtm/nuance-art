import type { OrderStatus } from '../meta';
import type {
  AdapterResult, MarketplaceAdapter, MarketplaceCredentials, NormalizedOrder,
  ProductPayload, RemoteProduct, StockUpdate,
} from '../types';
import { chunk, errorMessage, num, request, str } from '../http';

/**
 * Koçtaş Pazaryeri adaptörü — Koçtaş satıcı operasyonları Mirakl platformunda yürür.
 * Kimlik doğrulama: "Authorization: {Mirakl API anahtarı}" (Satış Ortağım paneli > Profil > API anahtarı)
 * Taban adres Koçtaş'ın Mirakl ortamıdır (ör. https://koctas-prod.mirakl.net) — extra_config.baseUrl ile girilmelidir.
 * Kullanılan Mirakl Seller API uçları: A01 hesap, OF24 teklif (fiyat/stok), OR11 siparişler, OF51 teklif listesi.
 * Mirakl siparişte gerçek komisyonu (total_commission) bildirir; kârlılık motoru bu tutarı kullanır.
 */
export class KoctasAdapter implements MarketplaceAdapter {
  readonly name = 'koctas' as const;
  readonly mode = 'live' as const;
  private readonly base: string;

  constructor(private readonly c: MarketplaceCredentials) {
    this.base = str(c.extra.baseUrl).replace(/\/$/, '');
  }

  private get headers() { return { Authorization: this.c.apiKey }; }
  private shop() { return this.c.sellerId ? `shop_id=${encodeURIComponent(this.c.sellerId)}` : ''; }
  private ensureBase() { if (!this.base) throw new Error('Koçtaş Mirakl taban adresi (extra_config.baseUrl) tanımlı değil.'); }

  async testConnection(): Promise<AdapterResult> {
    try {
      this.ensureBase();
      const res = await request<{ shop_name?: string; shop_id?: number }>(`${this.base}/api/account?${this.shop()}`, { headers: this.headers, retries: 0 });
      return { ok: true, message: `Bağlantı başarılı: ${res?.shop_name ?? 'mağaza'} (#${res?.shop_id ?? '-'}).` };
    } catch (e) {
      return { ok: false, message: errorMessage(e) };
    }
  }

  /** Mirakl'da ürün kataloğu operatöre aittir: barkod Koçtaş kataloğunda varsa teklif (offer) oluşturulur. */
  async createProduct(p: ProductPayload): Promise<AdapterResult> {
    try {
      this.ensureBase();
      const res = await request<{ import_id?: number }>(`${this.base}/api/offers?${this.shop()}`, {
        method: 'POST', headers: this.headers,
        json: { offers: [{ shop_sku: p.sku, product_id: p.barcode, product_id_type: str(this.c.extra.productIdType) || 'EAN', price: p.price, quantity: Math.max(0, p.stock), state_code: '11', update_delete: 'update', description: p.description || undefined }] },
      });
      return { ok: true, status: 'pending', externalId: p.sku, ref: res?.import_id != null ? String(res.import_id) : null,
        message: `Teklif içe aktarımı başlatıldı (import #${res?.import_id ?? '-'}). Barkod Koçtaş kataloğunda yoksa Mirakl ürün şablonuyla katalog yüklemesi gerekir.` };
    } catch (e) {
      return { ok: false, status: 'error', message: errorMessage(e) };
    }
  }

  async checkListing(ref: string): Promise<AdapterResult> {
    try {
      this.ensureBase();
      const res = await request<{ status?: string; lines_in_error?: number; lines_in_success?: number }>(`${this.base}/api/offers/imports/${encodeURIComponent(ref)}?${this.shop()}`, { headers: this.headers });
      if (res?.status === 'COMPLETE') {
        return (res.lines_in_error ?? 0) > 0 && !(res.lines_in_success ?? 0)
          ? { ok: false, status: 'error', message: 'Teklif içe aktarımı hatalı (Mirakl hata raporuna bakın).' }
          : { ok: true, status: 'active', message: 'Teklif yayında.' };
      }
      return { ok: true, status: 'pending', message: `Durum: ${res?.status ?? 'işleniyor'}` };
    } catch (e) {
      return { ok: false, status: 'pending', message: errorMessage(e) };
    }
  }

  async updateStock(items: StockUpdate[]): Promise<AdapterResult> {
    try {
      this.ensureBase();
      for (const part of chunk(items, 500)) {
        await request(`${this.base}/api/offers?${this.shop()}`, {
          method: 'POST', headers: this.headers,
          json: { offers: part.map((i) => ({ shop_sku: i.sku, product_id: i.barcode, product_id_type: str(this.c.extra.productIdType) || 'EAN', price: i.price, quantity: Math.max(0, i.quantity), state_code: '11', update_delete: 'update' })) },
        });
      }
      return { ok: true, message: `${items.length} ürün stoğu gönderildi.` };
    } catch (e) {
      return { ok: false, message: errorMessage(e) };
    }
  }

  async fetchOrders(since: Date): Promise<NormalizedOrder[]> {
    this.ensureBase();
    const out: NormalizedOrder[] = [];
    for (let offset = 0; offset < 10_000; offset += 100) {
      const q = new URLSearchParams({ start_update_date: since.toISOString(), max: '100', offset: String(offset) });
      const res = await request<{ orders?: MiraklOrder[]; total_count?: number }>(`${this.base}/api/orders?${q}&${this.shop()}`, { headers: this.headers });
      for (const o of res?.orders ?? []) {
        const items = (o.order_lines ?? []).map((l) => ({
          sku: str(l.offer_sku), title: str(l.product_title), quantity: num(l.quantity, 1),
          unitPrice: num(l.price_unit ?? (num(l.price) / Math.max(1, num(l.quantity, 1)))),
        }));
        out.push({
          externalOrderId: str(o.order_id),
          customerName: `${str(o.customer?.firstname)} ${str(o.customer?.lastname)}`.trim(),
          totalAmount: num(o.total_price),
          status: mapMiraklStatus(str(o.order_state)),
          orderDate: new Date(str(o.created_date) || Date.now()).toISOString(),
          items,
          raw: o,
          actualCommissionNet: o.total_commission != null ? num(o.total_commission) : null,
          buyerShippingGross: num(o.shipping_price, 0),
          shipment: { carrier: str(o.shipping_company) || null, shippedAt: o.shipping_date ? new Date(o.shipping_date).toISOString() : null },
        });
      }
      if ((res?.orders?.length ?? 0) < 100) break;
    }
    return out;
  }

  async fetchProducts(page: number, size: number): Promise<RemoteProduct[]> {
    this.ensureBase();
    const res = await request<{ offers?: Array<Record<string, unknown>> }>(`${this.base}/api/offers?max=${size}&offset=${page * size}&${this.shop()}`, { headers: this.headers });
    return (res?.offers ?? []).map((o) => ({
      externalId: str(o.offer_id), sku: str(o.shop_sku), barcode: str(o.product_sku), title: str(o.product_title), description: '', category: '', brand: '',
      vatRate: 20, price: num(o.price), listPrice: num(o.price), costPrice: 0, stock: num(o.quantity), images: [], attributes: {},
    }));
  }
}

function mapMiraklStatus(s: string): OrderStatus {
  switch (s) {
    case 'WAITING_ACCEPTANCE': case 'WAITING_DEBIT': case 'WAITING_DEBIT_PAYMENT': case 'STAGING': return 'new';
    case 'SHIPPING': return 'preparing';
    case 'SHIPPED': case 'TO_COLLECT': return 'shipped';
    case 'RECEIVED': case 'CLOSED': return 'delivered';
    case 'CANCELED': case 'REFUSED': case 'INCIDENT_OPEN': return 'cancelled';
    default: return 'new';
  }
}

interface MiraklOrder {
  order_id?: string; order_state?: string; created_date?: string; shipping_date?: string; total_price?: number; shipping_price?: number;
  total_commission?: number; shipping_company?: string; customer?: { firstname?: string; lastname?: string };
  order_lines?: Array<{ offer_sku?: string; product_title?: string; quantity?: number; price?: number; price_unit?: number }>;
}
