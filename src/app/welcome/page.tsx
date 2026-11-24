import Link from 'next/link';
import { ArrowRight, Bell, Boxes, Calculator, FlaskConical, Lightbulb, ListChecks, ShoppingCart, Smartphone, Users } from 'lucide-react';
import { BrandMark, BrandName } from '@/components/Brand';
import { BRAND } from '@/lib/brand';

export const metadata = { title: `${BRAND.name} — ${BRAND.tagline}` };

const MARKETS = ['Trendyol', 'Hepsiburada', 'N11', 'Çiçeksepeti', 'Pazarama', 'idefix', 'Koçtaş', 'Etsy'];

const FEATURES = [
  { icon: Boxes, t: 'Ortak stok havuzu', d: 'Bir pazaryerinde satış olunca stok düşer ve yeni stok diğer tüm ilanlara otomatik gider. Aynı ürünü iki kez satma derdi biter.' },
  { icon: ShoppingCart, t: 'Tüm siparişler tek listede', d: 'Siparişler kendiliğinden gelir. Durumu panelde değiştirin; siparişin geldiği pazaryerine bildirilir. Geciken siparişler kırmızı uyarı verir.' },
  { icon: Calculator, t: 'Gerçek kâr hesabı', d: 'Her pazaryeri için komisyon, kargo, hizmet bedeli ve stopaj düşülür; her üründe ve her siparişte net kârınızı görürsünüz. Zararına satışta uyarır.' },
  { icon: ListChecks, t: 'Hiçbir hata saklanmaz', d: 'Pazaryerine gönderilemeyen işlemler kayda alınır, kendiliğinden tekrar denenir ve İşlem Merkezi\'nde pazaryeri bazında gösterilir.' },
  { icon: Lightbulb, t: 'Öneriler', d: 'Hangi ürünün stoğu kaç günde biter, hangi ürün zarar ettiriyor, hangi pazaryeri daha kârlı — verilerinizden hesaplanır.' },
  { icon: Users, t: 'Ekip ve yetkiler', d: 'Çalışanlarınızı davet edin. Personel sipariş ve stokla çalışır ama maliyet, kâr ve API anahtarlarını göremez. Kim ne yaptı kayıtta durur.' },
  { icon: Bell, t: 'E-posta bildirimleri', d: 'Yeni sipariş, biten stok, geciken kargo ve gönderilemeyen işlemler e-postanıza gelir; isterseniz her sabah günlük özet.' },
  { icon: Smartphone, t: 'Telefondan da çalışır', d: 'Ürün ekleyin, fotoğrafı kameradan çekin, siparişi kargoya verin — bilgisayar başında olmanız gerekmez.' },
];

const STEPS = [
  { t: 'Ücretsiz hesap açın', d: 'E-postanız ve şifrenizle 1 dakikada mağazanızı oluşturun.' },
  { t: 'Pazaryerlerinizi bağlayın', d: 'Sattığınız pazaryerlerini seçin; her biri için resimli rehberle API anahtarınızı girin.' },
  { t: 'Tek yerden yönetin', d: 'Ürünü bir kez ekleyin, hepsine gitsin. Stok, sipariş ve kâr kendiliğinden güncel kalsın.' },
];

/** Giriş yapmamış ziyaretçiler için tanıtım sayfası */
export default function WelcomePage() {
  return (
    <div className="min-h-screen bg-white text-slate-900">
      <header className="max-w-6xl mx-auto px-4 py-4 flex items-center gap-3">
        <BrandMark size={34} /><BrandName />
        <nav className="ml-auto flex items-center gap-2 text-sm">
          <Link href="/login" className="px-3 py-2 rounded-lg hover:bg-slate-100">Giriş yap</Link>
          <Link href="/signup" className="px-3 py-2 rounded-lg bg-slate-900 text-white hover:bg-slate-800">Ücretsiz başla</Link>
        </nav>
      </header>

      <section className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white">
        <div className="max-w-6xl mx-auto px-4 py-14 sm:py-20">
          <h1 className="text-3xl sm:text-5xl font-bold leading-tight max-w-3xl">Tüm pazarlarınız <span className="text-amber-300">tek kervanda.</span></h1>
          <p className="mt-4 text-slate-300 max-w-2xl text-base sm:text-lg">Trendyol'dan Etsy'ye, ürün, stok, sipariş ve kârınızı tek panelden yönetin. Bir yerde satış olunca stok her yerde düşsün; her siparişte gerçekten ne kazandığınızı görün.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/signup" className="inline-flex items-center gap-2 rounded-lg bg-amber-400 text-slate-900 font-semibold px-5 py-3">Ücretsiz hesap aç <ArrowRight className="w-4 h-4" /></Link>
            <Link href="/login" className="inline-flex items-center gap-2 rounded-lg border border-slate-600 px-5 py-3 hover:bg-slate-800">Giriş yap</Link>
          </div>
          <div className="mt-10 flex flex-wrap gap-2">
            {MARKETS.map((m) => <span key={m} className="text-xs sm:text-sm rounded-full bg-white/10 px-3 py-1">{m}</span>)}
          </div>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-4 py-14">
        <h2 className="text-2xl font-bold">Neler yapabilirsiniz?</h2>
        <div className="mt-6 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {FEATURES.map(({ icon: Icon, t, d }) => (
            <div key={t} className="rounded-2xl border border-slate-200 p-5">
              <div className="w-9 h-9 rounded-lg bg-indigo-50 text-indigo-600 grid place-items-center"><Icon className="w-5 h-5" /></div>
              <h3 className="font-semibold mt-3">{t}</h3>
              <p className="text-sm text-slate-600 mt-1">{d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-slate-50">
        <div className="max-w-6xl mx-auto px-4 py-14">
          <h2 className="text-2xl font-bold">Nasıl başlanır?</h2>
          <ol className="mt-6 grid md:grid-cols-3 gap-4">
            {STEPS.map((s, i) => (
              <li key={s.t} className="rounded-2xl bg-white border border-slate-200 p-5">
                <div className="w-8 h-8 rounded-full bg-slate-900 text-amber-300 grid place-items-center font-bold">{i + 1}</div>
                <h3 className="font-semibold mt-3">{s.t}</h3>
                <p className="text-sm text-slate-600 mt-1">{s.d}</p>
              </li>
            ))}
          </ol>
          <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-5 flex gap-3">
            <FlaskConical className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
            <p className="text-sm text-amber-900"><b>Henüz pazaryeri hesabınız yok mu?</b> Kayıttan sonra <b>deneme mağazasını</b> açın: örnek ürün ve siparişlerle paneli gerçek bir pazaryerine bağlanmadan deneyebilirsiniz.</p>
          </div>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-4 py-14 text-center">
        <h2 className="text-2xl font-bold">Hemen deneyin — ücretsiz</h2>
        <p className="text-slate-600 mt-2">Kredi kartı gerekmez. Verileriniz yalnızca size ve davet ettiğiniz ekibe görünür.</p>
        <Link href="/signup" className="mt-6 inline-flex items-center gap-2 rounded-lg bg-slate-900 text-white font-semibold px-6 py-3">Mağazamı oluştur <ArrowRight className="w-4 h-4" /></Link>
      </section>

      <footer className="border-t border-slate-200">
        <div className="max-w-6xl mx-auto px-4 py-6 flex flex-wrap gap-x-4 gap-y-2 text-xs text-slate-500">
          <span>© {new Date().getFullYear()} {BRAND.name}</span>
          <Link href="/legal/terms" className="hover:text-slate-800">Kullanım şartları</Link>
          <Link href="/legal/privacy" className="hover:text-slate-800">Gizlilik</Link>
          <Link href="/legal/kvkk" className="hover:text-slate-800">KVKK aydınlatma</Link>
        </div>
      </footer>
    </div>
  );
}
