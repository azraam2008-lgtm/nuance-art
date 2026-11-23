'use client';
import { useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Clock, Loader2, RotateCcw, XCircle } from 'lucide-react';
import { api, useLive, useLiveData, useToast } from '@/components/live';
import { Button, Card, Empty, ErrorBox, MarketplaceBadge, PageLoader, cx, fmtDate } from '@/components/ui';

interface Job {
  id: string; kind: 'push_stock' | 'publish' | 'update_product' | 'order_status'; marketplace_name: string; ref_id: string | null;
  payload: { label?: string }; status: 'pending' | 'running' | 'done' | 'failed' | 'cancelled'; attempts: number; max_attempts: number;
  run_at: string; last_error: string | null; updated_at: string; finished_at: string | null;
}
interface Resp { jobs: Job[]; counts: { failed: number; pending: number } }

const KIND: Record<Job['kind'], string> = {
  push_stock: 'Stok gönderimi',
  publish: 'Ürün yayını',
  update_product: 'İçerik güncellemesi',
  order_status: 'Sipariş durumu',
};

const STATUS: Record<Job['status'], { label: string; cls: string }> = {
  pending: { label: 'Tekrar denenecek', cls: 'bg-amber-50 text-amber-700' },
  running: { label: 'Deneniyor', cls: 'bg-indigo-50 text-indigo-700' },
  failed: { label: 'Başarısız', cls: 'bg-rose-50 text-rose-700' },
  done: { label: 'Tamamlandı', cls: 'bg-emerald-50 text-emerald-700' },
  cancelled: { label: 'Yok sayıldı', cls: 'bg-slate-100 text-slate-500' },
};

/** Hatanın ne anlama geldiğini ve ne yapılacağını sade dille söyler */
function hint(err: string | null): string | null {
  if (!err) return null;
  const code = Number(err.match(/HTTP (\d{3})/)?.[1] ?? 0);
  if (code === 401 || code === 403) return 'Pazaryeri anahtarı hatalı veya yetkisi yok. API Bağlantıları sayfasından anahtarları kontrol edin.';
  if (code === 429) return 'Pazaryeri çok fazla istek aldı; sistem biraz bekleyip kendisi tekrar deneyecek.';
  if (code >= 500 || /bağlantı|zaman aşımı/i.test(err)) return 'Pazaryeri o an yanıt vermedi; sistem kendisi tekrar deneyecek.';
  if (code === 400 || code === 422) return 'Pazaryeri bilgiyi kabul etmedi (eksik/yanlış alan). Ürünü düzeltip "Tekrar dene"ye basın.';
  return null;
}

export default function OperationsPage() {
  const toast = useToast();
  const { bump } = useLive();
  const [view, setView] = useState<'open' | 'done'>('open');
  const { data, error, loading, reload } = useLiveData<Resp>(`/api/jobs?view=${view}`);
  const [busy, setBusy] = useState<string | null>(null);

  async function act(action: 'retry' | 'retry_all' | 'cancel', id?: string) {
    setBusy(id ?? action);
    try {
      const r = await api<{ result?: { processed: number; ok: number; failed: number } }>('/api/jobs', { method: 'POST', body: { action, id } });
      if (action === 'cancel') toast('İşlem yok sayıldı.');
      else if (r.result) toast(r.result.failed ? `${r.result.ok} işlem başarılı, ${r.result.failed} işlem yine gönderilemedi.` : `${r.result.ok} işlem başarıyla gönderildi.`, r.result.failed ? 'warn' : 'ok');
      reload(); bump();
    } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(null); }
  }

  const link = (j: Job) => j.ref_id ? (j.kind === 'order_status' ? '/orders' : `/products/${j.ref_id}`) : null;

  return (
    <div className="space-y-4 fade-in max-w-5xl">
      <Card className="p-4 text-sm text-slate-600">
        Bir pazaryerine stok, ürün veya sipariş durumu gönderilemezse burada görünür. Geçici hatalar (pazaryeri o an yanıt vermedi vb.)
        <b> otomatik olarak tekrar denenir</b>: 1, 5, 15 dakika, 1, 3 ve 6 saat sonra. Düzeltilmesi gereken hatalar "Başarısız" olarak kalır.
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex bg-white border border-slate-200 rounded-lg p-0.5 text-sm">
          <button onClick={() => setView('open')} className={cx('px-3 py-1.5 rounded-md', view === 'open' && 'bg-slate-800 text-white')}>
            Bekleyen {data && view === 'open' ? `(${(data.counts?.failed ?? 0) + (data.counts?.pending ?? 0)})` : ''}
          </button>
          <button onClick={() => setView('done')} className={cx('px-3 py-1.5 rounded-md', view === 'done' && 'bg-slate-800 text-white')}>Tamamlanan</button>
        </div>
        {data && view === 'open' && ((data.counts?.failed ?? 0) > 0 || (data.counts?.pending ?? 0) > 0) && (
          <Button className="ml-auto" loading={busy === 'retry_all'} onClick={() => act('retry_all')}><RotateCcw className="w-4 h-4" /> Hepsini şimdi tekrar dene</Button>
        )}
      </div>

      {loading ? <PageLoader /> : error || !data ? <ErrorBox error={error ?? ''} onRetry={reload} /> : !data.jobs?.length ? (
        <Card><Empty>{view === 'open' ? <span className="inline-flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-600" /> Bekleyen işlem yok — tüm pazaryerleri güncel.</span> : 'Henüz kayıt yok.'}</Empty></Card>
      ) : (
        <div className="space-y-2">
          {data.jobs.map((j) => {
            const st = STATUS[j.status];
            const h = hint(j.last_error);
            const href = link(j);
            return (
              <Card key={j.id} className="p-3 sm:p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <MarketplaceBadge name={j.marketplace_name} />
                  <span className="font-medium text-sm">{KIND[j.kind]}</span>
                  {j.payload?.label && (href ? <Link href={href} className="text-sm text-indigo-600 hover:underline">{j.payload.label}</Link> : <span className="text-sm">{j.payload.label}</span>)}
                  <span className={cx('ml-auto text-xs rounded-full px-2 py-0.5 inline-flex items-center gap-1', st.cls)}>
                    {j.status === 'running' ? <Loader2 className="w-3 h-3 animate-spin" /> : j.status === 'failed' ? <XCircle className="w-3 h-3" /> : j.status === 'pending' ? <Clock className="w-3 h-3" /> : null}
                    {st.label}
                  </span>
                </div>
                {j.last_error && j.status !== 'done' && <div className="text-xs text-rose-700 mt-2 break-words">{j.last_error}</div>}
                {h && j.status !== 'done' && <div className="text-xs text-slate-600 mt-1">💡 {h}</div>}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-[11px] text-slate-500">
                  <span>{j.attempts} deneme</span>
                  {j.status === 'pending' && <span>Sonraki deneme: {fmtDate(j.run_at)}</span>}
                  <span>Son güncelleme: {fmtDate(j.finished_at ?? j.updated_at)}</span>
                  {(j.status === 'failed' || j.status === 'pending') && (
                    <span className="ml-auto flex gap-1">
                      <Button variant="secondary" className="text-xs px-2 py-1" loading={busy === j.id} onClick={() => act('retry', j.id)}><RotateCcw className="w-3.5 h-3.5" /> Tekrar dene</Button>
                      <Button variant="ghost" className="text-xs px-2 py-1" onClick={() => act('cancel', j.id)}>Yok say</Button>
                    </span>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
