'use client';
import { useEffect, useRef, useState } from 'react';
import { Loader2, Search, X } from 'lucide-react';
import { api } from './live';
import { cx, inputClass } from './ui';

interface Option { id: number | string; name: string; path?: string }

/** Pazaryeri kataloğunda arama yapan seçim kutusu (kategori / marka) */
export function SearchPicker({ marketplace, kind, value, label, onChange, placeholder }: {
  marketplace: string; kind: 'categories' | 'brands'; value: { id: number | string; name: string } | null; label?: string;
  onChange: (v: { id: number | string; name: string } | null) => void; placeholder?: string;
}) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState<Option[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (t.current) clearTimeout(t.current);
    if (q.trim().length < 2) { setItems([]); return; }
    t.current = setTimeout(async () => {
      setBusy(true); setErr(null);
      try {
        const r = await api<{ items: Option[]; supported: boolean }>(`/api/marketplaces/${marketplace}/${kind}?q=${encodeURIComponent(q)}`);
        setItems(r.items); setUnsupported(!r.supported); setOpen(true);
      } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
    }, 350);
  }, [q, marketplace, kind]);

  if (value) {
    return (
      <div>
        {label && <span className="text-xs font-medium text-slate-600">{label}</span>}
        <div className="mt-1 flex items-center gap-2 border border-emerald-300 bg-emerald-50 rounded-lg px-3 py-2 text-sm">
          <span className="flex-1 truncate" title={value.name}>{value.name}</span>
          <span className="text-[11px] text-slate-500">#{value.id}</span>
          <button type="button" onClick={() => onChange(null)} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
        </div>
      </div>
    );
  }
  return (
    <div className="relative">
      {label && <span className="text-xs font-medium text-slate-600">{label}</span>}
      <div className="relative mt-1">
        <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
        <input className={`${inputClass} pl-9`} value={q} placeholder={placeholder ?? 'En az 2 harf yazın…'} onChange={(e) => setQ(e.target.value)} onFocus={() => items.length && setOpen(true)} />
        {busy && <Loader2 className="w-4 h-4 absolute right-3 top-2.5 animate-spin text-slate-400" />}
      </div>
      {err && <div className="text-[11px] text-rose-600 mt-1">Liste alınamadı: {err}</div>}
      {open && items.length > 0 && (
        <ul className="absolute z-20 mt-1 w-full max-h-64 overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-lg text-sm">
          {items.map((it) => (
            <li key={String(it.id)}>
              <button type="button" onClick={() => { onChange({ id: it.id, name: it.path ?? it.name }); setOpen(false); setQ(''); }} className="w-full text-left px-3 py-2 hover:bg-indigo-50">
                <div className="truncate">{it.path ?? it.name}</div>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && !busy && q.length >= 2 && items.length === 0 && !err && <div className="text-[11px] text-slate-500 mt-1">{unsupported ? 'Bu pazaryerinde arama yok; numarayı elle yazın.' : 'Sonuç yok. Başka bir kelime deneyin.'}</div>}
    </div>
  );
}

export interface AttrDef { id: number; name: string; required: boolean; allowCustom: boolean; varianter: boolean; values: Array<{ id: number; name: string }> }
export type AttrValue = { valueId?: number; custom?: string };

/** Kategori özellikleri formu (Trendyol onayı için zorunlu alanlar) */
export function AttributesForm({ marketplace, categoryId, value, onChange, onLoaded }: {
  marketplace: string; categoryId: number | string | null; value: Record<number, AttrValue>;
  onChange: (v: Record<number, AttrValue>) => void; onLoaded?: (defs: AttrDef[]) => void;
}) {
  const [defs, setDefs] = useState<AttrDef[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  useEffect(() => {
    if (!categoryId) { setDefs(null); return; }
    setDefs(null); setErr(null);
    api<{ items: AttrDef[] }>(`/api/marketplaces/${marketplace}/attributes?categoryId=${categoryId}`)
      .then((r) => { setDefs(r.items); onLoaded?.(r.items); })
      .catch((e: Error) => setErr(e.message));
  }, [marketplace, categoryId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!categoryId) return null;
  if (err) return <div className="text-xs text-rose-600">Özellikler alınamadı: {err}</div>;
  if (!defs) return <div className="text-xs text-slate-400 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Kategori özellikleri yükleniyor…</div>;
  const shown = showAll ? defs : defs.filter((d) => d.required);
  return (
    <div className="space-y-2">
      <div className="text-xs font-medium text-slate-600">Ürün özellikleri {defs.some((d) => d.required) && <span className="text-rose-600">(* zorunlu)</span>}</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {shown.map((d) => {
          const v = value[d.id] ?? {};
          const set = (nv: AttrValue) => onChange({ ...value, [d.id]: nv });
          return (
            <label key={d.id} className="block text-xs">
              <span className={cx('text-slate-600', d.required && 'font-medium')}>{d.name}{d.required ? ' *' : ''}{d.varianter ? ' (varyant)' : ''}</span>
              {d.values.length > 0 ? (
                <select className={`${inputClass} py-1.5 mt-0.5`} value={v.valueId ?? ''} onChange={(e) => set({ valueId: e.target.value ? Number(e.target.value) : undefined })}>
                  <option value="">Seçin…</option>
                  {d.values.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              ) : (
                <input className={`${inputClass} py-1.5 mt-0.5`} value={v.custom ?? ''} onChange={(e) => set({ custom: e.target.value })} />
              )}
            </label>
          );
        })}
      </div>
      {defs.length > shown.length || showAll ? (
        <button type="button" className="text-xs text-indigo-600" onClick={() => setShowAll((x) => !x)}>{showAll ? 'Yalnızca zorunluları göster' : `İsteğe bağlı ${defs.length - defs.filter((d) => d.required).length} özelliği de göster`}</button>
      ) : null}
    </div>
  );
}

type AttrOut = { attributeId: number; attributeValueId?: number; customAttributeValue?: string };
export function attributesPayload(value: Record<number, AttrValue>): AttrOut[] {
  return Object.entries(value).flatMap(([id, v]): AttrOut[] =>
    v.valueId ? [{ attributeId: Number(id), attributeValueId: v.valueId }] : v.custom?.trim() ? [{ attributeId: Number(id), customAttributeValue: v.custom.trim() }] : []);
}
