import type { MarketplaceName, OrderStatus } from './meta';

/** Veritabanından okunan (şifresi çözülmüş) kimlik bilgileri */
export interface MarketplaceCredentials {
  apiKey: string;
  apiSecret: string;
  sellerId: string;
  /** baseUrl, varsayılan kategori/marka/kargo şablonu vb. pazaryerine özel ayarlar */
  extra: Record<string, unknown>;
}

/** Pazaryerinden bağımsız ortak ürün modeli */
export interface ProductPayload {
  sku: string;
  /** Ana ürün kodu: aynı ürünün seçenekleri (varyantlar) pazaryerinde bu kodla tek ilan altında toplanır. Tek seçenekli üründe SKU. */
  groupCode: string;
  /** Seçenek değerleri, ör. {"Renk":"Kırmızı"} (tek seçenekli üründe boş) */
  variantAttributes: Record<string, string>;
  barcode: string;
  title: string;
  description: string;
  category: string;
  brand: string;
  vatRate: number;
  price: number;
  listPrice: number;
  costPrice: number;
  stock: number;
  images: string[];
  /** products.marketplace_attributes içinden bu pazaryerine ait kısım (categoryId, brandId, attributes...) */
  attributes: Record<string, unknown>;
}

export interface RemoteProduct extends Omit<ProductPayload, 'groupCode' | 'variantAttributes'> {
  externalId: string;
  /** Pazaryerindeki ana ürün kodu (varsa; seçenekleri gruplamak için) */
  groupCode?: string;
}

export interface StockUpdate {
  sku: string;
  barcode: string;
  externalProductId: string | null;
  quantity: number;
  price: number;
  listPrice: number;
}

export interface NormalizedOrderItem {
  sku: string;
  barcode?: string;
  title: string;
  quantity: number;
  unitPrice: number; // KDV dahil birim satış fiyatı (TRY)
  commissionRate?: number | null; // pazaryerinin bildirdiği komisyon oranı (%)
}

export interface NormalizedOrder {
  externalOrderId: string;
  customerName: string;
  totalAmount: number;
  status: OrderStatus;
  orderDate: string; // ISO
  items: NormalizedOrderItem[];
  raw?: unknown;
  /** Kargo & maliyet bilgileri (pazaryeri sağlıyorsa) — kârlılık motoru kullanır */
  shipment?: {
    carrier?: string | null;
    desi?: number | null;
    shippedAt?: string | null;
    sameDay?: boolean | null; //  pazaryeri siparişi "Bugün Kargoda" olarak işaretlediyse
    fast?: boolean | null; //     "Hızlı Teslimat"
    microExport?: boolean;
    kiosk?: boolean;
  };
  /** Pazaryerinin bildirdiği gerçek tutarlar (KDV hariç) */
  actualCommissionNet?: number | null;
  actualShippingNet?: number | null;
  buyerShippingGross?: number;
  sellerDiscountGross?: number;
  /** Orijinal para birimi ve TRY kuru (Etsy) — tüm tutarlar TRY'ye çevrilmiş gelir */
  currency?: string;
  fxRate?: number;
}

export type ListingState = 'active' | 'pending' | 'error';

export interface AdapterResult {
  ok: boolean;
  message: string;
  status?: ListingState;
  externalId?: string | null;
  /** batchRequestId / trackingId / taskId — onay durumunu sonradan sorgulamak için */
  ref?: string | null;
  /** Pazaryeri bu işlemi API ile desteklemiyor (hata değil; bilgi amaçlı) */
  unsupported?: boolean;
}

/**
 * Adapter Pattern: Her pazaryeri bu sözleşmeyi uygular.
 * Senkronizasyon motoru yalnızca bu arayüzü bilir; pazaryerine özgü hiçbir detay motor içinde yoktur.
 */
export interface MarketplaceAdapter {
  readonly name: MarketplaceName;
  readonly mode: 'live' | 'demo';
  testConnection(): Promise<AdapterResult>;
  createProduct(product: ProductPayload): Promise<AdapterResult>;
  updateStock(items: StockUpdate[]): Promise<AdapterResult>;
  fetchOrders(since: Date, until: Date): Promise<NormalizedOrder[]>;
  fetchProducts(page: number, size: number): Promise<RemoteProduct[]>;
  /** Onay bekleyen ilanın (pending) güncel durumunu sorgular */
  checkListing(ref: string, product: { sku: string; barcode: string }): Promise<AdapterResult>;
  /** İsteğe bağlı: pazaryeri kataloğu yardımcıları (ürün sihirbazında arama) */
  searchCategories?(q: string): Promise<CategoryOption[]>;
  searchBrands?(q: string): Promise<BrandOption[]>;
  categoryAttributes?(categoryId: number): Promise<AttributeDef[]>;
  /** İsteğe bağlı: yayındaki ürünün başlık/açıklama/görsellerini günceller */
  updateProduct?(product: ProductPayload, externalId: string | null): Promise<AdapterResult>;
  /** Paneldeki sipariş durumu değişikliğini pazaryerine bildirir (Hazırlanıyor, Kargoda, İptal…) */
  updateOrderStatus?(u: OrderStatusUpdate): Promise<AdapterResult>;
  /** Kesilen faturanın bağlantısını pazaryerine bildirir (Trendyol). Olmayan pazaryerinde fatura numarası durum güncellemesiyle gider. */
  sendInvoiceLink?(u: InvoiceLinkUpdate): Promise<AdapterResult>;
}

export interface InvoiceLinkUpdate { externalOrderId: string; raw: unknown; invoiceNumber: string; invoiceLink: string; invoiceDate: string }

/** Pazaryerine bildirilecek sipariş durumu. raw: pazaryerinden gelen orijinal sipariş/paket verisi */
export interface OrderStatusUpdate {
  externalOrderId: string;
  status: OrderStatus;
  raw: unknown;
  items: Array<{ sku: string; quantity: number }>;
  trackingNumber?: string | null;
  carrier?: string | null;
  invoiceNumber?: string | null;
}

export interface CategoryOption { id: number | string; name: string; path: string }
export interface BrandOption { id: number | string; name: string }
export interface AttributeDef {
  id: number;
  name: string;
  required: boolean;
  allowCustom: boolean;
  varianter: boolean;
  values: Array<{ id: number; name: string }>;
}
