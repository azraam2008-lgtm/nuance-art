/* =====================================================================
 * Varsayılan pazaryeri kuralları (18 Kasım 2026 itibarıyla derlendi)
 *
 * verified = true  → resmi kaynak veya kullanıcının yüklediği pazaryeri belgesi
 * verified = false → ikincil kaynak (entegratör/muhasebe blogları); satıcı panelinden doğrulayın
 *
 * Kurallar veritabanına (fee_rules) kopyalanır ve Ayarlar > Pazaryeri Kuralları
 * ekranından düzenlenebilir. Yeni tarife geldiğinde yeni yürürlük tarihiyle
 * eklenir; eski siparişler kendi tarihindeki kuralla hesaplanmaya devam eder.
 * ===================================================================== */
import type { CarrierRates, FeeRule } from './types';
import trendyolRates from './data/trendyol-2026-10-05.json';
import idefixRates from './data/idefix-2026-01-28.json';

const TY_FAST_200 = { Aras: 48.33, 'DHL eCommerce': 57.08, 'Kolay Gelsin': 55.83, PTT: 38.74, 'Sürat': 54.58, TEX: 38.74, 'Yurtiçi': 83.33 };
const TY_FAST_350 = { Aras: 79.16, 'DHL eCommerce': 87.91, 'Kolay Gelsin': 86.66, PTT: 70.41, 'Sürat': 85.41, TEX: 70.41, 'Yurtiçi': 113.33 };
const TY_STD_200 = { Aras: 80.83, 'DHL eCommerce': 89.58, 'Kolay Gelsin': 88.33, PTT: 73.33, 'Sürat': 87.08, TEX: 73.33, 'Yurtiçi': 114.16 };
const TY_STD_350 = { Aras: 86.24, 'DHL eCommerce': 94.99, 'Kolay Gelsin': 93.74, PTT: 78.74, 'Sürat': 92.49, TEX: 78.74, 'Yurtiçi': 119.16 };

export const DEFAULT_RULES: FeeRule[] = [
  {
    marketplace: 'trendyol',
    effectiveFrom: '2026-10-05',
    verified: true,
    config: {
      label: 'Trendyol',
      feeVatRecoverable: true,
      commission: { defaultRate: 0.2, basis: 'gross', vat: 'included', categoryRates: {}, discount: null },
      stopaj: { rate: 0.01, basis: 'net' },
      sameDay: { cutoffHour: 14 },
      fees: [{
        code: 'platform_fee', label: 'Platform hizmet bedeli', kind: 'fixed', amount: 10.99, vat: 'added', per: 'package',
        when: { microExport: false },
        alt: { amount: 4.99, when: { sameDayShipped: true }, label: 'Platform hizmet bedeli (Bugün Kargoda, aynı gün taşımada)' },
        note: 'Paket bölmede etiketli pakete 4,99, etiketsiz pakete 10,99 TL + KDV. Mikro ihracatta uygulanmaz.',
      }],
      shipping: {
        payer: 'seller',
        defaultCarrier: 'TEX',
        desiTable: 'trendyol',
        barem: {
          tiers: [
            { upTo: 200, fast: TY_FAST_200, standard: TY_STD_200 },
            { upTo: 350, fast: TY_FAST_350, standard: TY_STD_350 },
          ],
          maxDesi: 10,
          splitPolicy: 'cheapest_one',
        },
      },
    },
    notes: [
      'Barem destek: 10 Ağustos 2026 itibarıyla taşıma durumuna geçen siparişler. Hızlı fiyat (Tablo 1) için termin 1 gün veya Hızlı Teslimat / Bugün Kargoda etiketi + etikete/termine uygun kargoya teslim şart; aksi halde Tablo 2.',
      'Paket bölme: sipariş toplamı barem altındaysa yalnızca desisi en düşük 1 paket barem altı, diğerleri desi tarifesiyle; barem üstündeyse tüm paketler desi tarifesiyle faturalanır.',
      'Kendi anlaşmalı kargo modeliyle çalışan satıcılar Barem Destek\'e dahil değildir (Ayarlar\'dan barem kaldırılıp kendi tarifeniz girilebilir).',
      '350 TL ve üzeri siparişler: 5 Ekim 2026 desi tablosu. 30 desi üzeri paketler için kargo şubesiyle mutabakat gerekir; 100 desi üzeri ağır kargo ek bedeli bu hesaba dahil değildir.',
      '"Aynı gün kargoda komisyonun yarısı" şeklinde bir kural resmi kaynaklarda bulunamadı. Aynı gün kargonun avantajı: platform hizmet bedeli 10,99 → 4,99 TL + KDV ve hızlı barem fiyatları. Yeni mağaza / kampanya komisyon indirimi varsa "komisyon indirimi" alanından tanımlayın.',
      'Barem için 10 desi üst sınırı ikincil kaynaklardan alınmıştır.',
      'Kategori komisyon oranları satıcı paneline/satıcı seviyesine göre değişir; ürün-pazaryeri ayarlarından ürün bazında girin.',
    ],
    sources: [
      { kind: 'user_file', title: 'Trendyol Akademi — Kargo Barem Destek Uygulaması (Tablo 1, Tablo 2, örnekler) ekran görüntüleri', date: '2026-08-10' },
      { kind: 'user_file', title: 'Trendyol Akademi — Platform Hizmet Bedeli: 10,99 TL + KDV, Bugün Kargoda 4,99 TL + KDV (ekran görüntüsü)' },
      { kind: 'user_file', title: 'Trendyol Güncel Kargo Fiyatları PDF — 5 Ekim 2026, KDV hariç', date: '2026-10-05' },
      { kind: 'user_file', title: 'Pazaryerleri_Fiyat_Hesaplama_KDVsiz.xlsx — komisyonun KDV dahil fiyat üzerinden hesaplanması, %1 stopaj' },
      { kind: 'secondary', title: 'EZV — Pazaryeri kargo ücretleri 2026 (barem 10 desi sınırı)', url: 'https://ezv.com.tr/kargo-ucretleri', date: '2026-11-02' },
    ],
  },
  {
    marketplace: 'hepsiburada',
    effectiveFrom: '2026-09-21',
    verified: false,
    config: {
      label: 'Hepsiburada',
      feeVatRecoverable: true,
      commission: { defaultRate: 0.18, basis: 'gross', vat: 'added', categoryRates: {}, discount: null },
      stopaj: { rate: 0.01, basis: 'net' },
      fees: [{ code: 'service_fee', label: 'Hizmet bedeli (teslimat başına)', kind: 'fixed', amount: 10.99, vat: 'added', per: 'package', note: '21 Eylül 2026 itibarıyla barem destekli teslimatlar dahil her teslimatta.' }],
      shipping: {
        payer: 'seller',
        defaultCarrier: 'HepsiJET',
        barem: {
          tiers: [
            { upTo: 200, fast: { HepsiJET: 43.99, 'Sürat': 43.99 } },
            { upTo: 400, fast: { HepsiJET: 75.99, 'Sürat': 75.99 } },
          ],
          carriers: ['HepsiJET', 'Sürat'],
          requiresFast: true,
          splitPolicy: 'all',
        },
        fallbackFlat: 81.99,
      },
    },
    notes: [
      'Barem: yalnızca HepsiJET veya Sürat Kargo, kargoya veriliş süresi 0–1 gün ve son 7 gün zamanında teslim performansı ≥ %90. "Satıcı Öder" ve "Mağaza Hesabı" modelleri yararlanamaz.',
      '400 TL ve üzeri ya da şartı sağlamayan gönderiler taşıyıcının desi tarifesiyle faturalanır. Hepsiburada desi tablosu sisteme girilmedi: tablo girilene kadar paket başı 81,99 TL (HepsiJET 0–2 desi) varsayılır.',
      'Komisyonun KDV hariç oran + %20 KDV olarak faturalandığı varsayıldı; sözleşmenizdeki matrahla doğrulayın.',
    ],
    sources: [
      { kind: 'secondary', title: 'EZV — Hepsiburada barem desteğine 10,99 TL hizmet bedeli eklendi', url: 'https://ezv.com.tr/blog/hepsiburada-kargo-ucretleri-guncellendi-barem-destegine-10-99-tl-hizmet-bedeli-eklendi', date: '2026-09-21' },
      { kind: 'secondary', title: 'EZV — Pazaryeri kargo ücretleri (HepsiJET 0–1 desi 81,99 TL)', url: 'https://ezv.com.tr/kargo-ucretleri', date: '2026-10-05' },
    ],
  },
  {
    marketplace: 'n11',
    effectiveFrom: '2026-06-02',
    verified: false,
    config: {
      label: 'N11',
      feeVatRecoverable: true,
      commission: { defaultRate: 0.18, basis: 'gross', vat: 'included', categoryRates: {}, discount: null },
      stopaj: { rate: 0.01, basis: 'net' },
      fees: [
        { code: 'marketing_fee', label: 'Pazarlama hizmet bedeli (%1)', kind: 'percent', rate: 0.01, basis: 'net', vat: 'added', per: 'package' },
        { code: 'marketplace_fee', label: 'Pazaryeri hizmet bedeli (%0,67)', kind: 'percent', rate: 0.0067, basis: 'net', vat: 'added', per: 'package' },
      ],
      shipping: {
        payer: 'seller',
        defaultCarrier: 'PTT',
        postaHizmetRate: 0.0235,
        barem: {
          tiers: [
            { upTo: 150, standard: { PTT: 38.74 } },
            { upTo: 300, standard: { PTT: 70.41 } },
          ],
          maxDesi: 10,
          splitPolicy: 'all',
        },
        fallbackFlat: 81.82,
      },
    },
    notes: [
      'Barem: "Şartlı Ödeme" kargo şablonu, 300 TL altı ve 10 desiye kadar. Yalnızca PTT fiyatları doğrulanabildi; diğer firmaların barem fiyatlarını panelden ekleyin.',
      'Kargo faturasına %2,35 posta hizmet bedeli eklenir. N11 desi tablosu girilene kadar paket başı 81,82 TL (PTT 0–1 desi) varsayılır.',
      'N11 sabit paket bedeli yerine satış üzerinden %1 pazarlama + %0,67 pazaryeri hizmet bedeli (+KDV) keser.',
    ],
    sources: [
      { kind: 'secondary', title: 'EZV — Pazaryeri kargo ücretleri (n11 barem, posta hizmet bedeli)', url: 'https://ezv.com.tr/kargo-ucretleri', date: '2026-06-02' },
      { kind: 'secondary', title: 'Zeisoft — N11 komisyon hesaplayıcı (%1 + %0,67 hizmet bedelleri)', url: 'https://zeisoft.com/araclar/n11-komisyon-hesaplayici/' },
    ],
  },
  {
    marketplace: 'ciceksepeti',
    effectiveFrom: '2026-01-01',
    verified: false,
    config: {
      label: 'Çiçeksepeti',
      feeVatRecoverable: true,
      commission: { defaultRate: 0.2, basis: 'net_plus_shipping', vat: 'added', categoryRates: {}, discount: null },
      stopaj: { rate: 0.01, basis: 'net' },
      fees: [
        { code: 'payment_fee', label: 'Güvenli ödeme altyapısı bedeli (%1,99)', kind: 'percent', rate: 0.0199, basis: 'gross_plus_shipping', vat: 'included', per: 'package' },
        { code: 'listing_fee', label: 'Listeleme bedeli (ayda satan ürün kodu başına)', kind: 'fixed', amount: 10.9, vat: 'included', per: 'sku_month', note: 'Ay içinde satışa dönüşen her ürün kodu için bir kez; o ayın ilk satışına yazılır.' },
      ],
      shipping: { payer: 'seller', defaultCarrier: 'Aras', fallbackFlat: 88.96 },
    },
    notes: [
      'Komisyon, kaynaklara göre (ürün + kargo) KDV hariç tutar üzerinden + %20 KDV. Kategori oranları Bayi Bilgi Formu\'nda.',
      'Müşteri merkezi hizmeti (ücretlendirilen her iletişim 25 TL + KDV) sipariş bazlı olmadığından otomatik hesaba girmez.',
      'Çiçeksepeti anlaşmalı kargo tablosu girilene kadar paket başı 88,96 TL (tahmini) varsayılır.',
    ],
    sources: [
      { kind: 'official', title: 'Çiçeksepeti Akademi SSS — komisyon, ödeme altyapı kullanım bedeli, listeleme bedeli', url: 'https://akademi.ciceksepeti.com/sikca-sorulan-sorular/' },
      { kind: 'secondary', title: 'Olay Bu İşte — Çiçeksepeti kâr hesaplama (%1,99 güvenli ödeme)', url: 'https://olaybuiste.com/ciceksepeti-kar-hesaplama/' },
      { kind: 'secondary', title: 'Pazarus — Çiçeksepeti listeleme 10,90 TL, müşteri merkezi 25 TL + KDV', url: 'https://pazarus.io/ciceksepeti-komisyon-hesaplama' },
    ],
  },
  {
    marketplace: 'pazarama',
    effectiveFrom: '2026-01-01',
    verified: false,
    config: {
      label: 'Pazarama',
      feeVatRecoverable: true,
      commission: {
        defaultRate: 0.17, basis: 'gross', vat: 'added', discount: null,
        categoryRates: { 'Moda': 0.19, 'Kişisel Bakım ve Kozmetik': 0.19, 'Ayakkabı, Çanta ve Aksesuar': 0.19, 'Anne Bebek': 0.18, 'Kitap, Kırtasiye, Hobi, Oyuncak': 0.18, 'Ev, Yaşam, Yapı Market': 0.17, 'Pet Shop': 0.17, 'Gıda': 0.17, 'Spor ve Outdoor': 0.16, 'Elektronik': 0.14, 'Cep Telefonu': 0.1 },
      },
      stopaj: { rate: 0.01, basis: 'net' },
      fees: [],
      shipping: {
        payer: 'seller',
        defaultCarrier: 'Aras',
        postaHizmetRate: 0.0235,
        barem: {
          tiers: [
            { upTo: 150, standard: { Aras: 31.9, 'Sürat': 31.9, PTT: 31.9, 'DHL eCommerce': 31.9, 'Kolay Gelsin': 31.9, 'Yurtiçi': 56.9 } },
            { upTo: 300.01, standard: { Aras: 56.9, 'Sürat': 56.9, PTT: 56.9, 'DHL eCommerce': 56.9, 'Kolay Gelsin': 56.9, 'Yurtiçi': 79.9 } },
          ],
          splitPolicy: 'all',
        },
        fallbackFlat: 88.96,
      },
    },
    notes: [
      'Komisyon oranları KDV hariç, üzerine %20 KDV (İş Ortağım paneli listesi; ikincil kaynaklardan).',
      'Barem fiyatları 2025 duyurusuna aittir (2026 güncellemesi doğrulanamadı); KDV ve %2,35 posta hizmet bedeli hariç.',
      'Pazarama desi tablosu girilene kadar 300 TL üstü siparişlerde paket başı 88,96 TL (tahmini) varsayılır.',
    ],
    sources: [
      { kind: 'secondary', title: 'Sentos — Pazarama komisyon oranları 2026', url: 'https://www.sentos.com.tr/pazarama-komisyon-oranlari-ne-kadar/' },
      { kind: 'secondary', title: 'Sopyo — Pazarama barem destek uygulaması', url: 'https://www.sopyo.com/blog/pazarama-pazaryeri-kargo-ucretleri-ve-anlasmalari' },
      { kind: 'secondary', title: 'Mükellef — Pazarama kargo: KDV ve %2,35 posta hizmet bedeli hariç', url: 'https://mukellef.co/blog/pazaramada-satici-olmak/' },
    ],
  },
  {
    marketplace: 'idefix',
    effectiveFrom: '2026-01-28',
    verified: false,
    config: {
      label: 'idefix',
      feeVatRecoverable: true,
      commission: { defaultRate: 0.15, basis: 'gross', vat: 'added', categoryRates: {}, discount: null },
      stopaj: { rate: 0.01, basis: 'net' },
      fees: [],
      shipping: { payer: 'seller', defaultCarrier: 'Aras', desiTable: 'idefix', fallbackFlat: undefined },
    },
    notes: [
      'Kargo tablosu idefix\'in resmi 28.01.2026 fiyat listesinden (KDV hariç, %2,35 posta hizmet bedeli dahil; 0–30 desi). Teslim edilen sipariş ve iadelerin kargosu satıcıya aittir.',
      'Ek hizmet/işlem bedeli kaynaklarda yok. Komisyon matrahı ve KDV durumu doğrulanamadı (+%20 KDV varsayıldı).',
      '30 desi üzeri gönderiler için lojistik firması (Horoz/CEVA, min. 30 desi) tarifesini ürün bazında elle girin.',
    ],
    sources: [
      { kind: 'official', title: 'idefix Pazaryeri Kargo-Lojistik Fiyat Listesi 28.01.2026', url: 'https://images.idefix.com/idefix/idefix_Pazaryeri_KargoLojistik_FiyatListesi_28.01.2026.pdf', date: '2026-01-28' },
      { kind: 'secondary', title: 'Pazaryeri Converter — idefix: ek hizmet bedeli yok, %1 stopaj', url: 'https://pazaryericonverter.com/komisyon-hesaplama/idefix-komisyon-hesaplama' },
    ],
  },
  {
    marketplace: 'koctas',
    effectiveFrom: '2026-01-01',
    verified: true,
    config: {
      label: 'Koçtaş',
      feeVatRecoverable: true,
      commission: { defaultRate: 0.15, basis: 'gross', vat: 'included', categoryRates: {}, discount: null },
      stopaj: { rate: 0.01, basis: 'net' },
      fees: [{ code: 'kiosk_fee', label: 'Kiosk primi (%3)', kind: 'percent', rate: 0.03, basis: 'gross', vat: 'included', per: 'package', when: { kiosk: true }, note: 'Müşteri ürünü Koçtaş mağaza kasasında öderse.' }],
      shipping: { payer: 'seller', defaultCarrier: 'Yurtiçi', fallbackFlat: 120 },
    },
    notes: [
      'Sözleşme EK-7: komisyon oranları KDV dahildir ve KDV dahil satış fiyatı üzerinden uygulanır (ayrıca KDV eklenmez).',
      'Kategori oranları sözleşme ekindedir (kaynaklara göre %8–20). Ürün bazında girin; Koçtaş (Mirakl) API\'si siparişte gerçek komisyonu bildirdiğinde o tutar kullanılır.',
      'Kargo: ≤30 desi MNG/Sendeo/Yurtiçi, >30 desi Borusan/CEVA/Horoz anlaşmalı ya da kendi kargonuz. Tarife yayımlanmadığı için paket başı 120 TL (tahmini) varsayılır; kendi tarifenizi girin.',
    ],
    sources: [
      { kind: 'official', title: 'Koçtaş Elektronik Ticaret Pazaryeri Sözleşmesi EK 7 — Komisyon Oranları', url: 'https://koctas-img.mncdn.com/Sozleme/komisyon_oran.pdf' },
      { kind: 'official', title: 'Koçtaş\'ta Satıcı Ol — Mirakl platformu, API dokümanları', url: 'https://www.koctas.com.tr/koctasta-satici-ol' },
    ],
  },
  {
    marketplace: 'etsy',
    effectiveFrom: '2026-01-01',
    verified: false,
    config: {
      label: 'Etsy',
      salesVatOverride: 0,
      feeVatRecoverable: false,
      commission: { defaultRate: 0.065, basis: 'gross_plus_shipping', vat: 'added', categoryRates: {}, discount: null },
      stopaj: { rate: 0, basis: 'net' },
      fees: [
        { code: 'payment_processing', label: 'Ödeme işleme (%6,5)', kind: 'percent', rate: 0.065, basis: 'gross_plus_shipping', vat: 'added', per: 'package' },
        { code: 'payment_processing_fixed', label: 'Ödeme işleme sabit (14 TRY)', kind: 'fixed', amount: 14, vat: 'added', per: 'order' },
        { code: 'regulatory_fee', label: 'Regulatory Operating Fee (%1,67)', kind: 'percent', rate: 0.0167, basis: 'gross_plus_shipping', vat: 'added', per: 'package' },
        { code: 'listing_fee', label: 'Listeleme yenileme (0,20 USD / satılan adet)', kind: 'fixed', amount: 0.2, currency: 'USD', vat: 'added', per: 'unit' },
        { code: 'currency_conversion', label: 'Kur çevrim bedeli (%2,5)', kind: 'percent', rate: 0.025, basis: 'gross_plus_shipping', vat: 'added', per: 'package', disabled: true, note: 'İlan para birimi ödeme hesabınızdan farklıysa açın.' },
        { code: 'offsite_ads', label: 'Offsite Ads (%15)', kind: 'percent', rate: 0.15, basis: 'gross_plus_shipping', vat: 'added', per: 'package', disabled: true, note: 'Yalnızca Offsite Ads kaynaklı siparişlerde (yıllık 10.000 USD üstü satıcılarda %12).' },
      ],
      shipping: { payer: 'seller', defaultCarrier: 'PTT Global', fallbackFlat: undefined },
    },
    notes: [
      'Etsy işlem bedeli (%6,5) ürün + kargo + hediye paketi üzerinden alınır. Türkiye\'deki satıcılar için ödeme işleme %6,5 + 14 TRY ve %1,67 Regulatory Operating Fee; Etsy bedellerine %20 KDV eklenir (KDV numarası tanımlıysa eklenmez — o durumda bedellerin KDV\'sini Ayarlar\'dan kaldırın).',
      'Yurt dışı satış: satış KDV\'si 0 kabul edildi; Etsy bir Türk aracı hizmet sağlayıcı olmadığından %1 e-ticaret stopajı uygulanmaz.',
      'Uluslararası kargo maliyeti ürün bazında elle girilmelidir (alıcıdan alınan kargo ücreti ciroya eklenir).',
      'Ödeme işleme oranının Türkiye için kaynaklarda farklı geçtiği görüldü; Etsy Payments hesabınızdaki güncel oranı doğrulayın.',
    ],
    sources: [
      { kind: 'official', title: 'Etsy Help — What is a Regulatory Operating Fee?', url: 'https://help.etsy.com/hc/en-us/articles/1500011073202-What-is-a-Regulatory-Operating-Fee' },
      { kind: 'secondary', title: 'Growtsy — Etsy fees in Turkey: 6.5% + 14 TRY, 1.67% ROF, 20% KDV', url: 'https://www.growtsy.com/etsy-fees/vat', date: '2026-11-15' },
      { kind: 'secondary', title: 'Custombull — Selling on Etsy from Turkey', url: 'https://custombull.com/en/blog/getting-paid-on-etsy-from-turkey' },
    ],
  },
];

export const DEFAULT_RATE_TABLES: Record<string, { effectiveFrom: string; source: string; carriers: CarrierRates }> = {
  trendyol: { effectiveFrom: trendyolRates.effectiveFrom, source: trendyolRates.source, carriers: trendyolRates.carriers as CarrierRates },
  idefix: { effectiveFrom: idefixRates.effectiveFrom, source: idefixRates.source, carriers: idefixRates.carriers as CarrierRates },
};

export function defaultRule(marketplace: string): FeeRule | undefined {
  return DEFAULT_RULES.find((r) => r.marketplace === marketplace.replace(/_2$/, ''));
}

export { CARRIERS_BY_MARKETPLACE } from './carriers';
