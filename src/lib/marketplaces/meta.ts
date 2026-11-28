// İstemci ve sunucuda ortak kullanılan pazaryeri ve durum tanımları.
// Yeni bir pazaryeri eklerken: buraya meta, adapters/ altına adaptör, registry.ts'e fabrika,
// veritabanında `marketplaces` tablosuna bir satır ekleyin.

/** Pazaryerleri (her biri bir "ana" pazaryeri) */
export const BASE_MARKETPLACES = ['trendyol', 'hepsiburada', 'n11', 'ciceksepeti', 'pazarama', 'idefix', 'koctas', 'etsy'] as const;
export type BaseMarketplace = (typeof BASE_MARKETPLACES)[number];
/**
 * Aynı pazaryerinde ikinci mağaza (ör. iki ayrı Trendyol satıcı hesabı): "trendyol_2".
 * Kendi API anahtarı, ilanları ve siparişleri vardır; komisyon/kargo kuralları ve adaptör ana pazaryeriyle aynıdır.
 * Stok ortak havuzdan gider: bir mağazada satış olunca diğerinde de düşer.
 */
export const MARKETPLACES = [
  'trendyol', 'hepsiburada', 'n11', 'ciceksepeti', 'pazarama', 'idefix', 'koctas', 'etsy',
  'trendyol_2', 'hepsiburada_2', 'n11_2', 'ciceksepeti_2', 'pazarama_2', 'idefix_2', 'koctas_2', 'etsy_2',
] as const;
export type MarketplaceName = (typeof MARKETPLACES)[number];
/** İkinci mağazanın ana pazaryeri (kurallar, adaptör, rehber için) */
export const baseOf = (m: string): BaseMarketplace => m.replace(/_2$/, '') as BaseMarketplace;
export const isSecondAccount = (m: string) => m.endsWith('_2');
/** Ana pazaryeri kaydından ikinci mağaza kaydını türetir */
export function withSecondAccounts<T>(base: Record<BaseMarketplace, T>, second: (b: BaseMarketplace, v: T) => T): Record<MarketplaceName, T> {
  const out = { ...base } as Record<string, T>;
  for (const b of BASE_MARKETPLACES) out[`${b}_2`] = second(b, base[b]);
  return out as Record<MarketplaceName, T>;
}

export interface MarketplaceMeta {
  label: string;
  color: string;
  /** Grafik ve rozetlerde kullanılan yumuşak ton */
  chart: string;
  badgeClass: string;
  sellerIdLabel: string;
  apiKeyLabel: string;
  apiSecretLabel: string;
  docsUrl: string;
  /** Türkçe ekler: "Trendyol'dan" / "Trendyol'da" */
  from: string;
  at: string;
}

const BASE_META: Record<BaseMarketplace, MarketplaceMeta> = {
  trendyol: {
    label: 'Trendyol',
    color: '#F27A1A',
    chart: '#E0823F',
    badgeClass: 'bg-[#F27A1A] text-white',
    sellerIdLabel: 'Satıcı ID',
    apiKeyLabel: 'API Key',
    apiSecretLabel: 'API Secret',
    docsUrl: 'https://developers.trendyol.com',
    from: "Trendyol'dan",
    at: "Trendyol'da",
  },
  hepsiburada: {
    label: 'Hepsiburada',
    color: '#FF6000',
    chart: '#CF6650',
    badgeClass: 'bg-black text-[#FF6000] ring-1 ring-[#FF6000]',
    sellerIdLabel: 'Merchant ID',
    apiKeyLabel: 'Kullanıcı adı',
    apiSecretLabel: 'Servis anahtarı (Secret Key)',
    docsUrl: 'https://developers.hepsiburada.com',
    from: "Hepsiburada'dan",
    at: "Hepsiburada'da",
  },
  n11: {
    label: 'N11',
    color: '#7B2CBF',
    chart: '#8A6BBE',
    badgeClass: 'bg-gradient-to-r from-[#7B2CBF] to-[#E11D48] text-white',
    sellerIdLabel: '-',
    apiKeyLabel: 'App Key',
    apiSecretLabel: 'App Secret',
    docsUrl: 'https://www.n11.com/magazalar/entegrasyon',
    from: "N11'den",
    at: "N11'de",
  },
  ciceksepeti: {
    label: 'Çiçeksepeti',
    color: '#1E88E5',
    chart: '#4F8FD1',
    badgeClass: 'bg-[#1E88E5] text-white',
    sellerIdLabel: 'Satıcı ID',
    apiKeyLabel: 'API Key',
    apiSecretLabel: 'API Secret',
    docsUrl: 'https://apis.ciceksepeti.com',
    from: "Çiçeksepeti'nden",
    at: "Çiçeksepeti'nde",
  },
  pazarama: {
    label: 'Pazarama',
    color: '#0FA0DC',
    chart: '#3FA7A0',
    badgeClass: 'bg-[#0FA0DC] text-white',
    sellerIdLabel: 'Satıcı ID',
    apiKeyLabel: 'API Key (Client ID)',
    apiSecretLabel: 'API Secret (Client Secret)',
    docsUrl: 'https://isortagim.pazarama.com',
    from: "Pazarama'dan",
    at: "Pazarama'da",
  },
  idefix: {
    label: 'idefix',
    color: '#FFB300',
    chart: '#CDA03D',
    badgeClass: 'bg-[#FFB300] text-slate-900',
    sellerIdLabel: 'Satıcı (Vendor) ID',
    apiKeyLabel: 'API Key',
    apiSecretLabel: 'API Secret',
    docsUrl: 'https://developer.idefix.com',
    from: "idefix'ten",
    at: "idefix'te",
  },
  koctas: {
    label: 'Koçtaş',
    color: '#D7141E',
    chart: '#BF5652',
    badgeClass: 'bg-[#D7141E] text-white',
    sellerIdLabel: 'Mağaza (Shop) ID (birden çok mağazanız varsa)',
    apiKeyLabel: 'API Anahtarı',
    apiSecretLabel: '-',
    docsUrl: 'https://www.koctas.com.tr/koctasta-satici-ol',
    from: "Koçtaş'tan",
    at: "Koçtaş'ta",
  },
  etsy: {
    label: 'Etsy',
    color: '#F1641E',
    chart: '#A97A52',
    badgeClass: 'bg-[#F1641E] text-white',
    sellerIdLabel: 'Mağaza numarası (Shop ID)',
    apiKeyLabel: 'Keystring',
    apiSecretLabel: 'Shared Secret',
    docsUrl: 'https://developers.etsy.com/documentation',
    from: "Etsy'den",
    at: "Etsy'de",
  },
};

/** İki rengi karıştırır (t: 0 → a, 1 → b) */
export function mixHex(a: string, b: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

export const MARKETPLACE_META: Record<MarketplaceName, MarketplaceMeta> = withSecondAccounts(BASE_META, (_b, m) => ({
  // İkinci mağaza ana pazaryerinin daha koyu tonu: grafiklerde ve rozetlerde ayırt edilir
  ...m, label: `${m.label} 2`, from: `${m.label} 2'den`, at: `${m.label} 2'de`, chart: mixHex(m.chart, '#1E2230', 0.38),
}));

export const ORDER_PREFIX: Record<MarketplaceName, string> = withSecondAccounts<string>({
  trendyol: 'TY', hepsiburada: 'HB', n11: 'N11', ciceksepeti: 'CS', pazarama: 'PZ', idefix: 'IDF', koctas: 'KT', etsy: 'ETSY',
}, (_b, p) => `${p}2`);

export const ORDER_STATUSES = ['new', 'approved', 'preparing', 'invoiced', 'shipped', 'delivered', 'cancelled', 'returned'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_STATUS_META: Record<OrderStatus, { label: string; className: string }> = {
  new: { label: 'Yeni', className: 'bg-blue-100 text-blue-700' },
  approved: { label: 'Onaylandı', className: 'bg-sky-100 text-sky-700' },
  preparing: { label: 'Hazırlanıyor', className: 'bg-amber-100 text-amber-700' },
  invoiced: { label: 'Faturası kesildi', className: 'bg-orange-100 text-orange-700' },
  shipped: { label: 'Kargoda', className: 'bg-indigo-100 text-indigo-700' },
  delivered: { label: 'Teslim edildi', className: 'bg-emerald-100 text-emerald-700' },
  cancelled: { label: 'İptal edildi', className: 'bg-rose-100 text-rose-700' },
  returned: { label: 'İade edildi', className: 'bg-fuchsia-100 text-fuchsia-700' },
};

/** Kapanmış (gelir sayılmayan, stoğu iade edilmiş) durumlar */
export const isClosedStatus = (s: string) => s === 'cancelled' || s === 'returned';
/** Henüz kargoya verilmemiş açık durumlar (geciken sipariş kontrolü için) */
export const OPEN_STATUSES: OrderStatus[] = ['new', 'approved', 'preparing', 'invoiced'];

/** Sık görülen iade nedenleri (iade analizi için) */
export const RETURN_REASONS = ['Ürün hasarlı geldi', 'Yanlış ürün gönderildi', 'Beğenmedi / vazgeçti', 'Ürün açıklamayla uyuşmuyor', 'Beden / ölçü uymadı', 'Geç teslim', 'Diğer'] as const;

export const isMarketplace = (v: unknown): v is MarketplaceName =>
  typeof v === 'string' && (MARKETPLACES as readonly string[]).includes(v);

export const isOrderStatus = (v: unknown): v is OrderStatus =>
  typeof v === 'string' && (ORDER_STATUSES as readonly string[]).includes(v);
