'use client';
import { useEffect, useState } from 'react';
import { ExternalLink, Lightbulb, Megaphone, Plus, Trash2 } from 'lucide-react';
import { BASE_MARKETPLACES, MARKETPLACE_META, type MarketplaceName } from '@/lib/marketplaces/meta';
import { AD_GUIDES } from '@/lib/marketplaces/ads';
import { api, useLiveData, useToast } from '@/components/live';
import { Button, Card, Empty, ErrorBox, Field, MarketplaceBadge, PageLoader, cx, inputClass, tl2 } from '@/components/ui';

interface AdData { range: { from: string; to: string }; rows: Array<{ id: string; marketplace_name: string; spend_date: string; amount: number; note: string }>; byMarketplace: Record<string, number>; total: number }

const today = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);

/**
 * Reklam: pazaryerleri reklam sistemlerini dışarıya açmadığı için reklam kendi panellerinden verilir.
 * Bu sayfa her pazaryeri için adım adım yol gösterir ve harcanan tutarı kâr hesabına katar.
 */
export default function AdsPage() {
  const toast = useToast();
  const { data, error, loading, reload } = useLiveData<AdData>('/api/ads');
  const [connected, setConnected] = useState<MarketplaceName[]>([]);
  const [open, setOpen] = useState<MarketplaceName | null>(null);
  const [form, setForm] = useState({ marketplace: '' as MarketplaceName | '', date: today(), amount: '', note: '' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ credentials: Array<{ marketplace: MarketplaceName; mode: string }> }>('/api/credentials').then((r) => {
      const live = r.credentials.filter((c) => c.mode !== 'off').map((c) => c.marketplace);
      setConnected(live);
      setOpen((o) => o ?? live[0] ?? 'trendyol');
      setForm((f) => (f.marketplace ? f : { ...f, marketplace: live[0] ?? 'trendyol' }));
    }).catch(() => {});
  }, []);

  const list = [...BASE_MARKETPLACES].sort((a, b) => Number(connected.includes(b)) - Number(connected.includes(a)));

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/api/ads', { method: 'POST', body: form });
      toast('Reklam harcaması eklendi; kâr hesabına yansıdı.');
      setForm((f) => ({ ...f, amount: '', note: '' }));
      reload();
    } catch (err) { toast((err as Error).message, 'err'); } finally { setBusy(false); }
  }

  async function remove(id: string) {
    if (!window.confirm('Bu harcama kaydı silinsin mi?')) return;
    try { await api(`/api/ads?id=${id}`, { method: 'DELETE' }); reload(); } catch (err) { toast((err as Error).message, 'err'); }
  }

  return (
    <div className="space-y-6 fade-in max-w-5xl">
      <Card className="p-5 bg-indigo-50/60 border-indigo-100">
        <div className="flex items-start gap-3">
          <Megaphone className="w-5 h-5 text-indigo-600 mt-0.5 shrink-0" />
          <div className="text-sm text-slate-700 space-y-1">
            <p><b>Reklam nasıl verilir?</b> Trendyol, Hepsiburada, N11 ve diğerleri reklam sistemlerini dış programlara açmıyor; reklam her pazaryerinin kendi panelinden, birkaç tıklamayla verilir.</p>
            <p>Aşağıdan pazaryerini seçin, adımları izleyin ve <b>"Reklam paneline git"</b> ile doğrudan oraya gidin. Harcadığınız tutarı en alttaki forma yazarsanız <b>Kârlılık</b> sayfasında reklam sonrası gerçek kârınızı görürsünüz.</p>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="space-y-2">
          {list.map((m) => (
            <button key={m} onClick={() => setOpen(m)}
              className={cx('w-full flex items-center gap-2 px-4 py-3 rounded-xl border text-left text-sm', open === m ? 'border-indigo-400 bg-white ring-2 ring-indigo-100' : 'border-slate-200 bg-white hover:border-slate-300')}>
              <MarketplaceBadge name={m} />
              <span className="flex-1 truncate">{AD_GUIDES[m].product}</span>
              {connected.includes(m) && <span className="text-[10px] text-emerald-600">bağlı</span>}
            </button>
          ))}
        </div>
        {open && (
          <Card className="lg:col-span-2 p-6 space-y-4">
            <div className="flex items-center gap-2"><MarketplaceBadge name={open} /><h2 className="font-semibold">{AD_GUIDES[open].product}</h2></div>
            <ol className="list-decimal pl-5 space-y-2 text-sm text-slate-700">{AD_GUIDES[open].steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
            <div className="flex items-start gap-2 text-sm bg-amber-50 text-amber-900 rounded-lg p-3"><Lightbulb className="w-4 h-4 mt-0.5 shrink-0" />{AD_GUIDES[open].tip}</div>
            <div className="flex flex-wrap items-center gap-3">
              <a href={AD_GUIDES[open].url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700">
                Reklam paneline git <ExternalLink className="w-4 h-4" />
              </a>
              {data?.byMarketplace[open] ? <span className="text-sm text-slate-600">Bu ay {MARKETPLACE_META[open].at} harcanan: <b>{tl2(data.byMarketplace[open])}</b></span> : null}
            </div>
            <p className="text-[11px] text-slate-400">Menü adları pazaryerinin güncellemeleriyle değişebilir; bulamazsanız panelde "Reklam" diye arayın.</p>
          </Card>
        )}
      </div>

      <Card className="p-6 space-y-4">
        <h2 className="font-semibold">Reklam harcamaları</h2>
        <form onSubmit={add} className="grid grid-cols-2 md:grid-cols-5 gap-3 items-end">
          <Field label="Pazaryeri">
            <select className={inputClass} value={form.marketplace} onChange={(e) => setForm({ ...form, marketplace: e.target.value as MarketplaceName })}>
              {BASE_MARKETPLACES.map((m) => <option key={m} value={m}>{MARKETPLACE_META[m].label}</option>)}
            </select>
          </Field>
          <Field label="Tarih"><input className={inputClass} type="date" value={form.date} max={today()} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
          <Field label="Tutar (KDV dahil ₺)"><input className={inputClass} inputMode="decimal" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="250" /></Field>
          <Field label="Not (isteğe bağlı)"><input className={inputClass} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Kampanya adı" /></Field>
          <Button type="submit" loading={busy}><Plus className="w-4 h-4" /> Ekle</Button>
        </form>
        {loading ? <PageLoader /> : error || !data ? <ErrorBox error={error ?? ''} onRetry={reload} /> : !data.rows.length ? <Empty>Bu ay için reklam harcaması girilmedi.</Empty> : (
          <>
            <div className="text-sm text-slate-600">Bu ay toplam: <b>{tl2(data.total)}</b> (KDV dahil)</div>
            <table className="w-full text-sm">
              <thead className="text-xs text-slate-500"><tr><th className="text-left py-2">Tarih</th><th className="text-left">Pazaryeri</th><th className="text-left">Not</th><th className="text-right">Tutar</th><th /></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {data.rows.map((r) => (
                  <tr key={r.id}>
                    <td className="py-2">{new Date(r.spend_date).toLocaleDateString('tr-TR')}</td>
                    <td><MarketplaceBadge name={r.marketplace_name} size="xs" /></td>
                    <td className="text-slate-600">{r.note}</td>
                    <td className="text-right tabular-nums">{tl2(r.amount)}</td>
                    <td className="text-right"><button onClick={() => remove(r.id)} title="Sil" className="p-1 text-slate-400 hover:text-rose-600"><Trash2 className="w-4 h-4" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </Card>
    </div>
  );
}
