'use client';
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { LogIn } from 'lucide-react';
import AuthCard, { LegalLinks } from '@/components/AuthCard';
import PasswordInput from '@/components/PasswordInput';
import { Button, Field, inputClass } from '@/components/ui';

function LoginForm() {
  const router = useRouter();
  const sp = useSearchParams();
  const next = sp.get('next') || '/';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch('/api/auth/status').then((r) => r.json()).then((s) => {
      if (s.configError) setError(`Sunucu yapılandırması eksik: ${s.error}`);
      else if (s.user) router.replace(next);
    }).catch(() => {});
  }, [router, next]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setError(d.error ?? 'Giriş başarısız.'); return; }
    window.location.href = next.startsWith('/') && !next.startsWith('//') ? next : '/';
  }

  return (
    <AuthCard title="Giriş yapın" subtitle="Mağazanızın tüm pazaryerlerini tek yerden yönetin.">
      <form onSubmit={submit} className="space-y-4">
        <Field label="E-posta"><input className={inputClass} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <div>
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-600">Şifre</span>
            <Link href="/forgot" className="text-xs text-indigo-600 hover:underline">Şifremi unuttum</Link>
          </div>
          <div className="mt-1"><PasswordInput value={password} onChange={setPassword} /></div>
        </div>
        {error && <div className="text-sm bg-rose-50 text-rose-700 rounded-lg px-3 py-2">{error}</div>}
        <Button type="submit" loading={busy} className="w-full"><LogIn className="w-4 h-4" /> Giriş yap</Button>
      </form>
      <p className="text-sm text-slate-600 text-center mt-6">Hesabınız yok mu? <Link href="/signup" className="text-indigo-600 font-medium hover:underline">Ücretsiz hesap oluşturun</Link></p>
      <p className="text-xs text-slate-500 text-center mt-2"><Link href="/welcome" className="hover:underline">Panel neler yapıyor? Tanıtımı görün</Link></p>
      <LegalLinks />
    </AuthCard>
  );
}

export default function LoginPage() {
  return <Suspense><LoginForm /></Suspense>;
}
