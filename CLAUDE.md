# Kervan (eski adı Nuance Art) — proje notları (Claude için)

Bu dosya, projenin claude.ai sohbetinde yapılan işin özetidir. Yeni bir oturumda kaldığın yerden devam etmek için önce bunu oku.

## Kullanıcı ve dil
- Kullanıcı Türkçe konuşur ve teknik değildir. Yanıtları **Türkçe**, kısa ve adım adım yaz; terminal komutu yerine tıklanacak yeri söyle.
- Paneli asıl kullanacak kişi kullanıcının teyzesi: Trendyol, Hepsiburada, N11, Çiçeksepeti, Pazarama, idefix, Koçtaş ve Etsy'de el yapımı ürün satıyor.
- Arayüz metinleri ve kod yorumları Türkçe. Bu düzeni koru.

## Ne yapıyor
Çok pazaryerli yönetim paneli:
- **Yeni ürün sihirbazı** (`/products/new`, 5 adım): Fotoğraflar URL olarak değil dosya olarak yüklenir ve Supabase Storage `product-images` bucket'ına gider. Kullanıcının belirlediği sırayla tüm pazaryerlerine gönderilir; ilk fotoğraf kapak olur.
- **Canlı kâr hesabı:** Her pazaryeri için komisyon, platform bedeli, kargo (barem/desi), stopaj ve net kâr hesaplanır.
- **Ortak stok havuzu:** Bir pazaryerinde satış olunca stok düşer ve yeni değer tüm aktif ilanlara gönderilir. SQL fonksiyonu `apply_order` bu işi atomik yapar; aynı sipariş ikinci kez gelirse stok tekrar düşmez.
- **Çok mağazalı (multi-tenant):** Herkes `/signup` ile kendi mağazasını açar. Her mağazanın ürün, sipariş, stok, API anahtarı, ayar ve reklam verisi ayrıdır.
- **Giriş ve ilk kurulum:**
  - `/signup` kayıt, `/login` giriş, `/forgot` + `/reset` şifre sıfırlama (Gmail ile e-posta), `/account` hesap ve şifre değiştirme. `/setup` artık `/signup`'a yönlenir.
  - `/onboarding` önce satış yapılan pazaryerlerini seçtirir, sonra yalnızca onlar için gereken anahtar(lar)ı ister (alanlar `guides.ts` → `needs`).
- **Sipariş durumu gönderimi:** Panelde durum değişince (`changeOrderStatus`, `markShipped`) adaptörün `updateOrderStatus`'u çağrılır. Pazaryerinin desteklemediği adımlar `unsupported` döner (hata değil, bilgi).
- **İş kuyruğu ve İşlem Merkezi (`/operations`):** Pazaryerine gönderilemeyen stok/yayın/içerik/sipariş durumu `sync_jobs` tablosuna yazılır (`src/lib/sync/job-log.ts` → `noteResults`). Geçici hatalar (bağlantı, 429, 5xx) 1-5-15-60-180-360 dk aralıkla tekrar denenir; 4xx hatalar hemen "başarısız" olur. Çalışan: `src/lib/sync/jobs.ts` (`processDueJobs`), `/api/cron/sync` ve panelin `/api/sync`'i çağırır. Yeni bir pazaryeri gönderimi eklersen sonucunu `noteResults` ile bildir.
- **Zamanlayıcı:** `supabase/zamanlayici.sql` Supabase pg_cron + pg_net ile 5 dakikada bir `/api/cron/sync?token=…` çağırır; anahtar `system_config.cron_token` (veritabanında üretilir, CRON_SECRET de kabul edilir).
- **Varyantlar (seçenekler):** Her seçenek ayrı `products` satırı (kendi SKU, barkod, stok); `group_code` (ana ürün kodu) ile bağlanır, `variant_attrs` ({"Renk":"Kırmızı"}). Pazaryerine `ProductPayload.groupCode` ile tek ilan altında gider, başlığa seçenek değeri eklenir (`variantTitle`). Trendyol'da varyant özelliği (ör. Renk) kategori özelliğinden eşleştirilir. Başlık/açıklama/marka/kategori değişince diğer seçeneklere de uygulanır. Sihirbaz: `src/components/VariantEditor.tsx`.
- **Deneme mağazası:** `stores.is_demo`; Hesabım'dan veya kurulumdan açılır (`/api/demo`). Açıkken o mağazada tüm pazaryerleri `DemoAdapter` (gerçek istek yok), örnek veri `seed_demo_data`, kapatınca `clear_store_data`. Gerçek ürün/bağlantı varsa açılmaz. `src/lib/demo.ts` → `isDemoStore()`.
- **Sipariş durumları (8):** new, approved, preparing, invoiced, shipped, delivered, cancelled, returned (`meta.ts`). İptal ve iade stoğu havuza döndürür (`set_order_status`). Pazaryerine gönderimde `pushOrderStatus` eşler: approved→preparing, invoiced yalnızca Trendyol/idefix'e fatura no ile, returned/new gönderilmez. İade nedeni `orders.return_reason`. Toplu işlem `/api/orders/bulk`; geciken = açık durumda ve `order_costs.deadline` geçmiş.
- **Finans:** `expenses` (aylık/tek seferlik işletme giderleri, `src/lib/finance/expenses.ts` ile aralığa orantılanır). Kârlılık'ta "işletme net kârı" = sipariş net kârı − reklam − giderler.
- **Öneriler (`/insights`):** `src/lib/insights/analyze.ts` (deterministik): stok tükenme tahmini, satış trendi, kârsız ürünler, iade analizi, pazaryeri karşılaştırması, tekrar alan müşteri.
- **Ürün araçları:** güvenlik stoğu (`products.safety_stock`, pazaryerine `sellableStock` gider), en düşük marj (`products.min_margin`) ve zararına satış uyarısı (`src/lib/fees/guard.ts`), toplu fiyat (`/api/products/bulk-price`, önizlemeli), Excel/CSV yükleme (`/api/products/bulk-import`, `src/components/ProductBulk.tsx`).
- **Reklam (`/ads`):** Pazaryerleri reklam API'si açmıyor; sayfa her pazaryeri için rehber + panel linki verir, girilen reklam harcaması (`ad_spend`) Kârlılık'ta düşülür.
- **Ekip ve roller:** `app_users.role` = owner/admin/staff. Davet `/api/team` (yalnızca sahip, 7 gün geçerli tek kullanımlık bağlantı, `invites`), kabul `/invite` + `/api/auth/invite`. Yetki kuralı tek yerde: `src/lib/api.ts` → `checkPolicy` (personel: kâr/maliyet/fiyat/API anahtarı/gider/reklam uçları kapalı; deneme mağazası yalnızca sahip) ve `stripSensitive` (personele giden yanıttan cost/profit/margin/commission/secret/apiKey alanları çıkar). Arayüzde `useIsStaff()` (`src/components/role.tsx`). Yeni hassas uç eklersen `STAFF_BLOCKED`'a yaz.
- **İşlem kaydı:** `audit(action, detail)` (`src/lib/audit.ts`) → `audit_log`; Hesabım → "Son işlemler".
- **E-posta bildirimleri:** `src/lib/notify.ts` (`app_settings.notifications` + `notify_state`), cron her mağaza için tek özet e-posta; günlük özet 08:00 sonrası. Gmail ayarlı değilse çalışmaz.
- **Yasal ve tanıtım:** `/legal/terms|privacy|kvkk` (`src/lib/legal-texts.ts`, TASLAK — köşeli parantezli alanlar doldurulmalı, hukukçu kontrolü gerekli), kayıtta onay kutusu (`terms_accepted_at`, `TERMS_VERSION`). Giriş yapmamış kişi `/` → `/welcome`.
- **Kargo etiketi (A seçeneği, ücretsiz):** Siparişler'de seçip "Kargo etiketi yazdır" → `/orders/labels?ids=` (10×15 etiket veya A4). Barkod = pazaryerinin gönderdiği kargo takip numarası (`orders.raw`'dan `src/lib/shipping/label.ts` → `extractLabel`, yoksa `orders.tracking_number`), Code 128 (`src/lib/shipping/code128.ts`, zxing ile okunduğu doğrulandı). Alan adları gerçek siparişle doğrulanmalı; barkod yoksa açıkça "pazaryeri panelinden yazdırın" der. E-fatura için aşağıya bak.
- **Fatura (e-Arşiv/e-Fatura):** `invoices` tablosu (sipariş başına tek kayıt, aynı zamanda kuyruk; şema 9h). Ayarlar → Fatura (`src/components/InvoicingSettings.tsx`, `app_settings.invoicing` + şifreli `invoicing_secrets`): yöntem `none` (kesmiyorum) / `manual` (numara + PDF elle) / `parasut` / `nilvera`; "kargoya verilince otomatik" seçeneği. Mantık `src/lib/invoicing/service.ts` (queueInvoices, processDueInvoices, setManualInvoice, afterIssued: sipariş hazırlıktaysa "Faturalandı" yapılır, Trendyol'a `sendInvoiceLink` ile herkese açık PDF bağlantısı `/api/invoice-file/[token]`). Sağlayıcılar `src/lib/invoicing/providers/*` — Paraşüt v4 (OAuth password, contacts → sales_invoices → e_invoice_inboxes → e_archives/e_invoices → trackable_jobs → pdf) , Nilvera (`/earchive/Send/Model`, UUID bizde → idempotent; kurumsal e-Fatura alıcısı Nilvera'da desteklenmiyor, açıkça söylenir) ve Uyumsoft (JSON `POST /api/BasicIntegrationApi` {Action: SendInvoice/IsEInvoiceUser/GetOutboxInvoice/GetOutboxInvoicePdf}, UBL-TR JSON, Scenario 0 = otomatik, web servis kullanıcı adı/şifre; test sunucusu efatura-test.uyumsoft.com.tr, Uyumsoft/Uyumsoft — bu ortamdan erişilemedi). Resmi belgelere bu ortamdan erişilemedi; açık kaynak istemcilere göre yazıldı, GERÇEK HESAPLA DOĞRULANMALI. Cron zamanı gelen faturaları keser (1-5-15-60-180-360 dk). PDF'ler Storage `invoices` (özel) kovasında. Yeni sağlayıcı: `InvoiceProvider` uygula + `providerFor` + ayarlar kartı.
- **Aynı pazaryerinde ikinci mağaza (ortak stok, 2026-11-28):** `trendyol_2`, `hepsiburada_2` … ayrı pazaryeri adı gibi davranır (kendi API anahtarı, ilan, sipariş; `marketplaces` tablosunda `_2` satırları). `meta.ts` → `BASE_MARKETPLACES`, `baseOf()`, `isSecondAccount()`, `withSecondAccounts()`; komisyon/kargo kuralları, rehber, adaptör ana pazaryerinden (`pickRule`, `CARRIERS_BY_MARKETPLACE`/`DEFAULT_COMMISSION` Proxy). Yalnızca eklenmişse (satırda anahtar/aktif) yüklenir ve listelenir. Ayarlar'da bağlı pazaryerinin altında "ikinci mağaza ekle"; mağaza adı `extra_config.accountName`. Etsy için kapalı (OAuth tek hesap). Ayar sayfaları (kurallar, fiyat hesaplayıcı, kurulum, reklam) `BASE_MARKETPLACES`; filtreler `useMarketplaces()`. Ürün sihirbazında `_2` için kategori/marka girilmezse ana pazaryerininki kullanılır (`toPayload`). Test: `tests/second-account.test.ts`.
- **Birden fazla ayrı mağaza (2026-11-28):** `store_members(user_id, store_id, role)` (şema 9i). `app_users.store_id` = girişte açılan ana mağaza; diğerleri üyelikle. `activeUser()` çerezdeki `sid` ana mağaza değilse üyeliği ve o mağazadaki rolü kontrol eder. `/api/stores`: GET liste (+ `?summary=1` her mağazanın bu ayki ciro/kâr/sipariş/stok özeti ve toplam, personel olduğu mağazada özet yok), POST `create` (yeni boş mağaza + sahip üyeliği, oluşturup geçer) / `switch` (üyelik kontrolü, yeni çerez). Yan menü üstünde `StoreSwitcher`, sayfa `/stores` (Mağazalarım). Ekip listesi üyelikleri de gösterir. Aynı ürünler → ikinci hesap (ortak stok); ayrı işletmeler → ayrı mağaza.
- **Tema ve mağaza rengi (2026-11-28):** Açık, sakin tema (beyaz yan menü, `.app-bg` zemin). Tailwind `indigo` sınıfları CSS değişkenlerine bağlı (`--accent-50…950`, `tailwind.config.ts`); mağazanın rengi `src/lib/theme.ts` (`ACCENTS` 8 sakin ton, `accentFor` seçilmemişse mağaza kimliğinden sabit renk, `scale` tek tondan skala). `app_settings.theme.accent`; `/api/auth/status` → `accent`, `Shell` değişkenleri uygular; renk Mağazalarım'da seçilir (`/api/stores` action `theme`). Pazaryeri renkleri: `MARKETPLACE_META[m].chart` (yumuşak ton; ikinci mağaza koyu ton + kesik çerçeveli rozet, `mixHex`). Grafiklerde `.chart` kullan, `.color` (marka rengi) değil.
- **Trendyol benzeri düzen (2026-11-28):** Sol menü ve sağdaki "Canlı Senkron Akışı" kaldırıldı. Üst çubuk (`Shell.tsx` → `TopBar`): solda `StoreSwitcher`, ortada Ana Sayfa · Ürünler ▾ (Ürünlerim, Yeni Ürün, Stok) · Siparişler · Raporlar ▾ (Kârlılık, Öneriler, Giderler, Reklam, Fiyat Hesaplayıcı, Maliyet Kuralları, İşlem Merkezi); sağda Yeni Ürün + hesap menüsü (API Bağlantıları, Mağazalarım, Hesabım, Çıkış). Telefonda aynı gruplar çekmecede + alt sekme çubuğu. Menü tanımı `GROUPS`/`ACCOUNT`.
  - Ana sayfa (`/api/dashboard`): ciro/kâr YOK. Aksiyonlar (yeni, işleme alınan, bugün kargolanmalı, süresi geçen, kesilmesi gereken fatura — fatura yöntemi seçiliyse, yoksa kargodaki —, 30 gün iade), son siparişler (fotoğraf + kalan süre), kritik stok (fotoğraf), ürün performansı (30 gün en çok satan). Kutular `/orders?tab=…|deadline=late|today|invoice=missing` açar.
  - Ciro trendi ve dağılım Kârlılık'ta (`/api/profit/trend`, `src/components/RevenueTrend.tsx`).
  - Siparişler: sekmeler `ORDER_TABS` (meta.ts) + sayılar (`tabCounts`), filtre kutusu (müşteri, sipariş/paket no, barkod, kargo takip kodu, ürün adı/model kodu, mağaza, kargoya teslim süresi, fatura, tarih aralığı; "Filtrele" ile uygulanır), sıralama (`sort`: tarih, kalan süre `cost(deadline)` — desteklenmezse tarihe düşer —, tutar). Satır: sipariş no altında tarih/paket no/teslimat no/kalan süre; ürün fotoğrafı, stok kodu, barkod, seçenek, birim fiyat. API `raw`'ı tarayıcıya göndermez; `package_no` = external_order_id'nin "/" sonrası, `delivery_no` = `extractLabel` takip no.
  - Hız (2026-11-28): ana sayfa sorguları `Promise.all` ile paralel; sipariş listesi `raw`'ı çekmez (yalnızca `raw->>cargoTrackingNumber` vb.); otomatik yenileme 45 sn ve yalnızca sekme görünürken; ilk `/api/sync` açılıştan 20 sn sonra. Fotoğraflar `ProductImage` (ui.tsx): http→https, Trendyol CDN için `mnresize` küçük kopya, yüklenmezse asıl adres + bir tekrar, sonra boş kutu.
  - Siparişler sekme/filtreyi `useSearchParams` ile URL'den alır (ana sayfa kutuları doğru sekmeyi açar). Kalan süreye göre sıralamada yalnızca kargoya verilmeyi bekleyenler listelenir.
  - İki mağaza adı: ikinci hesap varsa Ayarlar'da üstte `TwinNames` kartı ikisine de ad ister (`PATCH /api/credentials` yalnızca `accountName` yazar), bağlantı formunda ad zorunlu (`requireName`), ana sayfada uyarı (`useUnnamedTwins`).
  - Sipariş fotoğrafları: `src/lib/orders/images.ts` → `withProductImages` (orders ve dashboard API). Ürünler sonradan aktarıldıysa bağsız satırlar (product_id boş) stok kodu, yoksa `orders.raw` içindeki barkodla ürüne bağlanır ve KALICI yazılır (stok değişmez). Kapak yoksa ürünün diğer fotoğrafı, o da yoksa aynı `group_code`'lu seçeneğin fotoğrafı. Panelde olmayan ürün için "ürünleri çekin" notu. Ana sayfada siparişteki her ürünün fotoğrafı (en çok 3). Test: `tests/order-images.test.ts`.
  - Mağaza düğmeleri (Siparişler üstü): bağlı mağazalar (`useConnectedMarketplaces`) renkli düğme, çoklu seçim, anında süzer; API `marketplace=a,b` (virgüllü) ve `mps=` ile seçili sekmedeki mağaza başına sayı (`marketplaceCounts`). "Temizle" mağaza seçimini korur.
  - Firma adları: rozet ve filtrelerde pazaryeri adı yerine Ayarlar'daki "Mağaza adı" (`extra_config.accountName`) görünür (`useMarketplaceShortName`, `MarketplaceBadge`); girilmemişse "Trendyol"/"Trendyol 2".
- **Ürün adı:** "Kervan" (2026-11-24 kullanıcı seçti), tek yerde `src/lib/brand.ts`. Giriş, tanıtım, yasal sayfalar ve e-postalarda görünür. Panelin içinde (yan menü, sekme başlığı) her kullanıcı kendi mağaza adını ve baş harf logosunu (`StoreMark`) görür. Depo ve Vercel proje adı hâlâ `nuance-art` olabilir.
- **Demo modu yok.** Yalnızca `DEMO_MODE=true` ortam değişkeni verilirse çalışır.

## Geliştirme standardı (kullanıcının ana talimatı, 2026-11-23)
Hedef: Trendyol, Hepsiburada, N11 (ve diğer bağlı pazaryerleri) üzerinden satan işletmelerin tüm operasyonunu yönettiği, abonelikle satılabilecek çok kiracılı bir SaaS.
- Önce ilgili kodu anla; çalışan özellikleri ve mevcut veritabanını koru, gereksiz yeniden yazma yok. Mevcut tasarım dilini ve bileşenleri yeniden kullan.
- Gerçek API desteği olmayan işlemi çalışıyormuş gibi gösterme; desteklenmeyeni açıkça "desteklenmiyor" diye belirt.
- Başarısız işlem kullanıcıdan saklanmaz: pazaryeri bazında ayrı sonuç göster, kayda yaz, kontrollü yeniden dene. İşlemler idempotent olmalı.
- Büyük mimari değişiklik (veri modeli, kuyruk, durum modeli, barındırma) kullanıcı onayı olmadan yapılmaz.
- Masaüstü ve telefon uyumlu olmalı.
- Modül modül ilerle; her görevde yalnızca ilgili dosyaları incele. Önceden analiz edilmiş mimariyi yeniden keşfetme.
- Her görev sonunda kısa rapor: değişen dosyalar, yapılanlar, test sonuçları, kalan sorunlar.
- Yapay zekâ maliyeti oluşturma; önce deterministik analizler.
- Pazaryerleri arasında öncelik yok; hepsine aynı özen.
- Geliştirme sırası (onaylanacak): analiz → entegrasyon altyapısı → ürün/stok → sipariş/kargo → finans → akıllı özellikler → test/güvenlik.

## Teknik yapı
- **Çatı:** Next.js 15 App Router, Tailwind 3.4, lucide-react, Recharts, Supabase (supabase-js 2.x).
- **Supabase erişimi:** Yalnızca sunucu tarafında, service_role ile (`src/lib/supabase/server.ts`). RLS açık, anon'a hiçbir izin yok.
  - **`db()` mağazaya kapsamlıdır:** select/update/delete'e otomatik `store_id = oturumdaki mağaza` ekler, insert/upsert'e `store_id` yazar, mağaza RPC'lerine `p_store_id` geçer. Mağaza bağlamı `src/lib/tenant.ts` (AsyncLocalStorage) ile kurulur; `handle()` bunu oturumdan yapar.
  - **`rawDb()`** filtresizdir: yalnızca `app_users`, `stores`, `password_resets`, `auth_attempts` ve tüm mağazaları dolaşan cron için. Mağaza verisine `rawDb()` ile dokunma.
  - Oturumsuz uçlar `handlePublic()` kullanır ve mağaza bağlamını kendisi kurar (cron her mağaza için `withStore`, webhook `?store=` parametresi).
  - Yeni bir mağaza tablosu eklersen: tabloya `store_id` ekle ve `server.ts` içindeki `TENANT_TABLES` listesine yaz. Tarayıcı Supabase'i yalnızca Realtime "panel" kanalı için kullanır; anon anahtar yoksa 15 saniyede bir yoklamaya düşer.
- **Oturum:** Kendi yazdığımız sistem (`src/lib/auth/*`, `src/middleware.ts`).
  - Şifreler scrypt (N=65536) ile saklanır; eski N=16384 şifreler girişte otomatik yenilenir. Kural: en az 10 karakter, harf + rakam.
  - `na_session` çerezi HMAC ile imzalıdır ve `uid`, `sid` (mağaza), `sv` (oturum sürümü) taşır. Şifre değişince `app_users.session_version` artar ve eski oturumlar kapanır.
  - Kaba kuvvet koruması `auth_attempts` tablosundadır (`src/lib/auth/limits.ts`).
- **Sipariş saatleri:** `parseMarketDate` (`http.ts`): Trendyol milisaniyesi Türkiye saati (UTC gibi) → 3 saat geri; saat dilimsiz metin → +03:00. Siparişler her çekişte tarihini günceller.
- **Pazaryeri adaptörleri:** `src/lib/marketplaces/adapters/*`, ortak `MarketplaceAdapter` arayüzü (`types.ts`), fabrika `registry.ts`.
  - Bağlı olmayan pazaryerinin adaptörü `null` döner: yayın ve stok gönderimi yapılmaz.
  - Tüm pazaryerlerinde kategori araması (`searchCategories`, 6 saat önbellek) ve içerik güncelleme (`updateProduct`) var. Marka araması Trendyol, Pazarama ve idefix'te var. Kategori özellikleri formu yalnızca Trendyol'da.
  - Tüm adaptörlerde `updateOrderStatus` var.
  - Ürün içe aktarma (`/api/products/import?source=`) bağlı her pazaryerinden çalışır.
  - **Tüm ürünleri çek** (`/api/products/import-all`, `src/lib/sync/catalog-import.ts`, ekran `src/components/CatalogImport.tsx`): bağlı tüm pazaryerlerinin bütün ürünleri tek kataloğa; eşleşme barkod, yoksa SKU (`catalog-merge.ts`). Farklı stok → sıfır olmayan en düşük (yalnızca bu aktarımda yeni eklenen ürünlerde; mevcut ürünün panel stoğu korunur), farklı fiyat → ilanda `price_override`. Adım adım (cursor, ~30 sn/çağrı, her çağrı en az 1 sayfa), tekrar çalıştırmak güvenli. Test: `tests/catalog-import.test.ts` (bellek içi sahte Supabase, `tests/fakes/`).
- **Senkron motoru:** `src/lib/sync/engine.ts` — `publishProduct`, `pushStock`, `ingestOrder`, `pollOrders`, `reconcile`.
- **Kâr motoru:** `src/lib/fees/*`, saf TypeScript.
- **Testler:** `npm test` → fees, rates, tenant (mağaza filtresi), password, jobs (hangi hata tekrar denenir), expenses (gider orantılama), insights (öneri hesapları).
- **Veritabanı şeması:** `supabase/schema.sql`. Tekrar çalıştırılabilir.
  - "9b) Çok mağazalı yapı" bölümü `stores` tablosunu ve `store_id` sütunlarını ekler; sahipsiz eski verileri ilk kullanıcının mağazasına taşır.
  - Tetikleyiciler alt satırların mağazasını üst satırdan alır ve başka mağazanın ürününe/siparişine bağlanmayı reddeder.
  - 10. bölümde service_role yetkileri var (aşağıdaki "Bilinen tuzaklar"a bak).

## Komutlar
```
npm install
npm run dev        # http://localhost:3000
npm run typecheck
npm test
npm run build
```
Yerel geliştirme için `.env.example` dosyasını `.env.local` olarak kopyala. `.env.local` asla commit edilmez.

## Canlı ortam
- **Kod:** GitHub `azraam2008-lgtm/nuance-art`, dal `main`. Her push Vercel'de otomatik yayın başlatır.
- **Vercel:** takım `aras25`, proje `nuance-art`, Hobby plan. Canlı adres: **https://ker-van-panel.vercel.app** (eski nuance-art-aras25.vercel.app de çalışıyor)
  - `nuance-xxxx-aras25.vercel.app` gibi yayına özel adresler Vercel Authentication ile korunur; başkalarına bu adresleri gönderme.
- **Vercel ortam değişkenleri:** Değerler yalnızca Vercel'de durur, buraya yazılmaz. Kullanıcı bazılarını standart dışı adlarla girdi; `next.config.mjs` ve `server.ts` bu adları da tanır.
  - `PUBLIC_SUPABASE_URL` (standart adı `NEXT_PUBLIC_SUPABASE_URL`). `/rest/v1` gibi fazladan bir yol varsa `next.config.mjs` otomatik temizler.
  - `SUPABASE_SERVICE_ROLE_KEY`: yeni tip `sb_secret_...` anahtar.
  - `SESSION_SECRET`, `CREDENTIALS_ENCRYPTION_KEY`, `CRON_SECRET`, `WEBHOOK_SECRET`.
  - Anon/publishable anahtar girilmedi; Vercel arayüzü ad hatası verdi. Zorunlu değil.
  - `APP_URL` girilmedi; Etsy dönüş adresi ve şifre sıfırlama bağlantısı istek origin'inden üretiliyor.
  - `GMAIL_USER` (panelkervan@gmail.com) + `GMAIL_APP_PASSWORD`: 2026-11-24 girildi, deneme e-postası çalıştı.
- **Cron:** Hobby plan günde bir cron'a izin veriyor; `vercel.json` günlük çalışıyor. Panel açıkken `Shell.tsx` 3 dakikada bir `/api/sync` çağırır. Panel kapalıyken de sık senkron için cron-job.org kurulumu önerildi, henüz yapılmadı: 5 dakikada bir `GET /api/cron/sync?token=CRON_SECRET`.

## Bilinen tuzaklar (yaşandı)
- **Yeni Supabase projelerinde tablo izinleri:** public tablolara service_role için otomatik GRANT verilmiyor ve `42501 permission denied` hatası çıkıyor. `schema.sql`'in 10. bölümündeki GRANT'ler bunu çözer. Kullanıcı bu kodu SQL Editor'de çalıştırdı.
- **Hata mesajları:** HEAD/count sorguları hata gövdesi döndürmez. Bu yüzden `api/auth/status` normal bir select kullanır ve hatayı Türkçe, ne yapılacağını söyleyen bir mesaja çevirir.
- **Route dosyaları:** Next.js route ve page dosyaları keyfi isimle export yapamaz. Paylaşılan tipleri `src/components/product-shared.tsx` veya `src/lib/*` altına koy.
- **`server-only` ve testler:** `src/lib` dosyalarını test eden betikler `tsx --conditions=react-server` ile çalışmalı.
- **Büyük `.in()` sorguları:** `.in('id', [...])` ile çok sayıda id gönderince istek başlığı büyüyor ve HTTP 431 dönüyor. Bu sorgular 100'lük parçalara bölünür.

## Durum ve sıradaki işler
- **Canlıda (2026-11-23, PR azraam2008-lgtm/nuance-art#1 birleştirildi):** çok mağazalı yapı, kayıt, şifre değiştirme/sıfırlama, sipariş durumu gönderimi, kategori araması ve içerik güncelleme, sade kurulum, galeri/kamera fotoğraf, reklam sayfası, telefon uyumu, iş kuyruğu + İşlem Merkezi, zamanlayıcı, varyantlar.
  - Kullanıcının `schema.sql` ve `zamanlayici.sql`'i çalıştırdığı teyit edilmeli (İşlem Merkezi ve Stok sayfası hatasız açılıyorsa şema tamam).
  - Bu ortamdan canlı siteye erişilemiyor (proxy engeli); canlı kontrolü kullanıcı yapıyor.
- **Doğrulanmamış uç noktalar:** Gerçek API anahtarlarıyla denenip hata mesajlarına göre düzeltilmeli. Kullanıcı gerçek hesaplarla deneyecek.
  - Pazarama, idefix, Koçtaş: adaptörlerin tamamı.
  - Diğerlerinde yeni eklenenler: sipariş durumu gönderimi (özellikle Pazarama durum kodları, idefix yolu, Çiçeksepeti "readyforcargo" uçları, N11 `rest/order/v1/update`) ve kategori listesi uçları (Hepsiburada, N11, Çiçeksepeti, Pazarama, idefix).
  - Yolların çoğu Ayarlar > Gelişmiş'ten (`extra_config`) değiştirilebilir.
- **Sık senkron:** pg_cron işi `kervan-senkron` yeni Vercel adresini 5 dakikada bir çağırıyor (2026-11-24, 200 döndü). Eski adres nuance-art-aras25.vercel.app silinmedi.
- **Telefon uyumu (yapıldı):** `lg` altında yan menü soldan açılır çekmece, altta sekme çubuğu (`Shell.tsx`). Tablolu sayfalarda (Ürünler, Stok, Siparişler) `md` altında kart listesi gösterilir; yeni tablolu sayfa eklerken aynı düzeni kullan.
- **Kullanıcı kararları (2026-11-23):** Bütün pazaryerleri eşit öncelikli (öne çıkan yok). Sipariş durumları 8 (yapıldı), daha fazlası değil. İş kuyruğu ve varyant yapıldı. Barındırma (ücretli plan): şimdilik ücretsiz devam.
- **Kullanıcının gerçek satıcı hesabı yok;** gerçek API testini teyzesi yapacak. Kullanıcı paneli deneme mağazasıyla deniyor.
- **İkinci paket (deneme mağazası, 8 durum, toplu sipariş, geciken uyarı, iade, giderler, öneriler, güvenlik stoğu, zarar uyarısı, toplu fiyat, CSV):** canlıya alınması için kullanıcı `schema.sql`'i tekrar çalıştırmalı (is_demo, 9e/9f bölümleri, clear_store_data) ve PR'ı birleştirmeli.
- **A grubu (ekip/roller, bildirimler, yasal metinler, tanıtım) ve Kervan adı:** canlıda (PR #3, #4 birleşti, 9g SQL çalıştırıldı).
- **Yapılmayanlar / sonraki adaylar:** abonelik ödemesi (iyzico/Stripe; fiyat kararı kullanıcıda), kargo etiketi ve e-fatura (entegratör gerekir), rakip fiyat (yalnızca resmi buybox verisiyle; gerçek hesapla doğrulanmalı), işletme asistanı: karar = önce otomatik "İşletme özeti" (rakamları kod hesaplar, model yalnızca yorum yazar), soru-cevap sonra ve günlük sınırla; kullanıcı model seçimini onaylamalı.
- **Varyant sınırları:** Hepsiburada, N11, Çiçeksepeti, Pazarama, idefix'te seçenekler ana kodla gruplanır ve başlıkta görünür, ama pazaryerinin kendi varyant özelliği (renk/beden kodu) gönderilmiyor; Etsy'de her seçenek ayrı ilan. Gerçek hesapla doğrulanmalı.
