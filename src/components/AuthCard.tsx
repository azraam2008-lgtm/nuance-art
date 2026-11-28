'use client';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { BrandMark, BrandName } from './Brand';

export default function AuthCard({ title, subtitle, children, wide }: { title: string; subtitle?: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-50 via-slate-50 to-indigo-100 p-4">
      <div className={`w-full ${wide ? 'max-w-3xl' : 'max-w-md'} bg-white rounded-2xl shadow-xl ring-1 ring-slate-200/70 p-6 sm:p-8`}>
        <div className="flex items-center gap-3 mb-6"><BrandMark size={40} /><BrandName /></div>
        <h1 className="text-xl font-semibold">{title}</h1>
        {subtitle && <p className="text-sm text-slate-500 mt-1">{subtitle}</p>}
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}

/** Kayıt ve davet formlarında zorunlu onay */
export function TermsCheckbox({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-start gap-2 text-xs text-slate-600">
      <input type="checkbox" className="w-4 h-4 mt-0.5 accent-indigo-600 shrink-0" checked={checked} onChange={(e) => onChange(e.target.checked)} required />
      <span>
        <Link href="/legal/terms" target="_blank" className="text-indigo-600 hover:underline">Kullanım şartlarını</Link> okudum, kabul ediyorum.{' '}
        <Link href="/legal/kvkk" target="_blank" className="text-indigo-600 hover:underline">KVKK aydınlatma metnini</Link> ve{' '}
        <Link href="/legal/privacy" target="_blank" className="text-indigo-600 hover:underline">gizlilik politikasını</Link> okudum.
      </span>
    </label>
  );
}

export function LegalLinks({ className = 'mt-4' }: { className?: string }) {
  return (
    <div className={`flex flex-wrap justify-center gap-x-3 gap-y-1 text-[11px] text-slate-400 ${className}`}>
      <Link href="/legal/terms" className="hover:text-slate-600">Kullanım şartları</Link>
      <Link href="/legal/privacy" className="hover:text-slate-600">Gizlilik</Link>
      <Link href="/legal/kvkk" className="hover:text-slate-600">KVKK aydınlatma</Link>
    </div>
  );
}
