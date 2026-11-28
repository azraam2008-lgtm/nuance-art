'use client';
import { X, Loader2 } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { useMarketplaceShortName } from './useMarketplaces';
import { MARKETPLACE_META, ORDER_STATUS_META, isMarketplace, isSecondAccount, mixHex, type OrderStatus } from '@/lib/marketplaces/meta';

export const tl = (n: number) => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 0 }).format(n || 0);
export const tl2 = (n: number) => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(n || 0);
export const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
export const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ');

export function MarketplaceBadge({ name, size = 'sm' }: { name: string; size?: 'sm' | 'xs' }) {
  const shortName = useMarketplaceShortName();
  if (!isMarketplace(name)) return <span className="text-xs text-slate-500">{name}</span>;
  const m = MARKETPLACE_META[name];
  const label = shortName(name);
  const second = isSecondAccount(name);
  // Yumuşak zemin + koyu yazı; ikinci mağaza kesik çerçeveyle ayrılır
  return (
    <span title={label === m.label ? undefined : `${m.label} — ${label}`} className={cx('inline-flex items-center rounded-md font-semibold whitespace-nowrap max-w-[160px] truncate', size === 'xs' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-[11px]')}
      style={{ background: mixHex(m.chart, '#FFFFFF', 0.84), color: mixHex(m.chart, '#11131A', 0.35), boxShadow: `inset 0 0 0 1px ${mixHex(m.chart, '#FFFFFF', second ? 0.2 : 0.6)}`, ...(second ? { outline: `1px dashed ${m.chart}`, outlineOffset: '-3px' } : {}) }}>
      {label}
    </span>
  );
}

export function StatusBadge({ status }: { status: OrderStatus }) {
  const s = ORDER_STATUS_META[status];
  return <span className={cx('inline-flex px-2 py-0.5 rounded-full text-xs font-medium', s.className)}>{s.label}</span>;
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('bg-white rounded-xl border border-slate-200', className)}>{children}</div>;
}

export function Button({
  children, onClick, variant = 'primary', type = 'button', disabled, loading, className, title,
}: {
  children: ReactNode; onClick?: () => void; variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  type?: 'button' | 'submit'; disabled?: boolean; loading?: boolean; className?: string; title?: string;
}) {
  const styles = {
    primary: 'bg-indigo-600 hover:bg-indigo-700 text-white',
    secondary: 'bg-white border border-slate-300 hover:bg-slate-50 text-slate-700',
    danger: 'bg-rose-600 hover:bg-rose-700 text-white',
    ghost: 'text-slate-600 hover:bg-slate-100',
  }[variant];
  return (
    <button type={type} title={title} onClick={onClick} disabled={disabled || loading}
      className={cx('inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed', styles, className)}>
      {loading && <Loader2 className="w-4 h-4 animate-spin" />}
      {children}
    </button>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/40 sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={cx('bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full max-h-[92vh] overflow-y-auto fade-in', wide ? 'sm:max-w-3xl' : 'sm:max-w-xl')}>
        <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-4 border-b border-slate-100 sticky top-0 bg-white z-10">
          <h2 className="text-base sm:text-lg font-semibold min-w-0">{title}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600" aria-label="Kapat"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-4 sm:p-6">{children}</div>
      </div>
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="text-[11px] text-slate-400">{hint}</span>}
    </label>
  );
}

export const inputClass = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500';

export function Empty({ children }: { children: ReactNode }) {
  return <div className="p-10 text-center text-sm text-slate-500">{children}</div>;
}

export function PageLoader() {
  return <div className="flex items-center justify-center py-24 text-slate-400"><Loader2 className="w-6 h-6 animate-spin" /></div>;
}

export function ErrorBox({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div className="bg-rose-50 border border-rose-200 text-rose-800 rounded-xl p-4 text-sm">
      <b>Veri yüklenemedi:</b> {error}
      {error.includes('SUPABASE') || error.includes('ortam değişken') ? (
        <div className="mt-1 text-rose-700">.env.local dosyasını oluşturup Supabase anahtarlarını girdiğinizden ve schema.sql'i çalıştırdığınızdan emin olun.</div>
      ) : null}
      {onRetry && <button onClick={onRetry} className="ml-2 underline">Tekrar dene</button>}
    </div>
  );
}
