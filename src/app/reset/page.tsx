'use client';
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { KeyRound } from 'lucide-react';
import AuthCard from '@/components/AuthCard';
import PasswordInput, { passwordChecks } from '@/components/PasswordInput';
import { Button, Field, PageLoader } from '@/components/ui';

function ResetForm() {
  const token = useSearchParams().get('token') ?? '';
  const [valid, setValid] = useState<boolean | null>(null);
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/auth/reset?token=${encodeURIComponent(token)}`).then(async (r) => {
      const d = await r.json().catch(() => ({}));
      setValid(r.ok);
      if (!r.ok) setError(d.error ?? 'Bağlantı geçersiz.');
    }).catch(() => setValid(false));
  }, [token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const bad = passwordChecks(password).find((c) => !c.ok);
    if (bad) { setError(`Şifre: ${bad.label.toLocaleLowerCase('tr')} olmalı.`); return; }
    if (password !== password2) { setError('Şifreler eşleşmiyor.'); return; }
    setBusy(true); setError(null);
    const r = await fetch('/api/auth/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, password }) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setError(d.error ?? 'Şifre değiştirilemedi.'); return; }
    window.location.href = '/';
  }

  return (
    <AuthCard title="Yeni şifre oluşturun" subtitle="Yeni şifrenizi kaydettiğinizde diğer tüm cihazlardaki oturumlar kapatılır.">
      {valid === null ? <PageLoader /> : !valid ? (
        <div className="space-y-4">
          <div className="text-sm bg-rose-50 text-rose-700 rounded-lg px-3 py-2">{error}</div>
          <Link href="/forgot" className="text-sm text-indigo-600 hover:underline">Yeni bağlantı iste →</Link>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Field label="Yeni şifre"><PasswordInput value={password} onChange={setPassword} autoComplete="new-password" meter /></Field>
          <Field label="Yeni şifre tekrar"><PasswordInput value={password2} onChange={setPassword2} autoComplete="new-password" /></Field>
          {error && <div className="text-sm bg-rose-50 text-rose-700 rounded-lg px-3 py-2">{error}</div>}
          <Button type="submit" loading={busy} className="w-full"><KeyRound className="w-4 h-4" /> Şifreyi kaydet ve giriş yap</Button>
        </form>
      )}
    </AuthCard>
  );
}

export default function ResetPage() {
  return <Suspense><ResetForm /></Suspense>;
}
