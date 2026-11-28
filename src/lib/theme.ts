// Mağaza renkleri: her mağazanın kendi vurgu rengi var (düğmeler, seçili menü, rozetler).
// Panelde "indigo" olarak yazılan bütün sınıflar bu renge döner (tailwind.config → CSS değişkenleri).

export interface AccentPreset { key: string; label: string; base: string }

/** Sakin, göz yormayan ve herkese hitap eden tonlar */
export const ACCENTS: AccentPreset[] = [
  { key: 'deniz', label: 'Deniz', base: '#3F6FB5' },
  { key: 'adacayi', label: 'Adaçayı', base: '#4F8A6E' },
  { key: 'petrol', label: 'Petrol', base: '#2F7F86' },
  { key: 'gece', label: 'Gece mavisi', base: '#4B55A8' },
  { key: 'lavanta', label: 'Lavanta', base: '#7461B0' },
  { key: 'kiremit', label: 'Kiremit', base: '#B3613F' },
  { key: 'hardal', label: 'Hardal', base: '#A87B26' },
  { key: 'murdum', label: 'Mürdüm', base: '#8E4C79' },
];
export const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;

const hexToRgb = (h: string) => { const n = parseInt(h.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const mix = (a: number[], b: number[], t: number) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

/** Ana tondan (600) 50–950 arası tam bir renk skalası üretir: "r g b" */
export function scale(base: string): Record<number, string> {
  const c = hexToRgb(base);
  const white = [255, 255, 255]; const black = [12, 14, 22];
  const toWhite: Record<number, number> = { 50: 0.94, 100: 0.87, 200: 0.74, 300: 0.57, 400: 0.36, 500: 0.16, 600: 0 };
  const toBlack: Record<number, number> = { 700: 0.18, 800: 0.36, 900: 0.52, 950: 0.68 };
  const out: Record<number, string> = {};
  for (const s of SHADES) out[s] = (s <= 600 ? mix(c, white, toWhite[s]) : mix(c, black, toBlack[s])).join(' ');
  return out;
}

/** Seçilmemişse mağazaya kimliğinden sabit bir renk düşer: iki mağaza kendiliğinden farklı renkte olur */
export function accentFor(storeId: string, chosen?: string | null): AccentPreset {
  const picked = ACCENTS.find((a) => a.key === chosen);
  if (picked) return picked;
  let h = 0;
  for (const ch of storeId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return ACCENTS[h % ACCENTS.length];
}

/** Sayfaya uygulanacak CSS değişkenleri */
export function accentVars(base: string): Record<string, string> {
  const s = scale(base);
  return Object.fromEntries(SHADES.map((k) => [`--accent-${k}`, s[k]]));
}
