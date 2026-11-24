'use client';
import { useEffect, useState } from 'react';
import { ChevronDown, FileText, PlugZap, Save } from 'lucide-react';
import { api, useToast } from '@/components/live';
import { Button, Card, Field, cx, inputClass } from '@/components/ui';
import { PROVIDER_LABEL, type InvoicingSettings, type ProviderName } from '@/lib/invoicing/types';

interface Resp { settings: InvoicingSettings; secrets: Record<string, string>; problems: string[] }

const HELP: Record<ProviderName, string> = {
  none: 'Fatura kesmiyorsanız (ör. esnaf muaflığı) bunu seçin; panel fatura uyarısı göstermez. Durumunuzu mali müşavirinize danışın.',
  manual: 'Faturayı kendi programınızda (veya GİB e-Arşiv Portal\'da) kesersiniz; fatura numarasını siparişe yazarsınız, isterseniz PDF\'ini de yüklersiniz. Kervan numarayı pazaryerine iletir.',
  parasut: 'Kervan faturayı Paraşüt hesabınızda otomatik keser (alıcı e-Fatura mükellefiyse e-Fatura, değilse e-Arşiv). Paraşüt\'ten API erişimi (Client ID / Secret) istemeniz gerekir.',
  nilvera: 'Kervan e-Arşiv faturayı Nilvera hesabınızda otomatik keser. API anahtarını Nilvera portalında Ayarlar → API bölümünden alırsınız.',
};

/** Ayarlar → Fatura: hangi yolla fatura kesileceği, satıcı bilgileri ve sağlayıcı anahtarları */
export default function InvoicingSettingsCard() {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [d, setD] = useState<Resp | null>(null);
  const [sec, setSec] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { api<Resp>('/api/invoicing').then(setD).catch(() => {}); }, []);
  if (!d) return null;
  const s = d.settings;
  const set = (patch: Partial<InvoicingSettings>) => setD({ ...d, settings: { ...s, ...patch } });
  const seller = (k: keyof InvoicingSettings['seller']) => ({ value: String(s.seller[k] ?? ''), onChange: (e: React.ChangeEvent<HTMLInputElement>) => set({ seller: { ...s.seller, [k]: e.target.value } }) });
  const auto = s.provider === 'parasut' || s.provider === 'nilvera';

  async function save() {
    setBusy('save');
    try {
      const r = await api<{ problems: string[] }>('/api/invoicing', { method: 'PUT', body: { settings: s, secrets: sec } });
      setSec({});
      const fresh = await api<Resp>('/api/invoicing'); setD(fresh);
      toast(r.problems.length ? `Kaydedildi. Eksik: ${r.problems.join(', ')}` : 'Fatura ayarları kaydedildi.', r.problems.length ? 'err' : 'ok');
    } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(null); }
  }
  async function test() {
    setBusy('test');
    try { const r = await api<{ ok: boolean; message: string }>('/api/invoicing', { method: 'POST' }); toast(r.message, r.ok ? 'ok' : 'err'); }
    catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(null); }
  }

  return (
    <Card className="overflow-hidden">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-slate-50">
        <span className="w-9 h-9 rounded-lg bg-indigo-50 text-indigo-600 grid place-items-center"><FileText className="w-5 h-5" /></span>
        <span><span className="font-medium block">Fatura (e-Arşiv / e-Fatura)</span><span className="text-xs text-slate-500">{PROVIDER_LABEL[s.provider]}{s.auto ? ' · kargoya verilince otomatik' : ''}</span></span>
        <span className="flex-1" />
        {d.problems.length > 0 && <span className="text-xs text-rose-600">bilgi eksik</span>}
        <ChevronDown className={cx('w-4 h-4 text-slate-400 transition', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="px-5 pb-5 border-t border-slate-100 pt-4 space-y-4">
          <div className="grid gap-2">
            {(Object.keys(PROVIDER_LABEL) as ProviderName[]).map((p) => (
              <label key={p} className={cx('flex gap-3 rounded-xl border p-3 cursor-pointer', s.provider === p ? 'border-indigo-400 bg-indigo-50/50' : 'border-slate-200')}>
                <input type="radio" className="mt-1 accent-indigo-600" checked={s.provider === p} onChange={() => set({ provider: p })} />
                <span><span className="text-sm font-medium">{PROVIDER_LABEL[p]}</span><span className="block text-xs text-slate-500 mt-0.5">{HELP[p]}</span></span>
              </label>
            ))}
          </div>

          {auto && (
            <>
              <div>
                <div className="text-sm font-medium mb-2">Faturada görünecek satıcı (sizin) bilgileriniz</div>
                <div className="grid sm:grid-cols-2 gap-3">
                  <Field label="Firma unvanı / ad soyad"><input className={inputClass} {...seller('name')} /></Field>
                  <Field label="Vergi no (10) veya TC kimlik no (11)"><input className={inputClass} inputMode="numeric" {...seller('taxNumber')} /></Field>
                  <Field label="Vergi dairesi"><input className={inputClass} {...seller('taxOffice')} /></Field>
                  <Field label="E-posta"><input className={inputClass} {...seller('email')} /></Field>
                  <div className="sm:col-span-2"><Field label="Adres"><input className={inputClass} {...seller('address')} /></Field></div>
                  <Field label="İlçe"><input className={inputClass} {...seller('district')} /></Field>
                  <Field label="İl"><input className={inputClass} {...seller('city')} /></Field>
                  <Field label="Telefon"><input className={inputClass} {...seller('phone')} /></Field>
                  <Field label="Web sitesi (e-Arşiv internet satışı için)" hint="Yoksa boş bırakın"><input className={inputClass} {...seller('website')} placeholder="www.ornek.com" /></Field>
                </div>
              </div>

              {s.provider === 'parasut' && (
                <div className="grid sm:grid-cols-2 gap-3">
                  <Field label="Client ID" hint="Paraşüt destekten API erişimi isteyince verilir"><input className={inputClass} value={s.parasut.clientId} onChange={(e) => set({ parasut: { ...s.parasut, clientId: e.target.value } })} /></Field>
                  <Field label="Client Secret"><input className={inputClass} type="password" placeholder={d.secrets.parasutClientSecret || ''} value={sec.parasutClientSecret ?? ''} onChange={(e) => setSec({ ...sec, parasutClientSecret: e.target.value })} /></Field>
                  <Field label="Paraşüt giriş e-postası"><input className={inputClass} value={s.parasut.username} onChange={(e) => set({ parasut: { ...s.parasut, username: e.target.value } })} /></Field>
                  <Field label="Paraşüt şifresi"><input className={inputClass} type="password" placeholder={d.secrets.parasutPassword || ''} value={sec.parasutPassword ?? ''} onChange={(e) => setSec({ ...sec, parasutPassword: e.target.value })} /></Field>
                  <Field label="Firma numarası" hint="Paraşüt'e girince adres çubuğundaki sayı (uygulama.parasut.com/123456/…)"><input className={inputClass} inputMode="numeric" value={s.parasut.companyId} onChange={(e) => set({ parasut: { ...s.parasut, companyId: e.target.value } })} /></Field>
                  <Field label="Hizmet/ürün kaydı ID (isteğe bağlı)" hint="Paraşüt satırlarda ürün kaydı isterse buraya genel bir ürünün ID'sini yazın"><input className={inputClass} value={s.parasut.productId} onChange={(e) => set({ parasut: { ...s.parasut, productId: e.target.value } })} /></Field>
                </div>
              )}
              {s.provider === 'nilvera' && (
                <div className="grid sm:grid-cols-2 gap-3">
                  <Field label="Nilvera API anahtarı"><input className={inputClass} type="password" placeholder={d.secrets.nilveraApiKey || ''} value={sec.nilveraApiKey ?? ''} onChange={(e) => setSec({ ...sec, nilveraApiKey: e.target.value })} /></Field>
                  <Field label="Fatura seri harfleri (3 harf)" hint="Nilvera'da tanımlı e-Arşiv seriniz"><input className={inputClass} maxLength={3} value={s.series} onChange={(e) => set({ series: e.target.value.toUpperCase() })} /></Field>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="w-4 h-4 accent-indigo-600" checked={s.nilvera.test} onChange={(e) => set({ nilvera: { ...s.nilvera, test: e.target.checked } })} /> Test ortamı (gerçek fatura kesilmez)</label>
                </div>
              )}
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="w-4 h-4 accent-indigo-600" checked={s.auto} onChange={(e) => set({ auto: e.target.checked })} /> Sipariş &quot;kargoya verildi&quot; olunca faturayı otomatik kes</label>
              {d.problems.length > 0 && <p className="text-xs text-rose-700">Eksik bilgi: {d.problems.join(', ')}</p>}
            </>
          )}
          <p className="text-[11px] text-slate-500">Faturanın doğruluğundan (KDV oranı, alıcı bilgileri) satıcı sorumludur. İlk faturaları sağlayıcınızın panelinden kontrol edin. Ürünlerin KDV oranı ürün kartından alınır.</p>
          <div className="flex flex-wrap gap-2 justify-end">
            {auto && <Button variant="secondary" loading={busy === 'test'} onClick={test}><PlugZap className="w-4 h-4" /> Bağlantıyı test et</Button>}
            <Button loading={busy === 'save'} onClick={save}><Save className="w-4 h-4" /> Kaydet</Button>
          </div>
        </div>
      )}
    </Card>
  );
}
