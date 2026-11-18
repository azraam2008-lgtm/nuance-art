'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import AuthCard from '@/components/AuthCard';
import { Button, Field, inputClass } from '@/components/ui';

/** İlk açılış: yönetici hesabı oluşturma (yalnızca hiç kullanıcı yokken) */
export default function SetupPage() {
  const router = useRouter();
  const [f, setF] = useState({ companyName: '', name: '', email: '', password: '', password2: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch('/api/auth/status').then((r) => r.json()).then((s) => {
      if (s.configError) setError(`Sunucu yapılandırması eksik: ${s.error}. README'deki kurulum adımlarını kontrol edin.`);
      else if (s.hasUser) router.replace('/login');
    }).catch(() => {});
  }, [router]);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (f.password !== f.password2) { setError('Şifreler eşleşmiyor.'); return; }
    setBusy(true); setError(null);
    const r = await fetch('/api/auth/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setError(d.error ?? 'Hesap oluşturulamadı.'); return; }
    window.location.href = '/onboarding';
  }

  return (
    <AuthCard title="Hoş geldiniz 👋" subtitle="Başlamadan önce yönetici hesabınızı oluşturalım. Ardından pazaryeri bağlantılarınızı adım adım kuracağız.">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Mağaza / firma adı"><input className={inputClass} required value={f.companyName} onChange={set('companyName')} placeholder="Nuance Art" /></Field>
        <Field label="Adınız soyadınız"><input className={inputClass} required value={f.name} onChange={set('name')} /></Field>
        <Field label="E-posta (giriş için)"><input className={inputClass} type="email" required autoComplete="email" value={f.email} onChange={set('email')} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Şifre (en az 8 karakter)"><input className={inputClass} type="password" required minLength={8} autoComplete="new-password" value={f.password} onChange={set('password')} /></Field>
          <Field label="Şifre tekrar"><input className={inputClass} type="password" required minLength={8} autoComplete="new-password" value={f.password2} onChange={set('password2')} /></Field>
        </div>
        {error && <div className="text-sm bg-rose-50 text-rose-700 rounded-lg px-3 py-2">{error}</div>}
        <Button type="submit" loading={busy} className="w-full">Hesabı oluştur ve devam et <ArrowRight className="w-4 h-4" /></Button>
      </form>
    </AuthCard>
  );
}
