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
- **Giriş ve ilk kurulum:**
  - `/setup` ilk yönetici hesabını açar, `/login` giriş ekranıdır.
  - `/onboarding` pazaryeri API bilgilerini sırayla ister ve "nereden alınır" adımlarını gösterir.
- **Demo modu yok.** Yalnızca `DEMO_MODE=true` ortam değişkeni verilirse çalışır.

## Teknik yapı
- **Çatı:** Next.js 15 App Router, Tailwind 3.4, lucide-react, Recharts, Supabase (supabase-js 2.x).
- **Supabase erişimi:** Yalnızca sunucu tarafında, service_role ile (`src/lib/supabase/server.ts`). RLS açık, anon'a hiçbir izin yok. Tarayıcı Supabase'i yalnızca Realtime "panel" kanalı için kullanır; anon anahtar yoksa 15 saniyede bir yoklamaya düşer.
- **Oturum:** Kendi yazdığımız sistem. Şifreler scrypt ile saklanır; `na_session` çerezi HMAC ile imzalanır (`src/lib/auth/*`, `src/middleware.ts`).
- **Pazaryeri adaptörleri:** `src/lib/marketplaces/adapters/*`, ortak `MarketplaceAdapter` arayüzü (`types.ts`), fabrika `registry.ts`.
  - Bağlı olmayan pazaryerinin adaptörü `null` döner: yayın ve stok gönderimi yapılmaz.
  - Trendyol'da ek olarak kategori/marka araması, kategori özellikleri ve `updateProduct` var.
- **Senkron motoru:** `src/lib/sync/engine.ts` — `publishProduct`, `pushStock`, `ingestOrder`, `pollOrders`, `reconcile`.
- **Kâr motoru:** `src/lib/fees/*`, saf TypeScript. Testler: `npm test` (`tests/fees.test.ts`, `tests/rates.test.ts`).
- **Veritabanı şeması:** `supabase/schema.sql`. Tekrar çalıştırılabilir. 10. bölümde service_role yetkileri var (aşağıdaki "Bilinen tuzaklar"a bak).

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
  - `APP_URL` girilmedi; Etsy dönüş adresi istek origin'inden üretiliyor.
- **Cron:** Hobby plan günde bir cron'a izin veriyor; `vercel.json` günlük çalışıyor. Panel açıkken `Shell.tsx` 3 dakikada bir `/api/sync` çağırır. Panel kapalıyken de sık senkron için cron-job.org kurulumu önerildi, henüz yapılmadı: 5 dakikada bir `GET /api/cron/sync?token=CRON_SECRET`.

## Bilinen tuzaklar (yaşandı)
- **Yeni Supabase projelerinde tablo izinleri:** public tablolara service_role için otomatik GRANT verilmiyor ve `42501 permission denied` hatası çıkıyor. `schema.sql`'in 10. bölümündeki GRANT'ler bunu çözer. Kullanıcı bu kodu SQL Editor'de çalıştırdı.
- **Hata mesajları:** HEAD/count sorguları hata gövdesi döndürmez. Bu yüzden `api/auth/status` normal bir select kullanır ve hatayı Türkçe, ne yapılacağını söyleyen bir mesaja çevirir.
- **Route dosyaları:** Next.js route ve page dosyaları keyfi isimle export yapamaz. Paylaşılan tipleri `src/components/product-shared.tsx` veya `src/lib/*` altına koy.
- **Büyük `.in()` sorguları:** `.in('id', [...])` ile çok sayıda id gönderince istek başlığı büyüyor ve HTTP 431 dönüyor. Bu sorgular 100'lük parçalara bölünür.

## Durum ve sıradaki işler
- **Son bilinen durum:** Kullanıcı canlı sitede ilk yönetici hesabını açma adımındaydı. İzin hatası çözüldü; hesap açılıp açılmadığı henüz teyit edilmedi.
- **Doğrulanmamış adaptörler:** Pazarama, idefix ve Koçtaş yayımlanmış dokümantasyona göre yazıldı, gerçek hesapla hiç denenmedi; kullanıcı için bunlar çok önemli. Gerçek API anahtarlarıyla "Bağlantıyı Test Et" ve bir deneme ürünüyle doğrula; çıkan hata mesajlarına göre uç noktaları düzelt.
- **Kategori/marka arama:** Trendyol dışındaki pazaryerlerinde kategori ID elle giriliyor. Aramayı onlara da eklemek istenebilir.
- **İçerik güncelleme:** Başlık, açıklama ve fotoğraf güncellemesi yalnızca Trendyol'da var; diğerlerinde yalnızca fiyat ve stok gidiyor.
- **Şifre sıfırlama:** Yok. Gerekirse `app_users` tablosundan elle yapılır.
- **cron-job.org kurulumu:** Yapılmadı.
