// İstemci ve sunucuda ortak kullanılan pazaryeri ve durum tanımları.
// Yeni bir pazaryeri eklerken: buraya meta, adapters/ altına adaptör, registry.ts'e fabrika,
// veritabanında `marketplaces` tablosuna bir satır ekleyin.

export const MARKETPLACES = ['trendyol', 'hepsiburada', 'n11', 'ciceksepeti', 'pazarama', 'idefix', 'koctas', 'etsy'] as const;
export type MarketplaceName = (typeof MARKETPLACES)[number];

export interface MarketplaceMeta {
  label: string;
  color: string;
  badgeClass: string;
  sellerIdLabel: string;
  apiKeyLabel: string;
  apiSecretLabel: string;
  docsUrl: string;
  /** Türkçe ekler: "Trendyol'dan" / "Trendyol'da" */
  from: string;
  at: string;
}

export const MARKETPLACE_META: Record<MarketplaceName, MarketplaceMeta> = {
  trendyol: {
    label: 'Trendyol',
    color: '#F27A1A',
    badgeClass: 'bg-[#F27A1A] text-white',
    sellerIdLabel: 'Satıcı ID (Supplier ID)',
    apiKeyLabel: 'API Key',
    apiSecretLabel: 'API Secret',
    docsUrl: 'https://developers.trendyol.com',
    from: "Trendyol'dan",
    at: "Trendyol'da",
  },
  hepsiburada: {
    label: 'Hepsiburada',
    color: '#FF6000',
    badgeClass: 'bg-black text-[#FF6000] ring-1 ring-[#FF6000]',
    sellerIdLabel: 'Merchant ID',
    apiKeyLabel: 'Entegratör Kullanıcı Adı (User-Agent)',
    apiSecretLabel: 'Servis Anahtarı (Secret Key)',
    docsUrl: 'https://developers.hepsiburada.com',
    from: "Hepsiburada'dan",
    at: "Hepsiburada'da",
  },
  n11: {
    label: 'N11',
    color: '#7B2CBF',
    badgeClass: 'bg-gradient-to-r from-[#7B2CBF] to-[#E11D48] text-white',
    sellerIdLabel: 'Mağaza / Satıcı ID',
    apiKeyLabel: 'App Key',
    apiSecretLabel: 'App Secret',
    docsUrl: 'https://www.n11.com/magazalar/entegrasyon',
    from: "N11'den",
    at: "N11'de",
  },
  ciceksepeti: {
    label: 'Çiçeksepeti',
    color: '#1E88E5',
    badgeClass: 'bg-[#1E88E5] text-white',
    sellerIdLabel: 'Satıcı ID',
    apiKeyLabel: 'API Key (x-api-key)',
    apiSecretLabel: 'API Secret (kullanılmıyorsa boş bırakın)',
    docsUrl: 'https://apis.ciceksepeti.com',
    from: "Çiçeksepeti'nden",
    at: "Çiçeksepeti'nde",
  },
  pazarama: {
    label: 'Pazarama',
    color: '#0FA0DC',
    badgeClass: 'bg-[#0FA0DC] text-white',
    sellerIdLabel: 'Satıcı ID (Merchant ID)',
    apiKeyLabel: 'Client ID (API Key)',
    apiSecretLabel: 'Client Secret',
    docsUrl: 'https://isortagim.pazarama.com',
    from: "Pazarama'dan",
    at: "Pazarama'da",
  },
  idefix: {
    label: 'idefix',
    color: '#FFB300',
    badgeClass: 'bg-[#FFB300] text-slate-900',
    sellerIdLabel: 'Vendor ID',
    apiKeyLabel: 'API Key',
    apiSecretLabel: 'API Secret',
    docsUrl: 'https://developer.idefix.com',
    from: "idefix'ten",
    at: "idefix'te",
  },
  koctas: {
    label: 'Koçtaş',
    color: '#D7141E',
    badgeClass: 'bg-[#D7141E] text-white',
    sellerIdLabel: 'Mağaza (Shop) ID',
    apiKeyLabel: 'Mirakl API Anahtarı',
    apiSecretLabel: 'Kullanılmıyor (boş bırakın)',
    docsUrl: 'https://www.koctas.com.tr/koctasta-satici-ol',
    from: "Koçtaş'tan",
    at: "Koçtaş'ta",
  },
  etsy: {
    label: 'Etsy',
    color: '#F1641E',
    badgeClass: 'bg-[#F1641E] text-white',
    sellerIdLabel: 'Shop ID',
    apiKeyLabel: 'Keystring (x-api-key)',
    apiSecretLabel: 'Shared Secret',
    docsUrl: 'https://developers.etsy.com/documentation',
    from: "Etsy'den",
    at: "Etsy'de",
  },
};

export const ORDER_PREFIX: Record<MarketplaceName, string> = {
  trendyol: 'TY', hepsiburada: 'HB', n11: 'N11', ciceksepeti: 'CS', pazarama: 'PZ', idefix: 'IDF', koctas: 'KT', etsy: 'ETSY',
};

export const ORDER_STATUSES = ['new', 'preparing', 'shipped', 'delivered', 'cancelled'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_STATUS_META: Record<OrderStatus, { label: string; className: string }> = {
  new: { label: 'Yeni', className: 'bg-blue-100 text-blue-700' },
  preparing: { label: 'Hazırlanıyor', className: 'bg-amber-100 text-amber-700' },
  shipped: { label: 'Kargoda', className: 'bg-indigo-100 text-indigo-700' },
  delivered: { label: 'Teslim Edildi', className: 'bg-emerald-100 text-emerald-700' },
  cancelled: { label: 'İptal/İade', className: 'bg-rose-100 text-rose-700' },
};

export const isMarketplace = (v: unknown): v is MarketplaceName =>
  typeof v === 'string' && (MARKETPLACES as readonly string[]).includes(v);

export const isOrderStatus = (v: unknown): v is OrderStatus =>
  typeof v === 'string' && (ORDER_STATUSES as readonly string[]).includes(v);
