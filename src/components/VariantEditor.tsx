'use client';
import { Plus, Trash2, Wand2 } from 'lucide-react';
import { Button, Field, cx, inputClass } from './ui';

/**
 * Ürün seçenekleri (varyantlar): ör. Koku = Vanilya, Lavanta · Boy = Küçük, Büyük.
 * Her seçenek kombinasyonu kendi SKU'su, barkodu, stoğu ve (isteğe bağlı) fiyatıyla ayrı satıştır;
 * pazaryerinde ana ürün kodu altında tek ilan olarak görünür.
 */
export interface VariantOption { name: string; values: string }
export interface VariantRow { key: string; attrs: Record<string, string>; sku: string; barcode: string; stock: string; price: string }
export interface VariantState { enabled: boolean; options: VariantOption[]; rows: VariantRow[] }

export const EMPTY_VARIANTS: VariantState = { enabled: false, options: [{ name: '', values: '' }], rows: [] };
const SUGGEST = ['Renk', 'Koku', 'Beden', 'Boyut', 'Model', 'Desen'];

const splitValues = (s: string) => [...new Set(s.split(',').map((x) => x.trim()).filter(Boolean))];
const slug = (s: string) => s.toLocaleUpperCase('tr-TR').replace(/Ç/g, 'C').replace(/Ğ/g, 'G').replace(/İ/g, 'I').replace(/Ö/g, 'O').replace(/Ş/g, 'S').replace(/Ü/g, 'U').replace(/[^A-Z0-9]/g, '').slice(0, 6);

/** Seçenek tanımlarından tüm kombinasyonları üretir; daha önce girilmiş satırların bilgilerini korur */
export function buildRows(options: VariantOption[], prev: VariantRow[], baseSku: string): VariantRow[] {
  const opts = options.map((o) => ({ name: o.name.trim(), values: splitValues(o.values) })).filter((o) => o.name && o.values.length);
  if (!opts.length) return [];
  let combos: Array<Record<string, string>> = [{}];
  for (const o of opts) combos = combos.flatMap((c) => o.values.map((v) => ({ ...c, [o.name]: v })));
  return combos.slice(0, 100).map((attrs) => {
    const key = opts.map((o) => `${o.name}=${attrs[o.name]}`).join('|');
    const old = prev.find((r) => r.key === key);
    return old ?? { key, attrs, sku: `${baseSku || 'URUN'}-${opts.map((o) => slug(attrs[o.name])).join('-')}`, barcode: '', stock: '', price: '' };
  });
}

export const variantLabel = (attrs: Record<string, string>) => Object.values(attrs).join(' / ');

/** 1. adım: "Bu ürünün seçenekleri var mı?" ve seçenek adları/değerleri */
export function VariantOptionsEditor({ value, onChange, baseSku }: { value: VariantState; onChange: (v: VariantState) => void; baseSku: string }) {
  const setOptions = (options: VariantOption[]) => onChange({ ...value, options, rows: buildRows(options, value.rows, baseSku) });
  return (
    <div className="rounded-xl border border-slate-200 p-4 space-y-3">
      <label className="flex items-start gap-2 cursor-pointer">
        <input type="checkbox" className="w-4 h-4 mt-0.5 accent-indigo-600" checked={value.enabled}
          onChange={(e) => onChange({ ...value, enabled: e.target.checked, rows: e.target.checked ? buildRows(value.options, value.rows, baseSku) : value.rows })} />
        <span>
          <span className="font-medium text-sm">Bu ürünün seçenekleri var</span>
          <span className="block text-xs text-slate-500">Ör. renk, koku veya beden. Her seçeneğin kendi stoğu ve barkodu olur; pazaryerinde tek ilan altında seçenek olarak görünür.</span>
        </span>
      </label>
      {value.enabled && (
        <div className="space-y-2">
          {value.options.map((o, i) => (
            <div key={i} className="grid grid-cols-1 sm:grid-cols-[180px_1fr_auto] gap-2 items-end">
              <Field label={`${i + 1}. seçenek adı`}>
                <input className={inputClass} list="variant-names" value={o.name} placeholder="Renk"
                  onChange={(e) => setOptions(value.options.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              </Field>
              <Field label="Değerler (virgülle ayırın)">
                <input className={inputClass} value={o.values} placeholder="Kırmızı, Mavi, Yeşil"
                  onChange={(e) => setOptions(value.options.map((x, j) => (j === i ? { ...x, values: e.target.value } : x)))} />
              </Field>
              {value.options.length > 1 && (
                <button type="button" title="Kaldır" onClick={() => setOptions(value.options.filter((_, j) => j !== i))} className="p-2 mb-0.5 text-slate-400 hover:text-rose-600"><Trash2 className="w-4 h-4" /></button>
              )}
            </div>
          ))}
          <datalist id="variant-names">{SUGGEST.map((s) => <option key={s} value={s} />)}</datalist>
          {value.options.length < 2 && (
            <button type="button" onClick={() => setOptions([...value.options, { name: '', values: '' }])} className="text-xs text-indigo-600 inline-flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> İkinci seçenek ekle (ör. Renk + Beden)</button>
          )}
          <p className="text-xs text-slate-500">{value.rows.length ? `${value.rows.length} seçenek oluşacak: ${value.rows.slice(0, 6).map((r) => variantLabel(r.attrs)).join(', ')}${value.rows.length > 6 ? '…' : ''}. Stok ve barkodları 3. adımda gireceksiniz.` : 'Seçenek adını ve en az iki değer yazın.'}</p>
        </div>
      )}
    </div>
  );
}

function makeBarcode() {
  const d = [2, ...Array.from({ length: 11 }, () => Math.floor(Math.random() * 10))];
  const sum = d.reduce((s, x, i) => s + x * (i % 2 ? 3 : 1), 0);
  return d.join('') + ((10 - (sum % 10)) % 10);
}

/** 3. adım: her seçeneğin SKU, barkod, stok ve fiyatı */
export function VariantRowsEditor({ value, onChange, basePrice }: { value: VariantState; onChange: (v: VariantState) => void; basePrice: string }) {
  const setRow = (key: string, patch: Partial<VariantRow>) => onChange({ ...value, rows: value.rows.map((r) => (r.key === key ? { ...r, ...patch } : r)) });
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-sm font-medium">Seçenekler ({value.rows.length})</div>
        <Button variant="secondary" className="ml-auto text-xs" onClick={() => onChange({ ...value, rows: value.rows.map((r) => (r.barcode ? r : { ...r, barcode: makeBarcode() })) })}>
          <Wand2 className="w-3.5 h-3.5" /> Boş barkodları oluştur
        </Button>
      </div>
      <div className="space-y-2">
        {value.rows.map((r) => (
          <div key={r.key} className="rounded-lg border border-slate-200 p-3 grid grid-cols-2 sm:grid-cols-[1.2fr_1.2fr_1.3fr_0.7fr_0.8fr] gap-2 items-end">
            <div className="col-span-2 sm:col-span-1 font-medium text-sm self-center">{variantLabel(r.attrs)}</div>
            <Field label="SKU"><input className={cx(inputClass, 'font-mono text-xs')} value={r.sku} onChange={(e) => setRow(r.key, { sku: e.target.value.trim() })} /></Field>
            <Field label="Barkod"><input className={cx(inputClass, 'font-mono text-xs')} value={r.barcode} onChange={(e) => setRow(r.key, { barcode: e.target.value.trim() })} /></Field>
            <Field label="Stok"><input className={inputClass} inputMode="numeric" value={r.stock} onChange={(e) => setRow(r.key, { stock: e.target.value.replace(/\D/g, '') })} /></Field>
            <Field label="Fiyat"><input className={inputClass} inputMode="decimal" value={r.price} placeholder={basePrice || 'ortak'} onChange={(e) => setRow(r.key, { price: e.target.value })} /></Field>
          </div>
        ))}
      </div>
      <p className="text-xs text-slate-500">Fiyatı boş bırakılan seçenek ortak satış fiyatıyla satılır. Her seçeneğin stoğu ayrı tutulur; bir seçenek satılınca yalnızca onun stoğu düşer.</p>
    </div>
  );
}

/** Seçenek satırlarının doğrulaması (3. adım) */
export function variantProblems(v: VariantState): string[] {
  if (!v.enabled) return [];
  const out: string[] = [];
  if (v.rows.length < 2) out.push('En az iki seçenek tanımlayın (1. adım).');
  const skus = new Set<string>(); const codes = new Set<string>();
  for (const r of v.rows) {
    const l = variantLabel(r.attrs);
    if (!r.sku) out.push(`${l}: SKU girin.`);
    if (!/^[0-9A-Za-z-]{4,64}$/.test(r.barcode)) out.push(`${l}: barkod girin (veya "Boş barkodları oluştur").`);
    if (r.stock === '' || !Number.isInteger(Number(r.stock))) out.push(`${l}: stok girin.`);
    if (r.price && !(Number(r.price.replace(',', '.')) > 0)) out.push(`${l}: fiyat geçersiz.`);
    if (skus.has(r.sku)) out.push(`${l}: SKU başka bir seçenekle aynı.`);
    if (r.barcode && codes.has(r.barcode)) out.push(`${l}: barkod başka bir seçenekle aynı.`);
    skus.add(r.sku); codes.add(r.barcode);
  }
  return out;
}
