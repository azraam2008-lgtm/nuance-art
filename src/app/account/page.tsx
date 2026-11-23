'use client';
import { useEffect, useState } from 'react';
import { FlaskConical, KeyRound, LogOut, Save, ShieldCheck, Store, User } from 'lucide-react';
import { api, useToast } from '@/components/live';
import PasswordInput, { passwordChecks } from '@/components/PasswordInput';
import { Button, Card, ErrorBox, Field, PageLoader, fmtDate, inputClass } from '@/components/ui';

interface Account {
  user: { email: string; name: string; role: string; created_at: string; last_login_at: string | null; password_changed_at: string | null };
  store: { name: string; created_at: string };
  mailConfigured: boolean;
}

export default function AccountPage() {
  const toast = useToast();
  const [data, setData] = useState<Account | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState({ name: '', storeName: '' });
  const [pw, setPw] = useState({ current: '', next: '', next2: '' });
  const [busy, setBusy] = useState<string | null>(null);
  const [demo, setDemo] = useState<boolean | null>(null);
  useEffect(() => { api<{ demo: boolean }>('/api/demo').then((r) => setDemo(r.demo)).catch(() => setDemo(false)); }, []);

  async function toggleDemo(enable: boolean) {
    if (!enable && !window.confirm('Deneme mağazası kapatılacak ve tüm örnek ürün/siparişler silinecek. Devam edilsin mi?')) return;
    setBusy('demo');
    try {
      await api('/api/demo', { method: 'POST', body: { enable } });
      toast(enable ? 'Deneme mağazası açıldı; örnek veriler yüklendi.' : 'Deneme mağazası kapatıldı.');
      window.location.href = enable ? '/' : '/onboarding';
    } catch (e) { toast((e as Error).message, 'err'); setBusy(null); }
  }

  const load = () => api<Account>('/api/account').then((d) => {
    setData(d); setProfile({ name: d.user.name, storeName: d.store.name });
  }).catch((e: Error) => setError(e.message));
  useEffect(() => { load(); }, []);

  async function saveProfile() {
    setBusy('profile');
    try { await api('/api/account', { method: 'PATCH', body: profile }); toast('Bilgileriniz kaydedildi.'); await load(); }
    catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(null); }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    const bad = passwordChecks(pw.next, data?.user.email).find((c) => !c.ok);
    if (bad) { toast(`Yeni şifre: ${bad.label.toLocaleLowerCase('tr')} olmalı.`, 'err'); return; }
    if (pw.next !== pw.next2) { toast('Yeni şifreler eşleşmiyor.', 'err'); return; }
    setBusy('pw');
    try {
      await api('/api/account/password', { method: 'POST', body: { currentPassword: pw.current, newPassword: pw.next } });
      setPw({ current: '', next: '', next2: '' });
      toast('Şifreniz değiştirildi. Diğer cihazlardaki oturumlar kapatıldı.');
      await load();
    } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(null); }
  }

  async function logoutAll() {
    if (!window.confirm('Bu cihaz dahil tüm cihazlardan çıkış yapılacak. Devam edilsin mi?')) return;
    setBusy('all');
    try { await api('/api/account/logout-all', { method: 'POST' }); window.location.href = '/login'; }
    catch (e) { toast((e as Error).message, 'err'); setBusy(null); }
  }

  if (error) return <ErrorBox error={error} onRetry={() => { setError(null); load(); }} />;
  if (!data) return <PageLoader />;

  return (
    <div className="max-w-3xl space-y-6">
      <Card className="p-6 space-y-4">
        <h2 className="font-semibold flex items-center gap-2"><User className="w-4 h-4" /> Hesap bilgileri</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Adınız soyadınız"><input className={inputClass} value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} /></Field>
          <Field label="E-posta (giriş)" hint="E-posta adresi değiştirilemez."><input className={`${inputClass} bg-slate-50`} value={data.user.email} disabled /></Field>
          <div className="sm:col-span-2"><Field label="Mağaza adı"><div className="relative"><Store className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input className={`${inputClass} pl-9`} value={profile.storeName} onChange={(e) => setProfile({ ...profile, storeName: e.target.value })} /></div></Field></div>
        </div>
        <div className="flex justify-end"><Button loading={busy === 'profile'} onClick={saveProfile}><Save className="w-4 h-4" /> Kaydet</Button></div>
      </Card>

      <Card className="p-6">
        <h2 className="font-semibold flex items-center gap-2 mb-1"><KeyRound className="w-4 h-4" /> Şifre değiştir</h2>
        <p className="text-xs text-slate-500 mb-4">Son değişiklik: {data.user.password_changed_at ? fmtDate(data.user.password_changed_at) : 'hiç değiştirilmedi'}. Şifreyi değiştirdiğinizde diğer cihazlardaki oturumlar kapanır{data.mailConfigured ? ' ve size bilgilendirme e-postası gider' : ''}.</p>
        <form onSubmit={changePassword} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2 sm:w-1/2 sm:pr-1.5"><Field label="Mevcut şifre"><PasswordInput value={pw.current} onChange={(v) => setPw({ ...pw, current: v })} /></Field></div>
          <Field label="Yeni şifre"><PasswordInput value={pw.next} onChange={(v) => setPw({ ...pw, next: v })} autoComplete="new-password" meter email={data.user.email} /></Field>
          <Field label="Yeni şifre tekrar"><PasswordInput value={pw.next2} onChange={(v) => setPw({ ...pw, next2: v })} autoComplete="new-password" /></Field>
          <div className="sm:col-span-2 flex justify-end"><Button type="submit" loading={busy === 'pw'}><KeyRound className="w-4 h-4" /> Şifreyi değiştir</Button></div>
        </form>
      </Card>

      <Card className="p-6 space-y-3">
        <h2 className="font-semibold flex items-center gap-2"><FlaskConical className="w-4 h-4" /> Deneme mağazası</h2>
        {demo ? (
          <>
            <p className="text-sm text-slate-600">Deneme mağazası <b>açık</b>. Gördüğünüz ürün ve siparişler örnektir; tüm pazaryerleri simülasyonla çalışır ve hiçbir pazaryerine gerçek istek gitmez. Üst çubuktan &quot;Sipariş simüle et&quot; ile yeni sipariş deneyebilirsiniz.</p>
            <Button variant="secondary" loading={busy === 'demo'} onClick={() => toggleDemo(false)}>Deneme mağazasını kapat (örnek verileri sil)</Button>
          </>
        ) : (
          <>
            <p className="text-sm text-slate-600">Gerçek pazaryeri hesabınız olmadan paneli denemek için örnek ürün ve siparişlerle dolu bir deneme mağazası açın. Hiçbir pazaryerine bağlanmaz; istediğiniz zaman kapatıp gerçek kullanıma geçebilirsiniz. (Mağazada gerçek ürün veya bağlı pazaryeri varsa açılamaz.)</p>
            <Button variant="secondary" loading={busy === 'demo'} disabled={demo === null} onClick={() => toggleDemo(true)}><FlaskConical className="w-4 h-4" /> Deneme mağazasını aç</Button>
          </>
        )}
      </Card>

      <Card className="p-6 space-y-3">
        <h2 className="font-semibold flex items-center gap-2"><ShieldCheck className="w-4 h-4" /> Güvenlik</h2>
        <ul className="text-sm text-slate-600 space-y-1">
          <li>Hesap açılışı: {fmtDate(data.user.created_at)}</li>
          <li>Son giriş: {fmtDate(data.user.last_login_at)}</li>
          <li>Şifreniz geri döndürülemez şekilde (scrypt) saklanır; pazaryeri API anahtarlarınız şifrelenir ve yalnızca sizin mağazanızda kullanılır.</li>
          <li>Art arda 5 hatalı giriş denemesinde hesabınız 15 dakika kilitlenir.</li>
          {!data.mailConfigured && <li className="text-amber-700">"Şifremi unuttum" e-postası henüz ayarlanmadı (site yöneticisi Vercel'e Gmail bilgilerini eklemeli).</li>}
        </ul>
        <Button variant="secondary" loading={busy === 'all'} onClick={logoutAll}><LogOut className="w-4 h-4" /> Tüm cihazlardan çıkış yap</Button>
      </Card>
    </div>
  );
}
