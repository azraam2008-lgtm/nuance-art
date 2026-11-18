'use client';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { LogIn } from 'lucide-react';
import AuthCard from '@/components/AuthCard';
import { Button, Field, inputClass } from '@/components/ui';

function LoginForm() {
  const router = useRouter();
  const next = useSearchParams().get('next') || '/';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch('/api/auth/status').then((r) => r.json()).then((s) => {
      if (s.configError) setError(`Sunucu yapılandırması eksik: ${s.error}`);
      else if (!s.hasUser) router.replace('/setup');
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
    window.location.href = next.startsWith('/') ? next : '/';
  }

  return (
    <AuthCard title="Giriş yapın" subtitle="Mağazanızın tüm pazaryerlerini tek yerden yönetin.">
      <form onSubmit={submit} className="space-y-4">
        <Field label="E-posta"><input className={inputClass} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Şifre"><input className={inputClass} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        {error && <div className="text-sm bg-rose-50 text-rose-700 rounded-lg px-3 py-2">{error}</div>}
        <Button type="submit" loading={busy} className="w-full"><LogIn className="w-4 h-4" /> Giriş yap</Button>
      </form>
    </AuthCard>
  );
}

export default function LoginPage() {
  return <Suspense><LoginForm /></Suspense>;
}
