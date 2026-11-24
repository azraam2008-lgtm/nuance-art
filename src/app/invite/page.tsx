'use client';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import AuthCard, { LegalLinks, TermsCheckbox } from '@/components/AuthCard';
import PasswordInput, { passwordChecks } from '@/components/PasswordInput';
import { Button, Field, inputClass } from '@/components/ui';

const ROLE_TR: Record<string, string> = { admin: 'Yönetici', staff: 'Personel' };

/** Ekip daveti: davet edilen kişi adını ve şifresini belirleyip mağazaya katılır */
function InviteForm() {
  const token = useSearchParams().get('token') ?? '';
  const [info, setInfo] = useState<{ email: string; role: string; storeName: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [accept, setAccept] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/auth/invite?token=${encodeURIComponent(token)}`).then(async (r) => {
      const d = await r.json().catch(() => ({}));
      if (r.ok) setInfo(d); else setError(d.error ?? 'Davet bulunamadı.');
    }).catch(() => setError('Bağlantı kurulamadı.'));
  }, [token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const bad = passwordChecks(password, info?.email ?? '').find((c) => !c.ok);
    if (bad) { setError(`Şifre: ${bad.label.toLocaleLowerCase('tr')} olmalı.`); return; }
    if (password !== password2) { setError('Şifreler eşleşmiyor.'); return; }
    if (!accept) { setError('Devam etmek için kullanım şartlarını ve KVKK aydınlatma metnini onaylayın.'); return; }
    setBusy(true); setError(null);
    const r = await fetch('/api/auth/invite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, name, password, acceptTerms: accept }) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setError(d.error ?? 'Katılım tamamlanamadı.'); return; }
    window.location.href = '/';
  }

  if (!info) {
    return (
      <AuthCard title="Ekip daveti">
        {error ? <div className="text-sm bg-rose-50 text-rose-700 rounded-lg px-3 py-2">{error}</div> : <div className="text-sm text-slate-500">Davet kontrol ediliyor…</div>}
      </AuthCard>
    );
  }
  return (
    <AuthCard title={`${info.storeName} ekibine katılın`} subtitle={`"${ROLE_TR[info.role] ?? info.role}" olarak davet edildiniz. Adınızı ve şifrenizi belirleyin.`}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="E-posta (giriş için)"><input className={`${inputClass} bg-slate-50`} value={info.email} disabled /></Field>
        <Field label="Adınız soyadınız"><input className={inputClass} required autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Şifre"><PasswordInput value={password} onChange={setPassword} autoComplete="new-password" meter email={info.email} /></Field>
        <Field label="Şifre tekrar"><PasswordInput value={password2} onChange={setPassword2} autoComplete="new-password" /></Field>
        <TermsCheckbox checked={accept} onChange={setAccept} />
        {error && <div className="text-sm bg-rose-50 text-rose-700 rounded-lg px-3 py-2">{error}</div>}
        <Button type="submit" loading={busy} className="w-full">Ekibe katıl <ArrowRight className="w-4 h-4" /></Button>
      </form>
      <LegalLinks />
    </AuthCard>
  );
}

export default function InvitePage() {
  return <Suspense fallback={null}><InviteForm /></Suspense>;
}
