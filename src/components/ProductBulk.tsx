'use client';
import { useRef, useState } from 'react';
import { AlertTriangle, Download, FileSpreadsheet, Upload } from 'lucide-react';
import { api, useLive, useToast } from './live';
import { Button, Field, Modal, cx, inputClass, tl2 } from './ui';

/* ------------------------------------------------------------------ *
 * Toplu fiyat güncelleme: önce önizleme (yeni fiyatlar + zarar uyarıları), sonra uygula
 * ------------------------------------------------------------------ */
type Plan = Array<{ id: string; sku: string; from: number; to: number }>;
type Warn = Array<{ productId: string; sku: string; label: string; netProfit: number; margin: number; minMargin: number | null }>;

export function BulkPriceModal({ ids, onClose }: { ids: string[] | null; onClose: () => void }) {
  const toast = useToast();
  const { bump } = useLive();
  const [mode, setMode] = useState<'percent' | 'add' | 'set'>('percent');
  const [value, setValue] = useState('');
  const [round, setRound] = useState(true);
  const [preview, setPreview] = useState<{ plan: Plan; warnings: Warn } | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(dryRun: boolean) {
    if (!ids) return;
    setBusy(true);
    try {
      const r = await api<{ plan: Plan; warnings: Warn; sync?: Record<string, { ok: boolean; message: string }> }>('/api/products/bulk-price', { method: 'POST', body: { ids, mode, value, round, dryRun } });
      if (dryRun) { setPreview(r); return; }
      const fails = Object.entries(r.sync ?? {}).filter(([, x]) => !x.ok);
      toast(fails.length ? `${r.plan.length} ürünün fiyatı güncellendi; bazı pazaryerlerine gönderilemedi (İşlem Merkezi'nde).` : `${r.plan.length} ürünün fiyatı güncellendi ve pazaryerlerine gönderildi.`, fails.length ? 'warn' : 'ok');
      bump(); setPreview(null); setValue(''); onClose();
    } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
  }

  return (
    <Modal open={!!ids} onClose={() => { setPreview(null); onClose(); }} title={`Toplu fiyat güncelle (${ids?.length ?? 0} ürün)`} wide>
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Nasıl?">
            <select className={inputClass} value={mode} onChange={(e) => { setMode(e.target.value as typeof mode); setPreview(null); }}>
              <option value="percent">Yüzde artır / azalt</option>
              <option value="add">Tutar ekle / çıkar (₺)</option>
              <option value="set">Hepsine aynı fiyat (₺)</option>
            </select>
          </Field>
          <Field label={mode === 'percent' ? 'Yüzde (azaltmak için eksi: -10)' : mode === 'add' ? 'Tutar (azaltmak için eksi)' : 'Yeni fiyat (KDV dahil)'}>
            <input className={inputClass} inputMode="decimal" value={value} onChange={(e) => { setValue(e.target.value); setPreview(null); }} placeholder={mode === 'percent' ? '10' : '25'} />
          </Field>
          <label className="flex items-center gap-2 text-sm sm:pt-6"><input type="checkbox" className="accent-indigo-600" checked={round} onChange={(e) => { setRound(e.target.checked); setPreview(null); }} /> ,90 ile bitir (ör. 349,90)</label>
        </div>
        <p className="text-xs text-slate-500">Ortak satış fiyatı değişir ve tüm aktif ilanlara gönderilir. Bir pazaryerine özel fiyat girdiyseniz o pazaryeri kendi fiyatını korur.</p>
        {preview && (
          <div className="space-y-3">
            {preview.warnings.length > 0 && (
              <div className="rounded-lg bg-rose-50 border border-rose-200 p-3 text-sm text-rose-800">
                <div className="font-medium flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> {preview.warnings.length} ilan bu fiyatla zarar ediyor veya hedef marjın altında kalıyor:</div>
                <ul className="mt-1 text-xs space-y-0.5 max-h-28 overflow-y-auto">
                  {preview.warnings.map((w, i) => <li key={i}>{w.sku} · {w.label}: {w.netProfit < 0 ? `zarar ${tl2(w.netProfit)}` : `marj %${(w.margin * 100).toFixed(1)} (hedef %${w.minMargin})`}</li>)}
                </ul>
              </div>
            )}
            <div className="max-h-56 overflow-y-auto border border-slate-200 rounded-lg">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500 sticky top-0"><tr><th className="text-left px-3 py-1.5">SKU</th><th className="text-right px-3">Şimdi</th><th className="text-right px-3">Yeni</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {preview.plan.map((p) => (
                    <tr key={p.id} className={cx(preview.warnings.some((w) => w.productId === p.id) && 'bg-rose-50/60')}>
                      <td className="px-3 py-1.5 font-mono text-xs">{p.sku}</td><td className="px-3 text-right tabular-nums">{tl2(p.from)}</td>
                      <td className={cx('px-3 text-right tabular-nums font-medium', p.to > p.from ? 'text-emerald-700' : p.to < p.from ? 'text-rose-700' : '')}>{tl2(p.to)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => { setPreview(null); onClose(); }}>Vazgeç</Button>
          {!preview
            ? <Button loading={busy} disabled={!value} onClick={() => run(true)}>Önizle</Button>
            : <Button loading={busy} variant={preview.warnings.length ? 'danger' : 'primary'} onClick={() => run(false)}>{preview.warnings.length ? 'Uyarıya rağmen uygula' : 'Uygula ve gönder'}</Button>}
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ *
 * Excel / CSV'den toplu ürün yükleme
 * ------------------------------------------------------------------ */
const COLUMNS: Array<{ key: string; label: string; aliases: string[] }> = [
  { key: 'title', label: 'Ürün adı', aliases: ['ürün adı', 'urun adi', 'ad', 'başlık', 'baslik', 'title', 'name'] },
  { key: 'sku', label: 'SKU', aliases: ['sku', 'stok kodu', 'stokkodu', 'model kodu'] },
  { key: 'barcode', label: 'Barkod', aliases: ['barkod', 'barcode', 'ean'] },
  { key: 'price', label: 'Satış fiyatı', aliases: ['satış fiyatı', 'satis fiyati', 'fiyat', 'price'] },
  { key: 'cost', label: 'Maliyet', aliases: ['maliyet', 'alış fiyatı', 'alis fiyati', 'cost'] },
  { key: 'stock', label: 'Stok', aliases: ['stok', 'adet', 'stock', 'quantity'] },
  { key: 'category', label: 'Kategori', aliases: ['kategori', 'category'] },
  { key: 'brand', label: 'Marka', aliases: ['marka', 'brand'] },
  { key: 'description', label: 'Açıklama', aliases: ['açıklama', 'aciklama', 'description'] },
  { key: 'vat', label: 'KDV', aliases: ['kdv', 'kdv oranı', 'vat'] },
  { key: 'desi', label: 'Desi', aliases: ['desi'] },
  { key: 'group', label: 'Ana ürün kodu', aliases: ['ana ürün kodu', 'ana urun kodu', 'grup', 'group'] },
  { key: 'variant', label: 'Seçenek', aliases: ['seçenek', 'secenek', 'varyant', 'variant'] },
];

/** Basit CSV okuyucu: ; veya , ayraç, tırnaklı alanlar, satır içi yeni satır */
function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, '');
  const first = clean.split(/\r?\n/)[0] ?? '';
  const sep = (first.match(/;/g)?.length ?? 0) >= (first.match(/,/g)?.length ?? 0) ? ';' : first.includes('\t') ? '\t' : ',';
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let q = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (q) {
      if (ch === '"' && clean[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && clean[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

const TEMPLATE = [COLUMNS.map((c) => c.label).join(';'),
  'El Yapımı Soya Mum 200 g;MUM-220-VAN;2123456789012;349,90;110;12;Ev Dekorasyon;Atölyem;Doğal soya mumu, pamuk fitil.;20;1;MUM-220;Koku: Vanilya',
  'El Yapımı Soya Mum 200 g;MUM-220-LAV;2123456789029;349,90;110;8;Ev Dekorasyon;Atölyem;Doğal soya mumu, pamuk fitil.;20;1;MUM-220;Koku: Lavanta',
  'Makrome Duvar Süsü;MAK-001;;499,90;160;3;Ev Dekorasyon;Atölyem;%100 pamuk ip.;20;2;;'].join('\r\n');

export function CsvImportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const { bump } = useLive();
  const input = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Array<Record<string, string>> | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [result, setResult] = useState<{ added: number; results: Array<{ line: number; sku: string; ok: boolean; message: string }> } | null>(null);
  const [busy, setBusy] = useState(false);

  function downloadTemplate() {
    const blob = new Blob(['﻿' + TEMPLATE], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'urun-sablonu.csv'; a.click(); URL.revokeObjectURL(a.href);
  }

  async function onFile(f: File) {
    setResult(null);
    if (/\.xlsx?$/i.test(f.name)) { toast('Excel dosyasını önce "Farklı Kaydet → CSV (noktalı virgülle ayrılmış)" olarak kaydedip onu seçin.', 'warn'); return; }
    const table = parseCsv(await f.text());
    if (table.length < 2) { toast('Dosyada başlık satırı ve en az bir ürün olmalı.', 'err'); return; }
    const head = table[0].map((h) => h.trim().toLocaleLowerCase('tr-TR'));
    const idx: Record<string, number> = {};
    for (const c of COLUMNS) { const i = head.findIndex((h) => c.aliases.includes(h)); if (i >= 0) idx[c.key] = i; }
    setMissing(['title', 'sku', 'price'].filter((k) => idx[k] === undefined).map((k) => COLUMNS.find((c) => c.key === k)!.label));
    setRows(table.slice(1).map((r) => Object.fromEntries(Object.entries(idx).map(([k, i]) => [k, (r[i] ?? '').trim()]))));
  }

  async function importRows() {
    if (!rows) return;
    setBusy(true);
    try {
      const r = await api<NonNullable<typeof result>>('/api/products/bulk-import', { method: 'POST', body: { rows } });
      setResult(r);
      toast(`${r.added} ürün eklendi.${r.results.some((x) => !x.ok) ? ' Bazı satırlar atlandı; listeye bakın.' : ''}`, r.results.some((x) => !x.ok) ? 'warn' : 'ok');
      bump();
    } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
  }

  const close = () => { setRows(null); setResult(null); setMissing([]); onClose(); };
  return (
    <Modal open={open} onClose={close} title="Excel / CSV'den toplu ürün yükle" wide>
      <div className="space-y-4 text-sm">
        <ol className="list-decimal pl-5 space-y-1 text-slate-600">
          <li><button type="button" onClick={downloadTemplate} className="text-indigo-600 underline inline-flex items-center gap-1"><Download className="w-3.5 h-3.5" /> Örnek şablonu indirin</button> ve Excel&apos;de açın.</li>
          <li>Ürünlerinizi doldurun (Ürün adı, SKU ve Satış fiyatı zorunlu). Seçenekli ürünlerde aynı &quot;Ana ürün kodu&quot;nu yazın, &quot;Seçenek&quot;e ör. <code>Renk: Kırmızı</code>.</li>
          <li>Excel&apos;de <b>Dosya → Farklı Kaydet → CSV (noktalı virgülle ayrılmış)</b> seçip kaydedin ve aşağıdan seçin.</li>
        </ol>
        <input ref={input} type="file" accept=".csv,text/csv,.txt,.xlsx,.xls" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        <Button variant="secondary" onClick={() => input.current?.click()}><Upload className="w-4 h-4" /> Dosya seç</Button>
        {missing.length > 0 && <div className="rounded-lg bg-rose-50 text-rose-800 p-3">Şu sütunlar bulunamadı: <b>{missing.join(', ')}</b>. Başlık satırını şablondaki gibi yazın.</div>}
        {rows && !result && (
          <>
            <div className="text-slate-600">{rows.length} satır okundu. Ürünler stok havuzuna eklenir; fotoğraf ve pazaryeri kategorisini ürün sayfasından ekleyip yayınlarsınız.</div>
            <div className="max-h-56 overflow-auto border border-slate-200 rounded-lg">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-500 sticky top-0"><tr>{['Ürün adı', 'SKU', 'Fiyat', 'Maliyet', 'Stok', 'Seçenek'].map((h) => <th key={h} className="text-left px-2 py-1.5">{h}</th>)}</tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.slice(0, 100).map((r, i) => <tr key={i}><td className="px-2 py-1 max-w-[200px] truncate">{r.title}</td><td className="px-2 font-mono">{r.sku}</td><td className="px-2">{r.price}</td><td className="px-2">{r.cost}</td><td className="px-2">{r.stock}</td><td className="px-2">{r.variant}</td></tr>)}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={close}>Vazgeç</Button>
              <Button loading={busy} disabled={missing.length > 0} onClick={importRows}><FileSpreadsheet className="w-4 h-4" /> {rows.length} ürünü ekle</Button>
            </div>
          </>
        )}
        {result && (
          <>
            <div className="font-medium">{result.added} ürün eklendi.</div>
            {result.results.some((x) => !x.ok) && (
              <ul className="max-h-48 overflow-y-auto text-xs space-y-0.5 bg-amber-50 rounded-lg p-3 text-amber-900">
                {result.results.filter((x) => !x.ok).map((x, i) => <li key={i}>{x.line}. satır ({x.sku || '—'}): {x.message}</li>)}
              </ul>
            )}
            <div className="flex justify-end"><Button onClick={close}>Kapat</Button></div>
          </>
        )}
      </div>
    </Modal>
  );
}
