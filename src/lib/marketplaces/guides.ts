// Başlangıç sihirbazı ve API ayarları için pazaryeri bazlı "anahtarı nereden alırım" rehberi
import { withSecondAccounts, type MarketplaceName } from './meta';

export interface ListingDefaults {
  [marketplace: string]: { carrier?: string | null; handlingDays?: number; sameDayTag?: boolean; fastTag?: boolean; commissionRate?: number | null };
}

export interface ExtraField {
  key: string;
  label: string;
  placeholder?: string;
  required?: boolean;
  type?: 'text' | 'number';
  help?: string;
  /** Boş bırakılırsa kullanılacak değer */
  default?: string;
}

export type Need = 'required' | 'optional' | 'none' | 'auto';

export interface MarketplaceGuide {
  panelUrl: string;
  panelName: string;
  steps: string[];
  /** İsteğe bağlı / gelişmiş ayarlar ("Gelişmiş" bölümünde kapalı gösterilir) */
  extra: ExtraField[];
  /** Hangi bilgiler gerçekten gerekli? (gerekmeyen alan formda hiç gösterilmez) */
  needs: { secret: Need; seller: Need };
  secretRequired: boolean;
  note?: string;
}

/** Pazaryeri bağlantısı için gereken bilgilerin tamamı girilmiş mi? (sunucu ve tarayıcı ortak kullanır) */
export function hasRequiredKeys(mp: MarketplaceName, c: { apiKey?: string | null; apiSecret?: string | null; hasSecret?: boolean; sellerId?: string | null }): boolean {
  const g = GUIDES[mp];
  if (!c.apiKey?.trim()) return false;
  if (g.needs.seller === 'required' && !c.sellerId?.trim()) return false;
  if (g.needs.seller === 'auto' && !c.sellerId?.trim()) return false;
  if (g.needs.secret === 'required' && !(c.apiSecret?.trim() || c.hasSecret)) return false;
  return true;
}

export const GUIDES: Record<MarketplaceName, MarketplaceGuide> = withSecondAccounts<MarketplaceGuide>({
  trendyol: {
    panelUrl: 'https://partner.trendyol.com',
    panelName: 'Trendyol Satıcı Paneli',
    steps: [
      'Trendyol Satıcı Paneli\'ne giriş yapın.',
      'Sağ üstte mağaza adınıza tıklayın → "Hesap Bilgilerim".',
      '"Entegrasyon Bilgileri" sekmesini açın.',
      'Satıcı ID, API Key ve API Secret değerlerini kopyalayıp aşağıya yapıştırın.',
    ],
    extra: [
      { key: 'cargoCompanyId', label: 'Kargo firması ID', type: 'number', help: 'Boşsa Trendyol\'daki varsayılan kargonuz kullanılır.' },
    ],
    needs: { secret: 'required', seller: 'required' },
    secretRequired: true,
    note: 'Kategori ve marka ürün eklerken listeden aranarak seçilir.',
  },
  hepsiburada: {
    panelUrl: 'https://merchant.hepsiburada.com',
    panelName: 'Hepsiburada Satıcı Paneli',
    steps: [
      'Hepsiburada Satıcı Paneli\'ne giriş yapın.',
      'Entegratör listesinde Kervan yoktur (Kervan "kendi yazılımınız" olarak bağlanır). Yardım → "Talep oluştur" → konu: "API Entegrasyon İşlemleri" seçin.',
      'Talebe şunu yazın: "Kendi yazılımımla API entegrasyonu yapacağım. API kullanıcı adı, servis anahtarı (secret key) ve Merchant ID bilgilerimi iletir misiniz?"',
      'Hepsiburada bilgileri e-postanıza gönderince Merchant ID, kullanıcı adı ve servis anahtarını aşağıya yapıştırın. (Hesabım → Entegrasyon sayfasında görünüyorsa oradan da kopyalayabilirsiniz.)',
    ],
    note: 'Entegratör listesinde yalnızca Hepsiburada ile resmi anlaşması olan firmalar görünür. Kervan bu listede olmadan da sizin kendi API bilgilerinizle çalışır.',
    extra: [{ key: 'defaultCategoryId', label: 'Varsayılan kategori numarası', type: 'number', help: 'Ürün eklerken kategori listeden aranarak da seçilebilir.' }],
    needs: { secret: 'required', seller: 'required' },
    secretRequired: true,
  },
  n11: {
    panelUrl: 'https://so.n11.com',
    panelName: 'n11 Satıcı Ofisi',
    steps: [
      'n11 Satıcı Ofisi\'ne giriş yapın.',
      'Hesabım → "API Hesapları" sayfasını açın; hesap yoksa "Yeni API Hesabı Oluştur"a basın.',
      'App Key ve App Secret değerlerini kopyalayıp aşağıya yapıştırın.',
    ],
    extra: [
      { key: 'shipmentTemplate', label: 'Teslimat şablonu adı', placeholder: 'Standart', help: 'n11 panelindeki kargo şablonunuzun adı. Boşsa "Standart" kullanılır.', default: 'Standart' },
      { key: 'defaultCategoryId', label: 'Varsayılan kategori numarası', type: 'number' },
    ],
    needs: { secret: 'required', seller: 'none' },
    secretRequired: true,
  },
  ciceksepeti: {
    panelUrl: 'https://seller.ciceksepeti.com',
    panelName: 'Çiçeksepeti Satıcı Paneli',
    steps: [
      'Çiçeksepeti Satıcı Paneli\'ne giriş yapın.',
      'Hesap Ayarları → "Entegrasyon Bilgileri" (API Erişim) bölümünü açın.',
      'API Key değerini kopyalayıp aşağıya yapıştırın. Başka bilgi gerekmez.',
    ],
    extra: [{ key: 'defaultCategoryId', label: 'Varsayılan kategori numarası', type: 'number' }],
    needs: { secret: 'none', seller: 'none' },
    secretRequired: false,
  },
  pazarama: {
    panelUrl: 'https://isortagim.pazarama.com',
    panelName: 'Pazarama İş Ortağım',
    steps: [
      'Pazarama İş Ortağım paneline giriş yapın.',
      'Hesap → "Entegrasyon Bilgileri" sayfasından API erişimi oluşturun.',
      'API Key (Client ID) ve API Secret (Client Secret) değerlerini kopyalayıp aşağıya yapıştırın.',
    ],
    extra: [
      { key: 'defaultCategoryId', label: 'Varsayılan kategori numarası' },
      { key: 'defaultBrandId', label: 'Varsayılan marka numarası' },
    ],
    needs: { secret: 'required', seller: 'none' },
    secretRequired: true,
  },
  idefix: {
    panelUrl: 'https://satici.idefix.com',
    panelName: 'idefix Satıcı Paneli',
    steps: [
      'idefix Satıcı Paneli\'ne giriş yapın.',
      'Hesap Ayarları → "Entegrasyon / API Bilgileri" sayfasını açın.',
      'API Key, API Secret ve Satıcı (Vendor) ID değerlerini kopyalayıp aşağıya yapıştırın.',
    ],
    extra: [
      { key: 'defaultCategoryId', label: 'Varsayılan kategori numarası', type: 'number' },
      { key: 'defaultBrandId', label: 'Varsayılan marka numarası', type: 'number' },
    ],
    needs: { secret: 'required', seller: 'required' },
    secretRequired: true,
  },
  koctas: {
    panelUrl: 'https://koctas-prod.mirakl.net',
    panelName: 'Koçtaş Satış Ortağım',
    steps: [
      'Koçtaş Satış Ortağım paneline giriş yapın.',
      'Sağ üstte kullanıcı adınıza tıklayın → "API Anahtarı" → anahtar oluşturup kopyalayın.',
      'Anahtarı aşağıya yapıştırın. Başka bilgi gerekmez.',
    ],
    extra: [
      { key: 'baseUrl', label: 'Panel adresi', placeholder: 'https://koctas-prod.mirakl.net', default: 'https://koctas-prod.mirakl.net', help: 'Panele girdiğiniz adres farklıysa (tarayıcı adres çubuğu) buraya yazın.' },
    ],
    needs: { secret: 'none', seller: 'optional' },
    secretRequired: false,
  },
  etsy: {
    panelUrl: 'https://www.etsy.com/developers/your-apps',
    panelName: 'Etsy Developers',
    steps: [
      'etsy.com/developers adresinde "Create a New App" ile uygulama oluşturun.',
      'Keystring ve Shared Secret değerlerini kopyalayıp aşağıya yapıştırın.',
      'Uygulamanın "Callback URL" listesine şu adresi ekleyin: <panel adresi>/api/auth/etsy/callback',
      '"Anahtarları kaydet"e, ardından "Etsy ile bağlan"a basıp mağazanıza izin verin; mağaza numarası kendiliğinden gelir.',
    ],
    extra: [
      { key: 'shippingProfileId', label: 'Kargo profili numarası', type: 'number', help: 'Etsy Shop Manager → Settings → Shipping settings. Ürün yayınlamak için gerekli.' },
      { key: 'taxonomyId', label: 'Varsayılan Etsy kategori numarası', type: 'number' },
      { key: 'shopCurrency', label: 'Mağaza para birimi', placeholder: 'USD' },
    ],
    needs: { secret: 'optional', seller: 'auto' },
    secretRequired: false,
    note: 'Etsy, mağazanıza erişim için ayrıca izin ister; anahtarları kaydettikten sonra "Etsy ile bağlan" butonu görünür.',
  },
}, (_b, v) => v);
