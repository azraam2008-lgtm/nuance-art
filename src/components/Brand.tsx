export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="9" fill="#111827" />
      <path d="M9 23V9l14 14V9" fill="none" stroke="#E9C46A" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function BrandName({ light }: { light?: boolean }) {
  return (
    <div className="leading-tight">
      <div className={`font-semibold tracking-tight ${light ? 'text-white' : 'text-slate-900'}`}>Nuance Art</div>
      <div className={`text-xs ${light ? 'text-slate-400' : 'text-slate-500'}`}>Pazaryeri Yönetim Paneli</div>
    </div>
  );
}
