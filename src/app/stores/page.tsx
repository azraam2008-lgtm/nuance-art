'use client';
import { useEffect, useState } from 'react';
import { ArrowRightLeft, Plus, Store } from 'lucide-react';
import { api, useToast } from '@/components/live';
import { StoreMark } from '@/components/Brand';
import { Button, Card, ErrorBox, Field, MarketplaceBadge, PageLoader, cx, inputClass, tl } from '@/components/ui';
import { MARKETPLACE_META, isMarketplace } from '@/lib/marketplaces/meta';
import { ACCENTS } from '@/lib/theme';

interface Summary {
  orders: number; revenue: number; profit: number; products: number; stockUnits: number; outOfStock: number; lowStock: number;
  byMarketplace: Record<string, { orders: number; revenue: number }>;
  connected: Array<{ marketplace: string; accountName: string }>;
}
interface Row { id: string; name: string; role: string; isDemo: boolean; accent: string; accentKey: string; summary: Summary | null }
interface Resp { current: string; stores: Row[]; total: { orders: number; revenue: number; profit: number; stockUnits: number; products: number } }

const ROLE_TR: Record<string, string> = { owner: 'Sahip', admin: 'Yönetici', staff: 'Personel' };
const monthName = new Date().toLocaleDateString('tr-TR', { month: 'long' });

/** Mağazalarım: tüm mağazaların bu ayki cirosu, kârı, siparişi, stoğu + toplam; mağaza değiştir ve yeni mağaza ekle */
export default function StoresPage() {
  const toast = useToast();
  const [d, setD] = useState<Resp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const load = () => api<Resp>('/api/stores?summary=1').then(setD).catch((e) => setError((e as Error).message));
  useEffect(() => { load(); if (new URLSearchParams(window.location.search).get('new') === '1') setNewOpen(true); }, []);

  async function post(body: object, key: string) {
    setBusy(key);
    try { await api('/api/stores', { method: 'POST', body }); window.location.href = '/'; }
    catch (e) { toast((e as Error).message, 'err'); setBusy(null); }
  }

  async function setColor(s: Row, key: string) {
    try {
      await api('/api/stores', { method: 'POST', body: { action: 'theme', storeId: s.id, accent: key } });
      if (s.id === d?.current) window.location.reload(); else load();
    } catch (e) { toast((e as Error).message, 'err'); }
  }

  if (error) return <ErrorBox error={error} onRetry={() => { setError(null); load(); }} />;
  if (!d) return <PageLoader />;
  const many = d.stores.length > 1;
  const label = (m: string, acc: string) => `${isMarketplace(m) ? MARKETPLACE_META[m].label : m}${acc ? ` · ${acc}` : ''}`;

  return (
    <div className="space-y-4 sm:space-y-6 fade-in max-w-5xl">
      <Card className="p-4 text-sm text-slate-600">
        Birbirinden <b>tamamen ayrı</b> işletmeleriniz varsa (ör. biri giyim, biri ev tekstili) her biri için ayrı mağaza açın; ürünleri, stokları, siparişleri ve ayarları ayrı tutulur.
        <b> Aynı ürünleri</b> iki ayrı pazaryeri hesabından satıyorsanız ise mağaza açmanıza gerek yok: API Bağlantıları&apos;nda &quot;ikinci mağaza ekle&quot; ile stok ortak kalır.
      </Card>

      {many && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Card className="p-4"><div className="text-xs text-slate-500">Toplam ciro ({monthName})</div><div className="text-xl font-bold tabular-nums">{tl(d.total.revenue)}</div></Card>
          <Card className="p-4"><div className="text-xs text-slate-500">Toplam net kâr</div><div className={cx('text-xl font-bold tabular-nums', d.total.profit < 0 ? 'text-rose-600' : 'text-emerald-700')}>{tl(d.total.profit)}</div></Card>
          <Card className="p-4"><div className="text-xs text-slate-500">Toplam sipariş</div><div className="text-xl font-bold tabular-nums">{d.total.orders.toLocaleString('tr-TR')}</div></Card>
          <Card className="p-4"><div className="text-xs text-slate-500">Toplam stok</div><div className="text-xl font-bold tabular-nums">{d.total.stockUnits.toLocaleString('tr-TR')} adet</div><div className="text-[11px] text-slate-500">{d.total.products} ürün</div></Card>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        {d.stores.map((s) => {
          const cur = s.id === d.current;
          const x = s.summary;
          return (
            <Card key={s.id} className={cx('p-4 sm:p-5 space-y-3 min-w-0 relative overflow-hidden', cur && 'ring-2 ring-indigo-300')}>
              <div className="absolute inset-x-0 top-0 h-1.5" style={{ background: s.accent }} />
              <div className="flex items-center gap-3">
                <StoreMark name={s.name} size={36} color={s.accent} />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold truncate">{s.name}</div>
                  <div className="text-xs text-slate-500">{ROLE_TR[s.role] ?? s.role}{s.isDemo ? ' · deneme mağazası' : ''}{cur ? ' · şu an açık' : ''}</div>
                </div>
                {!cur && <Button variant="secondary" loading={busy === s.id} onClick={() => post({ action: 'switch', storeId: s.id }, s.id)}><ArrowRightLeft className="w-4 h-4" /> Geç</Button>}
              </div>
              {s.role !== 'staff' && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[11px] text-slate-500 mr-1">Renk:</span>
                  {ACCENTS.map((a) => (
                    <button key={a.key} title={a.label} aria-label={`Renk: ${a.label}`} onClick={() => setColor(s, a.key)}
                      className={cx('w-5 h-5 rounded-full ring-offset-2 transition', s.accentKey === a.key ? 'ring-2 ring-slate-400' : 'hover:scale-110')} style={{ background: a.base }} />
                  ))}
                </div>
              )}
              {!x ? <p className="text-xs text-slate-500">Bu mağazada personel olduğunuz için ciro ve kâr gösterilmiyor.</p> : (
                <>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-lg bg-slate-50 p-2"><div className="text-[11px] text-slate-500">Ciro ({monthName})</div><div className="font-bold tabular-nums">{tl(x.revenue)}</div></div>
                    <div className="rounded-lg bg-slate-50 p-2"><div className="text-[11px] text-slate-500">Net kâr</div><div className={cx('font-bold tabular-nums', x.profit < 0 ? 'text-rose-600' : 'text-emerald-700')}>{tl(x.profit)}</div></div>
                    <div className="rounded-lg bg-slate-50 p-2"><div className="text-[11px] text-slate-500">Sipariş</div><div className="font-bold tabular-nums">{x.orders}</div></div>
                  </div>
                  <div className="text-xs text-slate-600">
                    <b>{x.products}</b> ürün · <b>{x.stockUnits.toLocaleString('tr-TR')}</b> adet stok
                    {x.outOfStock > 0 && <span className="text-rose-600"> · {x.outOfStock} ürünün stoğu bitti</span>}
                    {x.lowStock > 0 && <span className="text-amber-700"> · {x.lowStock} kritik</span>}
                  </div>
                  {Object.keys(x.byMarketplace).length > 0 && (
                    <div className="space-y-1">
                      {Object.entries(x.byMarketplace).sort((a, b) => b[1].revenue - a[1].revenue).map(([m, v]) => (
                        <div key={m} className="flex items-center gap-2 text-xs">
                          {isMarketplace(m) && <MarketplaceBadge name={m} size="xs" />}
                          <span className="truncate flex-1 min-w-0">{label(m, x.connected.find((c) => c.marketplace === m)?.accountName ?? '')}</span>
                          <span className="tabular-nums text-slate-500 whitespace-nowrap">{v.orders} sip.</span>
                          <span className="tabular-nums font-medium w-20 sm:w-24 text-right shrink-0">{tl(v.revenue)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {x.connected.length > 0 ? (
                    <div className="flex flex-wrap gap-1">{x.connected.map((c) => <span key={c.marketplace} className="text-[11px] bg-slate-100 rounded px-1.5 py-0.5">{label(c.marketplace, c.accountName)}</span>)}</div>
                  ) : <p className="text-xs text-amber-700">Henüz pazaryeri bağlı değil.</p>}
                </>
              )}
            </Card>
          );
        })}
      </div>

      <Card className="p-4 sm:p-5">
        {!newOpen ? (
          <Button variant="secondary" onClick={() => setNewOpen(true)}><Plus className="w-4 h-4" /> Yeni mağaza ekle</Button>
        ) : (
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); post({ action: 'create', name }, 'create'); }}>
            <div className="font-medium flex items-center gap-2"><Store className="w-4 h-4" /> Yeni mağaza</div>
            <p className="text-xs text-slate-500">Yeni mağaza boş açılır; pazaryeri bağlantılarını ve ürünlerini ayrıca kurarsınız. Aynı e-posta ve şifreyle girip yan menünün üstünden mağazalar arasında geçebilirsiniz.</p>
            <Field label="Mağaza / marka adı"><input className={inputClass} required value={name} onChange={(e) => setName(e.target.value)} placeholder="Ör. Berezza" maxLength={120} /></Field>
            <div className="flex gap-2"><Button type="submit" loading={busy === 'create'}><Plus className="w-4 h-4" /> Mağazayı aç ve geç</Button><Button type="button" variant="ghost" onClick={() => setNewOpen(false)}>Vazgeç</Button></div>
          </form>
        )}
      </Card>
    </div>
  );
}
