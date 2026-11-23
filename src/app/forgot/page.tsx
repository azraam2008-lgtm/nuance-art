'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Mail } from 'lucide-react';
import AuthCard from '@/components/AuthCard';
import { Button, Field, inputClass } from '@/components/ui';

export default function ForgotPage() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const r = await fetch('/api/auth/forgot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setError(d.error ?? 'Bir hata oluştu.'); return; }
    setSent(d.message);
  }

  return (
    <AuthCard title="Şifremi unuttum" subtitle="Hesabınızın e-posta adresini yazın; yeni şifre oluşturmanız için bir bağlantı gönderelim.">
      {sent ? (
        <div className="space-y-4">
          <div className="text-sm bg-emerald-50 text-emerald-800 rounded-lg px-3 py-3 flex gap-2"><Mail className="w-4 h-4 mt-0.5 shrink-0" />{sent}</div>
          <p className="text-xs text-slate-500">Bağlantı 1 saat geçerlidir. E-posta birkaç dakika içinde gelmezse tekrar deneyebilirsiniz.</p>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Field label="E-posta"><input className={inputClass} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          {error && <div className="text-sm bg-rose-50 text-rose-700 rounded-lg px-3 py-2">{error}</div>}
          <Button type="submit" loading={busy} className="w-full"><Mail className="w-4 h-4" /> Sıfırlama bağlantısı gönder</Button>
        </form>
      )}
      <p className="text-sm text-slate-600 text-center mt-6"><Link href="/login" className="text-indigo-600 hover:underline">← Girişe dön</Link></p>
    </AuthCard>
  );
}
