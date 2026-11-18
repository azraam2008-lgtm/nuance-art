# Nuance Art — Pazaryeri Yönetim Paneli

Trendyol, Hepsiburada, N11, Çiçeksepeti, Pazarama, idefix, Koçtaş ve Etsy için tek panelden **ürün, ortak stok, sipariş ve kârlılık** yönetimi.

- **Bir kez gir, her yerde yayınla:** Ürünü fotoğraflarıyla (sürükle-bırak yükleme, istediğiniz sırayla), açıklaması ve fiyatıyla bir kez girin; bağlı tüm pazaryerlerine aynı görseller, aynı sırada, aynı açıklamayla gönderilir.
- **Kâr baştan belli:** Ürünü eklerken her pazaryeri için komisyon, platform bedeli, kargo (barem/desi), stopaj ve **net kâr** canlı hesaplanır.
- **Ortak stok havuzu:** Bir pazaryerinde satış olunca stok tek sayaçtan düşer ve yeni değer diğer tüm pazaryerlerine otomatik gönderilir.
- **Gerçek veriyle çalışır:** Demo yok. İlk açılışta yönetici hesabı oluşturulur, ardından pazaryeri API bilgileri adım adım istenir.

Next.js 15 (App Router) + Tailwind CSS + Lucide + Recharts + Supabase (PostgreSQL, Storage, Realtime).

---

## 1. İlk Açılışta Ne Olur?

1. **Kurulum (`/setup`)** — Şirket adı, adınız, e-posta ve şifre (en az 8 karakter). Yalnızca ilk kullanıcı bu ekranı görür; sonra ekran kapanır.
2. **Pazaryeri bağlantıları (`/onboarding`)** — 8 pazaryeri sırayla gelir. Her birinde, bilgilerin satıcı panelinin **hangi menüsünden** alınacağı adım adım yazar.
   API Key / Secret / Satıcı ID'yi yapıştırın → **Bağlantıyı Test Et** → **Kaydet ve bağla**. Satmadığınız pazaryerini **Atla** ile geçin; sonra *API Bağlantıları* ekranından ekleyebilirsiniz.
   Etsy için anahtarları kaydettikten sonra **Etsy ile bağlan** butonuyla Etsy hesabınızda izin verirsiniz (OAuth).
3. **Varsayılanlar** — Her bağlı pazaryeri için kargo firması, kargoya teslim süresi, Bugün Kargoda / Hızlı Teslimat ve kategori komisyon oranınız. Yeni ürünlerde otomatik dolar.
4. **İlk ürün** — Doğrudan *Yeni Ürün Ekle* sihirbazı açılır.

Sonraki girişler `/login` üzerinden olur. Oturum 14 gün geçerlidir; 10 hatalı denemeden sonra giriş 15 dakika kilitlenir.

## 2. Yeni Ürün Ekleme Sihirbazı

| Adım | Ne istenir | Notlar |
|---|---|---|
| 1. Ürün bilgileri | Ad, marka, iç kategori, barkod, SKU, açıklama, KDV, desi | Barkod/SKU yoksa **Oluştur** ile üretilir. Açıklama tüm pazaryerlerine aynen gider. |
| 2. Fotoğraflar | Dosya (URL değil) — sürükle-bırak veya seç | En fazla 8 (Trendyol sınırı). Sürükleyerek veya oklarla sıralanır; **1. fotoğraf kapak**. 2400 px üstü tarayıcıda küçültülür, 600 px altı için uyarı verilir. |
| 3. Fiyat & stok | Maliyet, maliyet KDV'si, ambalaj, satış fiyatı, liste fiyatı, başlangıç stoğu, kritik eşik | Bu adımda tüm pazaryerleri için net kâr tablosu görünür. |
| 4. Pazaryerleri | Yalnızca **bağlı** pazaryerleri: yayınla/yayınlama, pazaryerine özel fiyat, komisyon, kargo firması, termin, Bugün Kargoda | Trendyol'da kategori ve marka **canlı aranır**, kategorinin zorunlu özellikleri form olarak gelir. Her değişiklikte net kâr anında yeniden hesaplanır. |
| 5. Kontrol & yayınla | Özet, fotoğraf sırası, kâr tablosu | Zarar eden pazaryeri varsa uyarır. |

Yayından sonra ürün **Ürünler → Yeni eklenen ürünler** bölümünde kapak görseli, stok, her pazaryerindeki durum, fiyat ve net kârla görünür.
Ürün detayında (`/products/[id]`) galeri, açıklama, pazaryeri bazında kesinti dökümü, stok eşitleme durumu, stok girişi ve düzenleme bulunur.
Düzenlemede fiyat & stok tüm aktif ilanlara; başlık, açıklama ve fotoğraflar içerik güncellemesini destekleyen pazaryerlerine (Trendyol) gönderilir.

Form taslağı tarayıcıda saklanır; sayfa yenilense de girdiğiniz bilgiler kaybolmaz.

## 3. Mimari

```
 Tarayıcı (Next.js sayfaları)
   │  fetch /api/*  — imzalı oturum çerezi (na_session) ile korunur
   │  Supabase Realtime "panel" kanalı ← yalnızca "yenile" sinyali
   ▼
 Next.js API (sunucu, service_role)
   ├── Kimlik doğrulama      src/lib/auth/  (scrypt şifre, HMAC-SHA256 oturum), src/middleware.ts
   ├── Senkronizasyon motoru src/lib/sync/engine.ts
   │     publishProduct · pushStock · ingestOrder · pollOrders · reconcile
   ├── Kârlılık motoru       src/lib/fees/  (saf TypeScript, test edilmiş)
   └── Adaptörler            src/lib/marketplaces/adapters/*  (MarketplaceAdapter arayüzü)
   ▼
 Supabase
   PostgreSQL: apply_order() atomik + idempotent sipariş/stok düşümü, v_stock_breakdown, RLS (anon erişimi yok)
   Storage:    product-images (public) — ürün fotoğrafları; pazaryerleri bu adreslerden indirir
```

**Ortak stok akışı:** Trendyol'dan 3 adet sipariş → `apply_order` stoğu 25 → 22 yapar → motor 22'yi **aktif ilanı olan tüm pazaryerlerine** gönderir.
N11'den 2 adet → 20 → herkese 20. Gönderim başarısız olursa ilan işaretlenir, Stok sayfasında kırmızı görünür ve cron (`reconcile`) yeniden dener.
Aynı sipariş iki kez gelirse `(marketplace_name, external_order_id)` benzersiz anahtarı sayesinde stok tekrar düşmez.

### Önemli dosyalar

```
nuance-art/
├── supabase/schema.sql                 # Tablolar, fonksiyonlar, görünümler, RLS, app_users, product-images bucket (tekrar çalıştırılabilir)
├── src/middleware.ts                   # Oturum kontrolü (webhook & cron hariç)
├── src/lib/auth/                       # şifre, oturum
├── src/lib/marketplaces/guides.ts      # "API bilgisi nereden alınır" adımları
├── src/lib/marketplaces/adapters/      # trendyol, hepsiburada, n11, ciceksepeti, pazarama, idefix, koctas, etsy
├── src/lib/fees/                       # maliyet motoru, fiyat önerici, ilan kâr hesabı
└── src/app/
    ├── setup/ login/ onboarding/       # ilk kurulum ve giriş
    ├── products/new/                   # yeni ürün sihirbazı
    ├── products/[id]/                  # ürün detayı
    ├── products/ stock/ orders/ profit/ pricing/ rules/ settings/
    └── api/
        ├── auth/{status,setup,login,logout}  auth/etsy/{start,callback}
        ├── onboarding/                        uploads/  (fotoğraf yükleme)
        ├── products/  products/[id]  products/[id]/{publish,stock,sync,listings}
        ├── marketplaces/[mp]/{categories,brands,attributes}
        ├── stock/  stock/sync   orders/  dashboard/  profit/
        ├── fees/{quote,price,rules,rates,settings,recompute}
        ├── credentials/  credentials/test
        ├── cron/sync  (Bearer CRON_SECRET)   webhooks/[marketplace]  (?token=WEBHOOK_SECRET)
```

---

## 4. Kurulum

**Gereksinimler:** Node.js 20+, bir Supabase projesi.

1. **Supabase projesi** → https://supabase.com → New project.
2. **Şema:** Supabase → *SQL Editor* → `supabase/schema.sql` içeriğini yapıştırıp **Run**.
   Ürün fotoğrafları için `product-images` adlı **public** Storage bucket'ı da bu dosya oluşturur.
   (Storage → Buckets'ta görünmüyorsa elle oluşturun: ad `product-images`, *Public* açık, 10 MB sınır, JPG/PNG/WEBP.)
   Dosya tekrar çalıştırılabilir; önceki sürümü kurduysanız yeniden çalıştırmanız yeterli. Örnek veri eklemez.
3. **Ortam değişkenleri:** `cp .env.example .env.local` ve doldurun:

   | Değişken | Açıklama |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API |
   | `APP_URL` | Panelin adresi (ör. `https://panel.nuanceart.com`). Etsy dönüş adresi bundan üretilir. |
   | `SESSION_SECRET` | Oturum imza anahtarı — rastgele 32+ karakter |
   | `CREDENTIALS_ENCRYPTION_KEY` | API Secret şifreleme anahtarı (32 bayt base64) |
   | `CRON_SECRET`, `WEBHOOK_SECRET` | Zamanlanmış görev ve webhook koruması |

   Anahtar üretmek için: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
4. ```bash
   npm install
   npm run dev
   ```
   http://localhost:3000 → otomatik olarak **/setup** açılır.

## 5. Canlıya Alma (Vercel)

1. Projeyi GitHub'a gönderin (`.env.local` gönderilmez).
2. Vercel → *Add New Project* → depo → *Environment Variables*'a yukarıdaki değişkenleri girin → **Deploy**.
3. **Otomatik senkron:** Panel açıkken tarayıcı 3 dakikada bir siparişleri çeker ve stokları eşitler.
   Panel kapalıyken de çalışması için ücretsiz **cron-job.org** hesabı açıp 5 dakikada bir şu adresi çağıran bir görev ekleyin:
   `https://ALANADINIZ/api/cron/sync?token=CRON_SECRET`. (`vercel.json`'daki günlük cron, Vercel Hobby planının sınırına uygundur.)
4. **Etsy:** developers.etsy.com'daki uygulamanızın *Callback URL* alanına `https://ALANADINIZ/api/auth/etsy/callback` ekleyin.
5. **Webhook (isteğe bağlı):** `https://ALANADINIZ/api/webhooks/trendyol?token=WEBHOOK_SECRET` (diğerleri için pazaryeri adını değiştirin). Webhook yalnızca tetikleyicidir; sipariş API'den çekilir.

### Güvenlik
- Panel, imzalı ve `httpOnly` oturum çereziyle korunur; şifreler scrypt ile saklanır.
- Tarayıcı veritabanına doğrudan erişemez (RLS açık, anon politikası yok); `SUPABASE_SERVICE_ROLE_KEY` yalnızca sunucuda.
- API Secret'lar AES-256-GCM ile şifreli saklanır ve tarayıcıya asla gönderilmez.
- Fotoğraf bucket'ı public'tir (pazaryerlerinin görselleri indirebilmesi için); dosya adları tahmin edilemez UUID'dir.

### Pazaryeri API notları
- Ürünler pazaryerlerinde **onay** sürecinden geçer: ilan önce *Onay bekliyor* olur, cron durumu sorgulayıp *Yayında*'ya çeker. Stok yalnızca aktif ilanlara gönderilir.
- Trendyol en fazla 8 görsel kabul eder ve görselleri verdiğiniz adresten indirir; panel fotoğrafları bu yüzden public Storage'a yükler.
- Pazarama, idefix ve Koçtaş uç noktaları yayımlanmış dokümantasyona göre yazıldı ancak gerçek hesapla test edilmedi; yollar *API Bağlantıları → gelişmiş ayarlar*dan değiştirilebilir.
  Canlıya almadan önce her pazaryerinde bir test ürünüyle yükleme, stok güncelleme ve sipariş çekmeyi doğrulayın.
- Kategori/marka araması ve zorunlu özellik formu şu an Trendyol için canlıdır; diğer pazaryerlerinde kategori ID'si elle girilir (varsayılanı API Bağlantıları'nda tanımlanabilir).

---

## 6. Kârlılık ve Maliyet Motoru (otomatik)

**Nasıl çalışır?** Sipariş geldiğinde (API veya webhook) motor siparişin **tahmini** kârını hesaplar.
Sipariş kargoya verildiğinde (pazaryerinden gelen `Shipped` zamanı veya Siparişler ekranındaki kamyon butonu) Bugün Kargoda / termin
şartı kontrol edilir ve kâr **kesinleşir**. İptal/iade durumunda komisyon iade edilir; kargolanmışsa gidiş + dönüş kargo zarar olarak yazılır.
Sipariş satırındaki net kâra tıklayınca kalem kalem döküm (KDV dahil tutar, içindeki KDV, kâra etkisi) görünür.

**Net kâr formülü** (yüklediğiniz Excel modeliyle birebir — testlerde doğrulandı):
`Net Kâr = KDV hariç ciro − ürün maliyeti (KDV hariç) − Σ (komisyon, bedeller, kargo: KDV hariç) − stopaj − reklam − iade riski`

| Pazaryeri | Komisyon | Ek bedeller | Kargo | Durum |
|---|---|---|---|---|
| Trendyol | KDV dahil fiyat × oran (oran KDV dahil) | Platform hizmet bedeli 10,99 TL + KDV; **Bugün Kargoda + aynı gün taşımada 4,99 TL + KDV**; mikro ihracatta yok | Barem (Tablo 1 hızlı / Tablo 2 standart, <200 / <350 TL, ≤10 desi), paket bölme kuralı, 350 TL+ → 5 Ekim 2026 desi tablosu | ✅ Sizin belgeleriniz |
| Hepsiburada | KDV dahil × oran + %20 KDV | Hizmet bedeli 10,99 TL + KDV (teslimat başına, 21.09.2026) | Barem 43,99 / 75,99 TL (<200 / <400 TL, yalnız HepsiJET/Sürat, 0–1 gün termin) | ⚠️ İkincil kaynak |
| N11 | KDV dahil × oran (KDV dahil) | %1 pazarlama + %0,67 pazaryeri hizmet bedeli (+KDV) | Barem PTT 38,74 / 70,41 (<150 / <300 TL, ≤10 desi) + %2,35 posta | ⚠️ İkincil kaynak |
| Çiçeksepeti | (ürün + kargo) KDV hariç × oran + KDV | %1,99 güvenli ödeme; listeleme 10,90 TL (ayda satan SKU başına, otomatik) | Tarife girilene kadar tahmini 88,96 TL | ⚠️ İkincil kaynak |
| Pazarama | KDV dahil × oran + KDV (kategori tablosu dahil) | — | Barem 31,90 / 56,90 (Yurtiçi 56,90 / 79,90) + %2,35 posta | ⚠️ 2025 barem verisi |
| idefix | KDV dahil × oran + KDV | Yok | Resmi 28.01.2026 desi tablosu (posta dahil) | ⚠️ Komisyon matrahı doğrulanmadı |
| Koçtaş | KDV dahil × oran (KDV dahil, sözleşme EK-7) | Kiosk ödemesinde %3 | Kendi/anlaşmalı kargo — tutarı girin | ✅ Resmi sözleşme |
| Etsy | %6,5 işlem bedeli (ürün + kargo) + KDV | Ödeme işleme %6,5 + 14 TRY, Regulatory Fee %1,67, listeleme 0,20 USD/adet; Offsite Ads ve kur çevrimi isteğe bağlı | Uluslararası kargo ürün bazında elle | ⚠️ İkincil kaynak |

Tüm satıcılar için %1 e-ticaret stopajı (KDV hariç satış üzerinden; Etsy hariç) hesaba katılır — Ayarlar'dan gider sayılmaması seçilebilir.

> **"Aynı gün kargoda komisyonun yarısı" kuralı hakkında:** Trendyol'un duyurularında ve paylaştığınız Trendyol Akademi sayfalarında
> böyle bir komisyon indirimi yok. Aynı gün kargonun gerçek avantajları: **platform hizmet bedeli 10,99 → 4,99 TL + KDV** ve
> **barem kargoda hızlı fiyat** (ör. TEX 0–199,99 TL: 73,33 → 38,74 TL). Bazı yeni mağazalara ilk 60 gün %50 komisyon indirimi
> verildiğine dair satıcı beyanları var; böyle bir kampanyanız varsa *Maliyet Kuralları > Komisyon indirimi* alanına oranı ve bitiş tarihini girin.

**Kurallar nasıl güncellenir?** *Maliyet Kuralları* ekranında her pazaryeri için komisyon, bedeller, barem fiyatları ve kargo
firması düzenlenir. Pazaryeri yeni tarife duyurduğunda **yeni yürürlük tarihiyle** kaydedin; eski siparişler eski kuralla kalır.
Desi tablolarını *Kargo Tarifeleri* sekmesine PDF/Excel'den iki sütun ("desi;fiyat") olarak yapıştırabilirsiniz.
Ürün bazında kategori komisyonu, termin, Bugün Kargoda ve Hızlı Teslimat etiketleri, kargo firması: yeni ürün sihirbazının 4. adımı veya *Ürünler > hesap makinesi simgesi*.

**Fiyat Hesaplayıcı:** Excel'inizdeki "Gelişmiş Fiyat Modeli"nin 8 pazaryerli hali — hedef kâr (maliyet üzerinden %, ciro marjı
veya sabit TL) için her pazaryerinde gereken en düşük fiyatı, x,90 vitrin fiyatını, barem kademe karşılaştırmasını
(199,90 / 349,90 …) ve 1/2/3/5'li set analizini verir. Excel'deki örnek (14 TL, %10 KDV, %70, %20, TEX, Bugün Kargoda) →
**93,42 TL fiyat, 10,78 TL net kâr**; 2'li 127,21, 3'lü 161,00, 5'li 271,77 — motor bu değerleri birebir üretir (`npm test`).

---

---

## 7. Yeni Pazaryeri Eklemek

1. `src/lib/marketplaces/adapters/yeni.ts` → `MarketplaceAdapter` arayüzünü uygulayın.
2. `meta.ts` → `MARKETPLACES` dizisine ve `MARKETPLACE_META`'ya ekleyin.
3. `registry.ts` → `FACTORIES` nesnesine bir satır ekleyin.
4. SQL:
   ```sql
   insert into marketplaces(name, label, color, sort_order) values ('yeni', 'Yeni Pazaryeri', '#10B981', 5);
   insert into marketplace_credentials(marketplace_name) values ('yeni');
   ```
   `v_stock_breakdown.sales_by_marketplace` yeni pazaryerini otomatik kapsar.

---

## 8. Komutlar

| Komut | Açıklama |
|---|---|
| `npm run dev` | Geliştirme sunucusu |
| `npm run build` | Üretim derlemesi |
| `npm start` | Üretim sunucusu |
| `npm run typecheck` | TypeScript kontrolü |
| `npm test` | Maliyet motoru testleri (Excel modeli, barem/paket bölme örnekleri, 8 pazaryeri) |
