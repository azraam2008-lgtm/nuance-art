# Nuance Art — proje notları (Claude için)

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
- **Pazaryeri adaptörleri:** `src/lib/marketplaces/adapters/*`, ortak `MarketplaceAdapter` arayüzü (`types.ts`), fabrika `registry.ts`.
  - Bağlı olmayan pazaryerinin adaptörü `null` döner: yayın ve stok gönderimi yapılmaz.
  - Tüm pazaryerlerinde kategori araması (`searchCategories`, 6 saat önbellek) ve içerik güncelleme (`updateProduct`) var. Marka araması Trendyol, Pazarama ve idefix'te var. Kategori özellikleri formu yalnızca Trendyol'da.
  - Tüm adaptörlerde `updateOrderStatus` var.
  - Ürün içe aktarma (`/api/products/import?source=`) bağlı her pazaryerinden çalışır.
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
- **Vercel:** takım `aras25`, proje `nuance-art`, Hobby plan. Canlı adres: **https://nuance-art-aras25.vercel.app**
  - `nuance-xxxx-aras25.vercel.app` gibi yayına özel adresler Vercel Authentication ile korunur; başkalarına bu adresleri gönderme.
- **Vercel ortam değişkenleri:** Değerler yalnızca Vercel'de durur, buraya yazılmaz. Kullanıcı bazılarını standart dışı adlarla girdi; `next.config.mjs` ve `server.ts` bu adları da tanır.
  - `PUBLIC_SUPABASE_URL` (standart adı `NEXT_PUBLIC_SUPABASE_URL`). `/rest/v1` gibi fazladan bir yol varsa `next.config.mjs` otomatik temizler.
  - `SUPABASE_SERVICE_ROLE_KEY`: yeni tip `sb_secret_...` anahtar.
  - `SESSION_SECRET`, `CREDENTIALS_ENCRYPTION_KEY`, `CRON_SECRET`, `WEBHOOK_SECRET`.
  - Anon/publishable anahtar girilmedi; Vercel arayüzü ad hatası verdi. Zorunlu değil.
  - `APP_URL` girilmedi; Etsy dönüş adresi ve şifre sıfırlama bağlantısı istek origin'inden üretiliyor.
  - `GMAIL_USER` + `GMAIL_APP_PASSWORD` ("Şifremi unuttum" e-postası için): henüz girilmedi. Girilmezse `/forgot` bunu söyleyen bir hata gösterir.
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
  - `GMAIL_USER` ve `GMAIL_APP_PASSWORD` henüz eklenmedi.
  - Bu ortamdan canlı siteye erişilemiyor (proxy engeli); canlı kontrolü kullanıcı yapıyor.
- **Doğrulanmamış uç noktalar:** Gerçek API anahtarlarıyla denenip hata mesajlarına göre düzeltilmeli. Kullanıcı gerçek hesaplarla deneyecek.
  - Pazarama, idefix, Koçtaş: adaptörlerin tamamı.
  - Diğerlerinde yeni eklenenler: sipariş durumu gönderimi (özellikle Pazarama durum kodları, idefix yolu, Çiçeksepeti "readyforcargo" uçları, N11 `rest/order/v1/update`) ve kategori listesi uçları (Hepsiburada, N11, Çiçeksepeti, Pazarama, idefix).
  - Yolların çoğu Ayarlar > Gelişmiş'ten (`extra_config`) değiştirilebilir.
- **Sık senkron:** cron-job.org yerine `supabase/zamanlayici.sql` (pg_cron) kullanılacak.
- **Telefon uyumu (yapıldı):** `lg` altında yan menü soldan açılır çekmece, altta sekme çubuğu (`Shell.tsx`). Tablolu sayfalarda (Ürünler, Stok, Siparişler) `md` altında kart listesi gösterilir; yeni tablolu sayfa eklerken aynı düzeni kullan.
- **Kullanıcı kararları (2026-11-23):** Bütün pazaryerleri eşit öncelikli (öne çıkan yok). Sipariş durumları 8 (yapıldı), daha fazlası değil. İş kuyruğu ve varyant yapıldı. Barındırma (ücretli plan): şimdilik ücretsiz devam.
- **Kullanıcının gerçek satıcı hesabı yok;** gerçek API testini teyzesi yapacak. Kullanıcı paneli deneme mağazasıyla deniyor.
- **İkinci paket (deneme mağazası, 8 durum, toplu sipariş, geciken uyarı, iade, giderler, öneriler, güvenlik stoğu, zarar uyarısı, toplu fiyat, CSV):** canlıya alınması için kullanıcı `schema.sql`'i tekrar çalıştırmalı (is_demo, 9e/9f bölümleri, clear_store_data) ve PR'ı birleştirmeli.
- **A grubu (ekip/roller, bildirimler, yasal metinler, tanıtım):** yapıldı; canlı için `schema.sql` tekrar çalıştırılmalı (9g bölümü).
- **Yapılmayanlar / sonraki adaylar:** abonelik ödemesi (iyzico/Stripe; fiyat kararı kullanıcıda), kargo etiketi ve e-fatura (entegratör gerekir), rakip fiyat (yalnızca resmi buybox verisiyle; gerçek hesapla doğrulanmalı), işletme asistanı: karar = önce otomatik "İşletme özeti" (rakamları kod hesaplar, model yalnızca yorum yazar), soru-cevap sonra ve günlük sınırla; kullanıcı model seçimini onaylamalı.
- **Varyant sınırları:** Hepsiburada, N11, Çiçeksepeti, Pazarama, idefix'te seçenekler ana kodla gruplanır ve başlıkta görünür, ama pazaryerinin kendi varyant özelliği (renk/beden kodu) gönderilmiyor; Etsy'de her seçenek ayrı ilan. Gerçek hesapla doğrulanmalı.
