/**
 * Pazaryeri PDF/Excel'inden yapıştırılan kargo tarifesini desi → fiyat dizisine çevirir.
 * Satır başına: "desi;fiyat", "desi fiyat", "desi<TAB>fiyat", "Dosya;fiyat" veya yalnızca "fiyat" (0. desiden sırayla).
 * Türkçe ondalık (88,96 / 1.234,56) desteklenir. Aradaki boş desiler bir önceki fiyatla doldurulur.
 */
export function parseRateText(text: string): number[] {
  const toNum = (x: string) => {
    const t = x.replace(/[^\d.,-]/g, '');
    return Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
  };
  const pairs: Array<[number, number]> = [];
  let seq = 0;
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.trim();
    if (!l) continue;
    const parts = l.split(/[;\t]|\s+/).map((x) => x.trim()).filter(Boolean);
    if (parts.length >= 2 && /^\d+$/.test(parts[0])) pairs.push([Number(parts[0]), toNum(parts[1])]);
    else if (parts.length >= 2 && /^dosya$/i.test(parts[0])) pairs.push([0, toNum(parts[1])]);
    else if (parts.length === 1) pairs.push([seq++, toNum(parts[0])]);
  }
  if (!pairs.length || pairs.some(([, v]) => !Number.isFinite(v) || v < 0)) throw new Error('Tarife okunamadı. Her satıra "desi;fiyat" yazın.');
  const max = Math.max(...pairs.map(([d]) => d));
  if (max > 2000) throw new Error("Desi 2000'den büyük olamaz.");
  const out: number[] = new Array(max + 1).fill(NaN);
  for (const [d, v] of pairs) out[d] = v;
  if (Number.isNaN(out[0])) out[0] = out.find((v) => !Number.isNaN(v)) ?? 0;
  for (let i = 1; i <= max; i++) if (Number.isNaN(out[i])) out[i] = out[i - 1];
  return out.map((v) => Math.round(v * 100) / 100);
}
