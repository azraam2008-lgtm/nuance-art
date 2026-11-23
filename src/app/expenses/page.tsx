'use client';
import { useState } from 'react';
import { Plus, Repeat, StopCircle, Trash2 } from 'lucide-react';
import { api, useLiveData, useToast } from '@/components/live';
import { Button, Card, Empty, ErrorBox, Field, PageLoader, cx, inputClass, tl2 } from '@/components/ui';

interface Expense { id: string; category: string; amount: number; expense_date: string; monthly: boolean; end_date: string | null; note: string }
interface Resp { range: { from: string; to: string }; rows: Expense[]; byCategory: Record<string, number>; total: number; categories: string[] }

const today = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
const trDate = (d: string) => new Date(d).toLocaleDateString('tr-TR');

/**
 * İşletme giderleri: kira, personel, muhasebe gibi siparişe bağlı olmayan giderler.
 * Aylık giderler her ay otomatik sayılır; Kârlılık sayfasındaki "işletme net kârı"ndan düşülür.
 */
export default function ExpensesPage() {
  const toast = useToast();
  const { data, error, loading, reload } = useLiveData<Resp>('/api/expenses');
  const [f, setF] = useState({ category: 'Kira', amount: '', date: today(), monthly: true, note: '' });
  const [busy, setBusy] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/api/expenses', { method: 'POST', body: f });
      toast(f.monthly ? 'Aylık gider eklendi; her ay otomatik sayılacak.' : 'Gider eklendi.');
      setF((x) => ({ ...x, amount: '', note: '' }));
      reload();
    } catch (err) { toast((err as Error).message, 'err'); } finally { setBusy(false); }
  }

  async function remove(x: Expense, stop: boolean) {
    if (!window.confirm(stop ? 'Bu aylık gider bugünden itibaren durdurulsun mu? (Geçmiş aylar etkilenmez)' : 'Bu gider kaydı silinsin mi? Geçmiş kâr hesapları da değişir.')) return;
    try { await api(`/api/expenses?id=${x.id}${stop ? '&stop=1' : ''}`, { method: 'DELETE' }); reload(); } catch (err) { toast((err as Error).message, 'err'); }
  }

  return (
    <div className="space-y-4 fade-in max-w-4xl">
      <Card className="p-4 text-sm text-slate-600">
        Siparişlerdeki komisyon, kargo, hizmet bedeli, ürün ve ambalaj maliyeti zaten otomatik hesaplanıyor. Burada <b>siparişe bağlı olmayan</b> giderleri girin
        (kira, personel, muhasebeci, internet…). <b>Kârlılık</b> sayfası bunları düşerek işletmenizin gerçek net kârını gösterir.
      </Card>

      <Card className="p-4 sm:p-6">
        <form onSubmit={add} className="grid grid-cols-2 md:grid-cols-6 gap-3 items-end">
          <div className="col-span-2 md:col-span-2">
            <Field label="Gider türü">
              <select className={inputClass} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
                {(data?.categories ?? ['Kira', 'Personel', 'Diğer']).map((c) => <option key={c}>{c}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Tutar (KDV dahil ₺)"><input className={inputClass} inputMode="decimal" required value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder="5000" /></Field>
          <Field label={f.monthly ? 'Başlangıç' : 'Tarih'}><input className={inputClass} type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <label className="flex items-center gap-2 text-sm pb-2.5 col-span-2 md:col-span-1">
            <input type="checkbox" className="w-4 h-4 accent-indigo-600" checked={f.monthly} onChange={(e) => setF({ ...f, monthly: e.target.checked })} /> Her ay tekrarla
          </label>
          <Button type="submit" loading={busy} className="col-span-2 md:col-span-1"><Plus className="w-4 h-4" /> Ekle</Button>
          <div className="col-span-2 md:col-span-6"><Field label="Not (isteğe bağlı)"><input className={inputClass} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="Ör. atölye kirası" /></Field></div>
        </form>
      </Card>

      {loading ? <PageLoader /> : error || !data ? <ErrorBox error={error ?? ''} onRetry={reload} /> : (
        <>
          <Card className="p-4">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-sm text-slate-500">Bu ay toplam gider</span>
              <span className="text-xl font-bold tabular-nums">{tl2(data.total)}</span>
            </div>
            {Object.keys(data.byCategory).length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {Object.entries(data.byCategory).sort((a, b) => b[1] - a[1]).map(([k, v]) => <span key={k} className="text-xs bg-slate-100 rounded-full px-2.5 py-1">{k}: <b>{tl2(v)}</b></span>)}
              </div>
            )}
          </Card>
          {!data.rows.length ? <Card><Empty>Henüz gider eklenmedi.</Empty></Card> : (
            <div className="space-y-2">
              {data.rows.map((x) => {
                const ended = x.monthly && x.end_date && x.end_date < today();
                return (
                  <Card key={x.id} className={cx('p-3 flex flex-wrap items-center gap-x-3 gap-y-1', ended && 'opacity-60')}>
                    <span className="font-medium text-sm">{x.category}</span>
                    {x.monthly && <span className="text-[11px] inline-flex items-center gap-1 bg-indigo-50 text-indigo-700 rounded px-1.5 py-0.5"><Repeat className="w-3 h-3" /> aylık</span>}
                    {x.note && <span className="text-sm text-slate-500">{x.note}</span>}
                    <span className="ml-auto font-semibold tabular-nums">{tl2(x.amount)}{x.monthly && <span className="text-xs font-normal text-slate-500"> / ay</span>}</span>
                    <span className="w-full sm:w-auto text-[11px] text-slate-500">
                      {x.monthly ? `${trDate(x.expense_date)}'den itibaren${x.end_date ? ` · ${trDate(x.end_date)}'de bitti` : ''}` : trDate(x.expense_date)}
                    </span>
                    <span className="flex gap-1">
                      {x.monthly && !x.end_date && <Button variant="ghost" className="text-xs px-2 py-1" onClick={() => remove(x, true)}><StopCircle className="w-3.5 h-3.5" /> Durdur</Button>}
                      <button onClick={() => remove(x, false)} title="Sil" className="p-1.5 text-slate-400 hover:text-rose-600"><Trash2 className="w-4 h-4" /></button>
                    </span>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
