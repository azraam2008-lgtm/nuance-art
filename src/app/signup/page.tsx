'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import AuthCard, { LegalLinks, TermsCheckbox } from '@/components/AuthCard';
import PasswordInput, { passwordChecks } from '@/components/PasswordInput';
import { Button, Field, inputClass } from '@/components/ui';

/** Yeni mağaza hesabı: herkes kendi e-postasıyla kendi ayrı mağazasını açar */
export default function SignupPage() {
  const router = useRouter();
  const [f, setF] = useState({ storeName: '', name: '', email: '' });
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [accept, setAccept] = useState(false);

  useEffect(() => {
    fetch('/api/auth/status').then((r) => r.json()).then((s) => {
      if (s.configError) setError(`Sunucu yapılandırması eksik: ${s.error}`);
      else if (s.user) router.replace('/');
    }).catch(() => {});
  }, [router]);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const bad = passwordChecks(password, f.email).find((c) => !c.ok);
    if (bad) { setError(`Şifre: ${bad.label.toLocaleLowerCase('tr')} olmalı.`); return; }
    if (password !== password2) { setError('Şifreler eşleşmiyor.'); return; }
    if (!accept) { setError('Devam etmek için kullanım şartlarını ve KVKK aydınlatma metnini onaylayın.'); return; }
    setBusy(true); setError(null);
    const r = await fetch('/api/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...f, password, acceptTerms: accept }) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setError(d.error ?? 'Hesap oluşturulamadı.'); return; }
    window.location.href = '/onboarding';
  }

  return (
    <AuthCard title="Mağazanızı oluşturun" subtitle="Ücretsiz hesap açın; ürünlerinizi tüm pazaryerlerinde tek yerden yönetin. Verileriniz yalnızca size görünür.">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Mağaza / marka adı"><input className={inputClass} required value={f.storeName} onChange={set('storeName')} placeholder="Örn. Elif'in Atölyesi" /></Field>
        <Field label="Adınız soyadınız"><input className={inputClass} required autoComplete="name" value={f.name} onChange={set('name')} /></Field>
        <Field label="E-posta (giriş için)"><input className={inputClass} type="email" required autoComplete="email" value={f.email} onChange={set('email')} /></Field>
        <Field label="Şifre"><PasswordInput value={password} onChange={setPassword} autoComplete="new-password" meter email={f.email} /></Field>
        <Field label="Şifre tekrar"><PasswordInput value={password2} onChange={setPassword2} autoComplete="new-password" /></Field>
        <TermsCheckbox checked={accept} onChange={setAccept} />
        {error && <div className="text-sm bg-rose-50 text-rose-700 rounded-lg px-3 py-2">{error}</div>}
        <Button type="submit" loading={busy} className="w-full">Hesabı oluştur <ArrowRight className="w-4 h-4" /></Button>
      </form>
      <p className="text-sm text-slate-600 text-center mt-6">Zaten hesabınız var mı? <Link href="/login" className="text-indigo-600 font-medium hover:underline">Giriş yapın</Link></p>
      <LegalLinks />
    </AuthCard>
  );
}
