'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Check, ChevronsUpDown, LayoutGrid, Plus } from 'lucide-react';
import { StoreMark } from './Brand';
import { BRAND } from '@/lib/brand';

interface Store { id: string; name: string; role: string; isDemo: boolean }

/** Yan menünün üstü: mağaza adı; tıklayınca diğer mağazalara geçiş, yeni mağaza ekleme ve toplu özet */
export default function StoreSwitcher({ name }: { name: string }) {
  const [open, setOpen] = useState(false);
  const [stores, setStores] = useState<{ current: string; stores: Store[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open || stores) return;
    fetch('/api/stores').then((r) => r.json()).then(setStores).catch(() => {});
  }, [open, stores]);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  async function go(id: string) {
    setBusy(id);
    const r = await fetch('/api/stores', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'switch', storeId: id }) });
    if (r.ok) window.location.href = '/';
    else setBusy(null);
  }

  return (
    <div ref={ref} className="relative min-w-0 flex-1">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-3 text-left rounded-lg hover:bg-slate-800 -m-1 p-1" aria-haspopup="menu" aria-expanded={open}>
        <StoreMark name={name} size={34} />
        <div className="leading-tight min-w-0 flex-1">
          <div className="text-white font-semibold truncate">{name}</div>
          <div className="text-[11px] text-slate-500 truncate">{BRAND.name} ile yönetiliyor</div>
        </div>
        <ChevronsUpDown className="w-4 h-4 text-slate-500 shrink-0" />
      </button>
      {open && (
        <div role="menu" className="absolute z-50 left-0 right-0 mt-2 rounded-xl bg-white text-slate-800 shadow-2xl ring-1 ring-slate-200 overflow-hidden">
          <div className="px-3 pt-2.5 pb-1 text-[11px] font-semibold text-slate-400">MAĞAZALARIM</div>
          {!stores ? <div className="px-3 py-2 text-sm text-slate-400">Yükleniyor…</div> : stores.stores.map((s) => (
            <button key={s.id} disabled={s.id === stores.current || !!busy} onClick={() => go(s.id)}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-slate-50 disabled:cursor-default">
              <StoreMark name={s.name} size={22} />
              <span className="truncate flex-1">{s.name}{s.isDemo && <span className="text-[10px] text-amber-600"> (deneme)</span>}</span>
              {s.id === stores.current ? <Check className="w-4 h-4 text-indigo-600" /> : busy === s.id ? <span className="text-[11px] text-slate-400">geçiliyor…</span> : null}
            </button>
          ))}
          <div className="border-t border-slate-100">
            <Link href="/stores" onClick={() => setOpen(false)} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50"><LayoutGrid className="w-4 h-4 text-slate-500" /> Tüm mağazalarım (özet)</Link>
            <Link href="/stores?new=1" onClick={() => setOpen(false)} className="flex items-center gap-2 px-3 py-2 text-sm text-indigo-700 hover:bg-indigo-50"><Plus className="w-4 h-4" /> Yeni mağaza ekle</Link>
          </div>
        </div>
      )}
    </div>
  );
}
