// Pazaryeri reklam rehberi. Pazaryerleri reklam sistemlerini dışarıya API ile açmıyor;
// reklam kendi panellerinden verilir. Menü adları pazaryerinin güncellemesiyle değişebilir.
import type { MarketplaceName } from './meta';

export interface AdGuide {
  product: string;
  url: string;
  steps: string[];
  tip: string;
}

export const AD_GUIDES: Record<MarketplaceName, AdGuide> = {
  trendyol: {
    product: 'Trendyol Reklam (Ürün Reklamları)',
    url: 'https://partner.trendyol.com',
    steps: [
      'Trendyol Satıcı Paneli\'ne girin; sol menüden "Reklam Yönetimi"ni açın.',
      '"Ürün Reklamı" ile yeni kampanya oluşturun ve reklam vereceğiniz ürünleri seçin.',
      'Günlük bütçe ve tıklama başı teklif belirleyin (önce küçük bir bütçeyle başlayın).',
      'Kampanyayı başlatın; birkaç gün sonra hangi ürünün satış getirdiğine bakıp bütçeyi ona kaydırın.',
    ],
    tip: 'Puanı yüksek, yorumu çok ve stoğu bol ürünlerde reklam daha verimli olur.',
  },
  hepsiburada: {
    product: 'HepsiAd (Hepsiburada Reklam)',
    url: 'https://merchant.hepsiburada.com',
    steps: [
      'Hepsiburada Satıcı Paneli\'ne girin; "Reklam" / "HepsiAd" bölümünü açın.',
      '"Ürün Reklamları" ile yeni kampanya oluşturun, ürünlerinizi seçin.',
      'Günlük bütçe ve tıklama başı teklif girin, kampanyayı başlatın.',
    ],
    tip: 'Rekabetin az olduğu, el yapımı gibi özel anahtar kelimelerde tıklama maliyeti düşük olur.',
  },
  n11: {
    product: 'n11 Reklam (Sponsorlu Ürünler)',
    url: 'https://so.n11.com',
    steps: [
      'n11 Satıcı Ofisi\'ne girin; "Reklam" / "Reklam Merkezi" bölümünü açın.',
      'Sponsorlu ürün kampanyası oluşturun, ürünleri ve bütçeyi seçin.',
      'Kampanyayı başlatın; performansı aynı bölümden izleyin.',
    ],
    tip: 'Kampanya dönemlerinde (Efsane Kasım vb.) bütçeyi önceden artırın.',
  },
  ciceksepeti: {
    product: 'Çiçeksepeti Reklam',
    url: 'https://seller.ciceksepeti.com',
    steps: [
      'Çiçeksepeti Satıcı Paneli\'ne girin; "Reklam" / "Reklamlarım" bölümünü açın.',
      'Ürün reklamı oluşturun, bütçe ve süre belirleyin.',
      'Özel günlerden (Anneler Günü, Sevgililer Günü) 1–2 hafta önce başlatmak en iyi sonucu verir.',
    ],
    tip: 'Hediyelik ürünlerde özel gün öncesi reklam satışları belirgin artırır.',
  },
  pazarama: {
    product: 'Pazarama Reklam / Kampanyalar',
    url: 'https://isortagim.pazarama.com',
    steps: [
      'Pazarama İş Ortağım paneline girin; "Reklam" veya "Kampanyalar" bölümünü açın.',
      'Ürünleriniz için reklam ya da kampanya başvurusu yapın.',
      'Bölüm görünmüyorsa satıcı destek ekibinden reklam seçeneklerini isteyin.',
    ],
    tip: 'Pazarama kampanyalarına katılmak çoğu zaman reklamdan daha ucuza görünürlük sağlar.',
  },
  idefix: {
    product: 'idefix Kampanyalar',
    url: 'https://satici.idefix.com',
    steps: [
      'idefix Satıcı Paneli\'ne girin; "Kampanyalar" / "Reklam" bölümünü açın.',
      'Uygun kampanyalara ürünlerinizi ekleyin.',
      'Reklam seçeneği görünmüyorsa satıcı destek ekibine danışın.',
    ],
    tip: 'Kitap ve hobi kategorilerinde dönemsel kampanyalar görünürlüğü artırır.',
  },
  koctas: {
    product: 'Koçtaş Kampanyalar',
    url: 'https://koctas-prod.mirakl.net',
    steps: [
      'Koçtaş\'ta satıcıların kendi başına açabildiği bir reklam paneli yoktur.',
      'Kampanya ve öne çıkarma için kategori yöneticinize veya satıcı destek ekibine yazın.',
    ],
    tip: 'İndirimli fiyat (üstü çizili fiyat) ile kampanya listelerine girmek en kolay yoldur.',
  },
  etsy: {
    product: 'Etsy Ads',
    url: 'https://www.etsy.com/your/shops/me/advertising',
    steps: [
      'Etsy Shop Manager\'a girin; "Marketing" → "Etsy Ads" bölümünü açın.',
      'Günlük bütçenizi girin (ör. 1–5 USD) ve reklam verilecek ilanları seçin.',
      '"Offsite Ads" (Google, Instagram reklamları) ayarını da aynı bölümden kontrol edin.',
    ],
    tip: 'Etsy Ads ilk 1–2 haftada öğrenir; hemen kapatmayın, sonra kötü giden ilanları çıkarın.',
  },
};
