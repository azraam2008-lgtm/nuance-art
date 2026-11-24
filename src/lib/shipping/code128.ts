// Code 128 (B kümesi) barkod: kargo takip numarasını kargocunun okutabileceği çizgilere çevirir.
// Saf fonksiyon; tarayıcıda SVG olarak çizilir.

// 0–106 arası sembollerin çizgi/boşluk genişlikleri (standart tablo)
const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];
const START_B = 104;
const STOP = 106;

/** Barkoda çevrilebilir mi? (Code 128 B: boşluk dahil ASCII 32–126) */
export const encodable = (text: string) => text.length > 0 && text.length <= 60 && /^[\x20-\x7e]+$/.test(text);

/** Sembol değerleri: başlangıç + veri + kontrol + bitiş */
export function code128Values(text: string): number[] {
  if (!encodable(text)) throw new Error('Barkoda çevrilemeyen karakter var.');
  const data = [...text].map((c) => c.charCodeAt(0) - 32);
  const check = (START_B + data.reduce((s, v, i) => s + v * (i + 1), 0)) % 103;
  return [START_B, ...data, check, STOP];
}

/** Modül genişlikleri dizisi: çift indeksler çizgi, tek indeksler boşluk */
export function code128Widths(text: string): number[] {
  return code128Values(text).flatMap((v) => [...PATTERNS[v]].map(Number));
}

/** Çözücü (test için): genişliklerden metni geri üretir ve kontrol hanesini doğrular */
export function decodeCode128(widths: number[]): string {
  const syms: number[] = [];
  for (let i = 0; i < widths.length - 7; i += 6) syms.push(PATTERNS.indexOf(widths.slice(i, i + 6).join('')));
  if (syms[0] !== START_B) throw new Error('başlangıç yok');
  const data = syms.slice(1);
  const check = data.pop()!;
  if ((START_B + data.reduce((s, v, i) => s + v * (i + 1), 0)) % 103 !== check) throw new Error('kontrol hanesi hatalı');
  return String.fromCharCode(...data.map((v) => v + 32));
}
