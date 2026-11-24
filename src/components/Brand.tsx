import { BRAND } from '@/lib/brand';

export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="9" fill="#111827" />
      <path d="M11 8v16M22 8l-8.5 8L22 24" fill="none" stroke="#E9C46A" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function BrandName({ light }: { light?: boolean }) {
  return (
    <div className="leading-tight">
      <div className={`font-semibold tracking-tight ${light ? 'text-white' : 'text-slate-900'}`}>{BRAND.name}</div>
      <div className={`text-xs ${light ? 'text-slate-400' : 'text-slate-500'}`}>{BRAND.short}</div>
    </div>
  );
}

/** Panelin içinde: firmanın baş harfiyle logo (ürün logosu yerine) */
export function StoreMark({ name, size = 34 }: { name: string; size?: number }) {
  const letter = (name.trim()[0] ?? 'M').toLocaleUpperCase('tr');
  return (
    <div style={{ width: size, height: size, fontSize: size * 0.45 }} className="shrink-0 rounded-[9px] bg-amber-300 text-slate-900 font-bold grid place-items-center" aria-hidden="true">{letter}</div>
  );
}
