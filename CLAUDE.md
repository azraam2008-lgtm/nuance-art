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
- **Reklam (`/ads`):** Pazaryerleri reklam API'si açmıyor; sayfa her pazaryeri için rehber + panel linki verir, girilen reklam harcaması (`ad_spend`) Kârlılık'ta düşülür.
- **Demo modu yok.** Yalnızca `DEMO_MODE=true` ortam değişkeni verilirse çalışır.

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
- **Testler:** `npm test` → `tests/fees.test.ts`, `tests/rates.test.ts`, `tests/tenant.test.ts` (mağaza filtresi), `tests/password.test.ts`.
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
- **Son büyük değişiklik (2026-11-23, dal `claude/dazzling-euler-vhzfl4`):** çok mağazalı yapı, kayıt, şifre değiştirme/sıfırlama, sipariş durumunun tüm pazaryerlerine gönderimi, tüm pazaryerlerinde kategori araması ve içerik güncelleme, sade kurulum ekranı, galeri/kamera ile fotoğraf, reklam sayfası.
  - Canlıya almak için kullanıcının yapması gerekenler: (1) Supabase SQL Editor'de `schema.sql`'i yeniden çalıştırmak, (2) Vercel'e `GMAIL_USER` ve `GMAIL_APP_PASSWORD` eklemek, (3) dalı `main`'e almak.
  - Bu değişiklik sonrası herkes bir kez yeniden giriş yapar (eski oturum çerezinde mağaza bilgisi yok).
- **Doğrulanmamış uç noktalar:** Gerçek API anahtarlarıyla denenip hata mesajlarına göre düzeltilmeli. Kullanıcı gerçek hesaplarla deneyecek.
  - Pazarama, idefix, Koçtaş: adaptörlerin tamamı.
  - Diğerlerinde yeni eklenenler: sipariş durumu gönderimi (özellikle Pazarama durum kodları, idefix yolu, Çiçeksepeti "readyforcargo" uçları, N11 `rest/order/v1/update`) ve kategori listesi uçları (Hepsiburada, N11, Çiçeksepeti, Pazarama, idefix).
  - Yolların çoğu Ayarlar > Gelişmiş'ten (`extra_config`) değiştirilebilir.
- **cron-job.org kurulumu:** Yapılmadı.
- **Mobil görünüm:** Panel menüsü telefonda daralmıyor (kenar çubuğu sabit). Teyze telefondan kullanacaksa ele alınmalı.
