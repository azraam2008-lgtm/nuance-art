// Başlangıç sihirbazı ve API ayarları için pazaryeri bazlı "anahtarı nereden alırım" rehberi
import type { MarketplaceName } from './meta';

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
}

export interface MarketplaceGuide {
  panelUrl: string;
  panelName: string;
  steps: string[];
  extra: ExtraField[];
  secretRequired: boolean;
  note?: string;
}

export const GUIDES: Record<MarketplaceName, MarketplaceGuide> = {
  trendyol: {
    panelUrl: 'https://partner.trendyol.com',
    panelName: 'Trendyol Satıcı Paneli',
    steps: [
      'Trendyol Satıcı Paneli\'ne giriş yapın.',
      'Sağ üstte mağaza adınıza tıklayın → "Hesap Bilgilerim".',
      '"Entegrasyon Bilgileri" sekmesini açın.',
      'Satıcı ID (Cari ID), API Key ve API Secret değerlerini kopyalayıp aşağıya yapıştırın.',
    ],
    extra: [
      { key: 'cargoCompanyId', label: 'Kargo firması ID (isteğe bağlı)', type: 'number', help: 'Ürün yüklerken kullanılacak anlaşmalı kargo; boşsa Trendyol varsayılanı.' },
    ],
    secretRequired: true,
    note: 'Kategori ve marka ürün eklerken Trendyol listesinden aranarak seçilir.',
  },
  hepsiburada: {
    panelUrl: 'https://merchant.hepsiburada.com',
    panelName: 'Hepsiburada Merchant Paneli',
    steps: [
      'Hepsiburada Merchant Paneli\'ne giriş yapın.',
      'Hesabım → "Entegrasyon" (Entegratör Bilgileri) sayfasına gidin.',
      'Merchant ID ve servis anahtarınızı (secret key) kopyalayın.',
      'Entegratör kullanıcı adınızı "API Key" alanına yazın (istek başlığında User-Agent olarak gönderilir).',
    ],
    extra: [{ key: 'defaultCategoryId', label: 'Varsayılan kategori ID', type: 'number', help: 'Ürün eklerken ürün bazında değiştirilebilir.' }],
    secretRequired: true,
  },
  n11: {
    panelUrl: 'https://so.n11.com',
    panelName: 'n11 Satıcı Ofisi',
    steps: [
      'n11 Satıcı Ofisi\'ne giriş yapın.',
      'Hesabım → "API Hesapları" sayfasını açın; yoksa "Yeni API Hesabı Oluştur".',
      'App Key ve App Secret değerlerini kopyalayın.',
      'Mağaza/Satıcı ID\'nizi (Hesap bilgileri sayfasında) girin.',
    ],
    extra: [
      { key: 'defaultCategoryId', label: 'Varsayılan kategori ID', type: 'number' },
      { key: 'shipmentTemplate', label: 'Teslimat şablonu adı', placeholder: 'Standart', help: 'n11 panelinde tanımlı kargo şablonunuzun adı (zorunlu).' },
    ],
    secretRequired: true,
  },
  ciceksepeti: {
    panelUrl: 'https://seller.ciceksepeti.com',
    panelName: 'Çiçeksepeti Satıcı Paneli',
    steps: [
      'Çiçeksepeti Satıcı Paneli\'ne giriş yapın.',
      'Hesap Ayarları → "Entegrasyon Bilgileri" bölümünü açın.',
      'API Key değerini kopyalayın; Satıcı ID\'nizi girin.',
    ],
    extra: [{ key: 'defaultCategoryId', label: 'Varsayılan kategori ID', type: 'number' }],
    secretRequired: false,
  },
  pazarama: {
    panelUrl: 'https://isortagim.pazarama.com',
    panelName: 'Pazarama İş Ortağım',
    steps: [
      'Pazarama İş Ortağım paneline giriş yapın.',
      'Hesap → "Entegrasyon Bilgileri" sayfasından API erişimi oluşturun.',
      'Client ID (API Key) ve Client Secret değerlerini kopyalayın; Satıcı (Merchant) ID\'nizi girin.',
    ],
    extra: [
      { key: 'defaultCategoryId', label: 'Varsayılan kategori ID' },
      { key: 'defaultBrandId', label: 'Varsayılan marka ID' },
    ],
    secretRequired: true,
  },
  idefix: {
    panelUrl: 'https://satici.idefix.com',
    panelName: 'idefix Satıcı Paneli',
    steps: [
      'idefix Satıcı Paneli\'ne giriş yapın.',
      'Hesap Ayarları → "Entegrasyon / API Bilgileri" sayfasını açın.',
      'API Key, API Secret ve Vendor (Satıcı) ID değerlerini kopyalayın.',
    ],
    extra: [
      { key: 'defaultCategoryId', label: 'Varsayılan kategori ID', type: 'number' },
      { key: 'defaultBrandId', label: 'Varsayılan marka ID', type: 'number' },
    ],
    secretRequired: true,
  },
  koctas: {
    panelUrl: 'https://www.koctas.com.tr/koctasta-satici-ol',
    panelName: 'Koçtaş Satış Ortağım (Mirakl)',
    steps: [
      'Koçtaş Satış Ortağım (Mirakl) paneline giriş yapın.',
      'Sağ üstte kullanıcı adınız → "API Anahtarı" → anahtar oluşturup kopyalayın.',
      'Tarayıcı adres çubuğundaki alan adını (ör. https://koctas-prod.mirakl.net) "Mirakl adresi" alanına yazın.',
      'Mağaza (Shop) ID\'nizi Ayarlar → Mağaza bilgileri\'nden alın.',
    ],
    extra: [{ key: 'baseUrl', label: 'Mirakl adresi', placeholder: 'https://koctas-prod.mirakl.net', required: true }],
    secretRequired: false,
  },
  etsy: {
    panelUrl: 'https://www.etsy.com/developers/your-apps',
    panelName: 'Etsy Developers',
    steps: [
      'etsy.com/developers adresinde "Create a New App" ile uygulama oluşturun.',
      'Keystring ve Shared Secret değerlerini kopyalayıp aşağıya girin.',
      'Uygulamanın "Callback URL" listesine bu panelin adresini ekleyin: <panel adresi>/api/auth/etsy/callback',
      'Kaydettikten sonra "Etsy ile bağlan" butonuna basıp mağazanıza erişim izni verin; Shop ID otomatik doldurulur.',
    ],
    extra: [
      { key: 'shopCurrency', label: 'Mağaza para birimi', placeholder: 'USD' },
      { key: 'taxonomyId', label: 'Varsayılan Etsy kategori (taxonomy) ID', type: 'number' },
      { key: 'shippingProfileId', label: 'Kargo profili ID', type: 'number', help: 'Etsy Shop Manager → Settings → Shipping settings.' },
    ],
    secretRequired: false,
    note: 'Etsy, API erişimi için OAuth izni ister; anahtarları kaydettikten sonra "Etsy ile bağlan" butonu görünür.',
  },
};
