'use client';
import { useEffect, useState } from 'react';
import { FileText, RotateCcw, Upload } from 'lucide-react';
import { api, useToast } from '@/components/live';
import { Button, Field, Modal, cx, fmtDate, inputClass, tl2 } from '@/components/ui';

interface Inv { status: string; provider: string; kind: string | null; invoice_number: string | null; issued_at: string | null; pdf_path: string | null; last_error: string | null; attempts: number; next_try_at: string; marketplace_sent: string | null }
interface Draft {
  orderNo: string; marketplaceLabel: string;
  buyer: { name: string; taxNumber: string; taxOffice: string; address: string; district: string; city: string; email: string };
  lines: Array<{ sku: string; name: string; quantity: number; unitNet: number; vatRate: number; net: number; vat: number; gross: number }>;
  totals: { net: number; vat: number; gross: number };
}

const STATUS: Record<string, { t: string; c: string }> = {
  pending: { t: 'Sırada (birazdan kesilecek)', c: 'bg-amber-50 text-amber-800' },
  processing: { t: 'Fatura firması işliyor', c: 'bg-amber-50 text-amber-800' },
  issued: { t: 'Kesildi', c: 'bg-emerald-50 text-emerald-700' },
  failed: { t: 'Kesilemedi', c: 'bg-rose-50 text-rose-700' },
};

/** Siparişin faturası: durum, PDF, alıcı/satır bilgisi, otomatik kesim veya numarayı elle girme */
export default function InvoiceModal({ orderId, onClose, onChanged }: { orderId: string | null; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const [d, setD] = useState<{ invoice: Inv | null; draft: Draft; provider: string } | null>(null);
  const [number, setNumber] = useState('');
  const [pdf, setPdf] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = () => orderId && api<{ invoice: Inv | null; draft: Draft; provider: string }>(`/api/invoices?orderId=${orderId}`).then(setD).catch((e) => toast((e as Error).message, 'err'));
  useEffect(() => { setD(null); setNumber(''); setPdf(null); load(); }, [orderId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!orderId) return null;

  async function issue() {
    setBusy('issue');
    try {
      const r = await api<{ results: Array<{ ok: boolean; message: string }> }>('/api/invoices', { method: 'POST', body: { action: 'issue', ids: [orderId] } });
      const x = r.results[0];
      toast(x ? x.message : 'Fatura zaten kesilmiş.', x && !x.ok ? 'err' : 'ok');
      load(); onChanged();
    } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(null); }
  }
  async function saveManual(e: React.FormEvent) {
    e.preventDefault();
    setBusy('manual');
    try {
      const r = await api<{ message: string }>('/api/invoices', { method: 'POST', body: { action: 'manual', orderId, number, pdfBase64: pdf } });
      toast(`Fatura kaydedildi. ${r.message}`);
      load(); onChanged();
    } catch (err) { toast((err as Error).message, 'err'); } finally { setBusy(null); }
  }
  function pickPdf(f: File | undefined) {
    if (!f) return setPdf(null);
    if (f.size > 4_000_000) { toast('PDF en fazla 4 MB olabilir.', 'err'); return; }
    const r = new FileReader(); r.onload = () => setPdf(String(r.result)); r.readAsDataURL(f);
  }

  const inv = d?.invoice;
  const auto = d && (d.provider === 'parasut' || d.provider === 'nilvera' || d.provider === 'demo');
  return (
    <Modal open={!!orderId} onClose={onClose} wide title={d ? `Fatura · ${d.draft.marketplaceLabel} #${d.draft.orderNo}` : 'Fatura'}>
      {!d ? <div className="text-sm text-slate-500">Yükleniyor…</div> : (
        <div className="space-y-4 text-sm">
          {inv ? (
            <div className={cx('rounded-xl p-3 space-y-1', STATUS[inv.status]?.c ?? 'bg-slate-50')}>
              <div className="font-medium">{STATUS[inv.status]?.t ?? inv.status}{inv.invoice_number && <> · <span className="font-mono">{inv.invoice_number}</span></>}</div>
              {inv.issued_at && <div className="text-xs">{fmtDate(inv.issued_at)} · {inv.provider === 'manual' ? 'elle girildi' : inv.provider}</div>}
              {inv.last_error && <div className="text-xs">Sebep: {inv.last_error}</div>}
              {inv.status === 'pending' && inv.attempts > 0 && <div className="text-xs">Sonraki deneme: {fmtDate(inv.next_try_at)}</div>}
              {inv.marketplace_sent && <div className="text-xs">Pazaryeri: {inv.marketplace_sent}</div>}
              {inv.pdf_path && <a href={`/api/invoices/${orderId}/pdf`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium underline"><FileText className="w-3.5 h-3.5" /> PDF'i aç</a>}
            </div>
          ) : <div className="rounded-xl p-3 bg-slate-50 text-slate-600">Bu siparişin faturası henüz yok.</div>}

          {auto && inv?.status !== 'issued' && (
            <Button loading={busy === 'issue'} onClick={issue}>{inv?.status === 'failed' ? <><RotateCcw className="w-4 h-4" /> Tekrar dene</> : <><FileText className="w-4 h-4" /> Faturayı şimdi kes</>}</Button>
          )}
          {d.provider === 'none' && !inv && <p className="text-xs text-slate-500">Ayarlar → Fatura&apos;da &quot;Fatura kesmiyorum&quot; seçili. Fatura kesiyorsanız oradan yönteminizi seçin.</p>}

          <div className="grid md:grid-cols-2 gap-4">
            <div className="rounded-xl border border-slate-200 p-3">
              <div className="text-xs font-semibold text-slate-500 mb-1">ALICI (pazaryerinden)</div>
              <div className="font-medium">{d.draft.buyer.name}</div>
              <div className="text-xs text-slate-600">{d.draft.buyer.taxNumber.length === 10 ? `VKN ${d.draft.buyer.taxNumber}${d.draft.buyer.taxOffice ? ` · ${d.draft.buyer.taxOffice}` : ''}` : `TCKN ${d.draft.buyer.taxNumber}`}</div>
              <div className="text-xs text-slate-600">{d.draft.buyer.address} {d.draft.buyer.district} / {d.draft.buyer.city}</div>
              {d.draft.buyer.email && <div className="text-xs text-slate-600">{d.draft.buyer.email}</div>}
            </div>
            <div className="rounded-xl border border-slate-200 p-3">
              <div className="text-xs font-semibold text-slate-500 mb-1">TUTARLAR</div>
              <div className="flex justify-between"><span>KDV hariç</span><span className="tabular-nums">{tl2(d.draft.totals.net)}</span></div>
              <div className="flex justify-between"><span>KDV</span><span className="tabular-nums">{tl2(d.draft.totals.vat)}</span></div>
              <div className="flex justify-between font-semibold"><span>Toplam</span><span className="tabular-nums">{tl2(d.draft.totals.gross)}</span></div>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-slate-500"><tr><th className="text-left py-1">Ürün</th><th className="text-right">Adet</th><th className="text-right">Birim (KDV hariç)</th><th className="text-right">KDV</th><th className="text-right">Toplam</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {d.draft.lines.map((l, i) => <tr key={i}><td className="py-1">{l.name}<div className="text-[10px] text-slate-400 font-mono">{l.sku}</div></td><td className="text-right">{l.quantity}</td><td className="text-right tabular-nums">{tl2(l.unitNet)}</td><td className="text-right">%{l.vatRate}</td><td className="text-right tabular-nums">{tl2(l.gross)}</td></tr>)}
              </tbody>
            </table>
          </div>

          {inv?.status !== 'issued' && d.provider !== 'none' && (
            <form onSubmit={saveManual} className="rounded-xl border border-dashed border-slate-300 p-3 space-y-2">
              <div className="text-xs text-slate-600">{auto ? 'Faturayı başka yerden kestiyseniz numarasını buraya yazın:' : 'Faturayı kendi programınızda kestikten sonra numarasını yazın; Kervan pazaryerine iletir.'}</div>
              <div className="grid sm:grid-cols-[1fr_auto_auto] gap-2 items-end">
                <Field label="Fatura numarası"><input className={inputClass} required value={number} onChange={(e) => setNumber(e.target.value.toUpperCase())} placeholder="ABC2026000000001" /></Field>
                <label className="inline-flex items-center gap-2 text-xs border border-slate-300 rounded-lg px-3 py-2 cursor-pointer"><Upload className="w-4 h-4" /> {pdf ? 'PDF seçildi' : 'PDF (isteğe bağlı)'}
                  <input type="file" accept="application/pdf" className="hidden" onChange={(e) => pickPdf(e.target.files?.[0])} />
                </label>
                <Button type="submit" loading={busy === 'manual'}>Kaydet ve gönder</Button>
              </div>
            </form>
          )}
        </div>
      )}
    </Modal>
  );
}
