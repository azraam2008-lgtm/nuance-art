// Pazaryeri maliyet / kârlılık motoru — tip tanımları
// Tüm tutarlar TRY. "gross" = KDV dahil, "net" = KDV hariç.

export type VatMode =
  | 'included' // tutar KDV dahildir (Trendyol, N11, Koçtaş komisyonu gibi)
  | 'added' //    tutar KDV hariçtir, üzerine %20 KDV eklenerek faturalanır
  | 'none'; //    KDV yok

export type Basis =
  | 'gross' //               KDV dahil ürün satış tutarı
  | 'net' //                 KDV hariç ürün satış tutarı
  | 'gross_plus_shipping' // KDV dahil ürün + alıcının ödediği kargo
  | 'net_plus_shipping'; //  KDV hariç ürün + kargo

/** Kuralın uygulanma şartları (hepsi VE ile bağlanır) */
export interface Condition {
  sameDayShipped?: boolean; // "Bugün Kargoda" etiketli ve aynı gün kargoya verilmiş
  fastShipment?: boolean; //   1 gün termin / Hızlı Teslimat / Bugün Kargoda ve termine uyulmuş
  microExport?: boolean;
  kiosk?: boolean; //          Koçtaş: mağaza kasasında ödeme
  carrierIn?: string[];
  orderGrossAtMost?: number;
  orderGrossAbove?: number;
}

export interface FeeDef {
  code: string;
  label: string;
  kind: 'fixed' | 'percent';
  amount?: number; //   fixed: tutar (vat alanına göre KDV dahil/hariç)
  rate?: number; //     percent: 0.0199 = %1,99
  basis?: Basis; //     percent için matrah
  vat: VatMode;
  /** order: sipariş başına 1 kez · package: paket başına · unit: ürün adedi başına · sku_month: ayda ilk satan SKU başına */
  per: 'order' | 'package' | 'unit' | 'sku_month';
  when?: Condition;
  /** Şart sağlandığında uygulanacak alternatif tutar (ör. Bugün Kargoda 4,99 TL) */
  alt?: { amount: number; when: Condition; label: string };
  currency?: 'TRY' | 'USD'; // USD ise ayarlardaki kurla çevrilir (Etsy listeleme bedeli)
  note?: string;
  /** true ise hesaba katılmaz (isteğe bağlı bedeller: Etsy Offsite Ads, kur çevrimi…) */
  disabled?: boolean;
}

export interface BaremTier {
  /** Sipariş (aynı siparişteki tüm paketler) KDV dahil toplamı bu tutarın ALTINDA ise */
  upTo: number;
  /** Hızlı gönderim (1 gün termin / Hızlı Teslimat / Bugün Kargoda + zamanında teslim) fiyatları, KDV hariç */
  fast?: Record<string, number>;
  /** Standart (şartı sağlamayan) fiyatlar, KDV hariç */
  standard?: Record<string, number>;
}

export interface ShippingDef {
  payer: 'seller' | 'buyer';
  defaultCarrier: string;
  /** carrier_rates tablosundaki anahtar (ör. "trendyol"). Yoksa fallbackFlat kullanılır. */
  desiTable?: string;
  /** Desi fiyatına eklenecek posta hizmet bedeli oranı (fiyatlara dahil değilse) */
  postaHizmetRate?: number;
  barem?: {
    tiers: BaremTier[];
    maxDesi?: number;
    carriers?: string[]; // yalnızca bu firmalarla barem uygulanır
    requiresFast?: boolean; // hızlı gönderim şartı yoksa barem yok (Hepsiburada)
    /** Paket bölmede: sipariş toplamı barem altındaysa yalnızca en düşük desili 1 paket barem alır */
    splitPolicy: 'cheapest_one' | 'all';
  };
  /** Desi tablosu yoksa/aşılırsa paket başı varsayılan kargo maliyeti (KDV hariç) */
  fallbackFlat?: number;
}

export interface FeeRuleConfig {
  label: string;
  /** Satış KDV'si yerine kullanılacak oran (Etsy ihracat: 0) */
  salesVatOverride?: number | null;
  /** Platform bedellerindeki KDV indirilebilir mi (yurt içi faturalı: evet; Etsy KDV no.suz: hayır) */
  feeVatRecoverable: boolean;
  commission: {
    defaultRate: number;
    basis: Basis;
    vat: VatMode;
    categoryRates?: Record<string, number>;
    /** Dönemsel komisyon indirimi: 0.5 = %50 indirim (yeni mağaza kampanyası vb.) */
    discount?: { rate: number; label: string; from?: string; until?: string } | null;
  };
  stopaj: { rate: number; basis: 'net' };
  fees: FeeDef[];
  shipping: ShippingDef;
  sameDay?: { cutoffHour: number }; // "Bugün Kargoda" etiketinin gösterildiği son saat (hafta içi)
}

export interface RuleSource {
  title: string;
  url?: string;
  date?: string;
  kind: 'official' | 'user_file' | 'secondary';
}

export interface FeeRule {
  marketplace: string;
  effectiveFrom: string; // YYYY-MM-DD
  config: FeeRuleConfig;
  verified: boolean;
  notes: string[];
  sources: RuleSource[];
}

export type CarrierRates = Record<string, number[]>; // carrier → [desi0, desi1, ...] KDV hariç

// ---------------- Girdi ----------------

export interface CostItem {
  sku: string;
  title?: string;
  quantity: number;
  unitPriceGross: number;
  vatRate: number; // 0.20
  unitCostNet: number;
  costVatRate: number;
  packagingNet?: number; // birim başı ambalaj (KDV hariç)
  commissionRate?: number | null;
  category?: string;
  firstSaleThisMonth?: boolean; // Çiçeksepeti listeleme bedeli için
}

export interface CostPackage {
  id: string;
  items: CostItem[];
  desi: number;
  carrier?: string | null;
  orderedAt: string; // ISO
  shippedAt?: string | null;
  cancelled?: boolean;
  sameDayTag?: boolean;
  fastTag?: boolean;
  handlingDays?: number;
  /** Pazaryeri API'si siparişin "Bugün Kargoda" / "Hızlı Teslimat" olduğunu bildiriyorsa */
  marketplaceSameDay?: boolean | null;
  marketplaceFast?: boolean | null;
  /** Pazaryerinin bildirdiği gerçek komisyon (KDV hariç) */
  actualCommissionNet?: number | null;
  /** Pazaryerinin bildirdiği gerçek kargo bedeli (KDV hariç) */
  actualShippingNet?: number | null;
  /** Desi tablosu yoksa ürün/ilan bazında elle girilen kargo maliyeti (KDV hariç) */
  manualShippingNet?: number | null;
  buyerShippingGross?: number;
  sellerDiscountGross?: number;
  microExport?: boolean;
  kiosk?: boolean;
}

export interface CostSettings {
  adRate: number; //         satış (KDV dahil) üzerinden reklam gideri oranı
  returnRiskRate: number; // satış (KDV dahil) üzerinden iade/ceza risk oranı
  usdTry: number;
  stopajAsCost: boolean;
  exportCostVatRecoverable: boolean;
}

// ---------------- Çıktı ----------------

export type LineGroup = 'commission' | 'fee' | 'shipping' | 'tax' | 'product' | 'other';

export interface CostLine {
  code: string;
  label: string;
  group: LineGroup;
  gross: number; //       satıcıdan çıkan toplam (KDV dahil)
  vat: number; //         içindeki KDV
  recoverable: boolean; // KDV indirilebilir mi
  cost: number; //        kâra etkisi = gross - (recoverable ? vat : 0)
  note?: string;
}

export interface SpeedInfo {
  sameDayEligible: boolean;
  sameDayMet: boolean | null; // null = henüz kargoya verilmedi
  fastEligible: boolean;
  fastMet: boolean | null;
  deadline: string | null;
}

export interface CostResult {
  packageId: string;
  status: 'estimate' | 'final';
  revenueGross: number;
  revenueNet: number;
  outputVat: number;
  lines: CostLine[];
  totals: Record<LineGroup, number>;
  totalCost: number;
  vatPayable: number;
  netProfit: number;
  /** Yuvarlanmamış net kâr (fiyat çözücü için) */
  netProfitExact: number;
  marginOnRevenue: number; // net kâr / KDV hariç ciro
  marginOnCost: number; //    net kâr / ürün maliyeti (KDV dahil) — Excel modeli ile aynı
  speed: SpeedInfo;
  notes: string[];
}
