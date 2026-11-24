'use client';
import { useEffect, useState } from 'react';
import { Bell, Copy, History, Send, Trash2, UserPlus, Users } from 'lucide-react';
import { api, useToast } from '@/components/live';
import { Button, Card, Field, fmtDate, inputClass } from '@/components/ui';

type Role = 'owner' | 'admin' | 'staff';
interface Member { id: string; name: string; email: string; role: Role; created_at: string; last_login_at: string | null }
interface Invite { id: string; email: string; role: Role; expires_at: string }
interface Log { id: number; user_name: string; action: string; detail: string; created_at: string }
interface Team { me: string; myRole: Role; members: Member[]; invites: Invite[]; log: Log[]; mailConfigured: boolean }

const ROLE_TR: Record<Role, string> = { owner: 'Sahip', admin: 'Yönetici', staff: 'Personel' };
const ROLE_HELP: Record<'admin' | 'staff', string> = {
  admin: 'Her şeyi görür ve yönetir (API anahtarları, fiyat, kâr). Ekibi yalnızca sahip yönetir.',
  staff: 'Ürün, stok ve siparişlerle çalışır. Maliyet, kâr, fiyat ve API anahtarlarını göremez, fiyat değiştiremez.',
};

/** Hesabım → Ekip: üyeler, davet bağlantısı, roller ve "kim ne yaptı" kaydı */
export default function TeamSection() {
  const toast = useToast();
  const [t, setT] = useState<Team | null>(null);
  const [inv, setInv] = useState<{ email: string; role: 'admin' | 'staff' }>({ email: '', role: 'staff' });
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => api<Team>('/api/team').then(setT).catch((e) => toast((e as Error).message, 'err'));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function post(body: object, ok?: string) {
    setBusy(true);
    try {
      const r = await api<{ link?: string; mailed?: boolean }>('/api/team', { method: 'POST', body });
      if (r.link) { setLink(r.link); setInv({ ...inv, email: '' }); toast(r.mailed ? 'Davet e-postası gönderildi. Bağlantıyı ayrıca da paylaşabilirsiniz.' : 'Davet bağlantısı oluşturuldu. Kopyalayıp kişiye gönderin.'); }
      else if (ok) toast(ok);
      load();
    } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
  }

  if (!t) return null;
  const owner = t.myRole === 'owner';
  return (
    <>
      <Card className="p-4 sm:p-6 space-y-4">
        <h2 className="font-semibold flex items-center gap-2"><Users className="w-4 h-4" /> Ekip</h2>
        <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl">
          {t.members.map((m) => (
            <div key={m.id} className="p-3 flex flex-wrap items-center gap-x-3 gap-y-2">
              <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 grid place-items-center text-sm font-semibold shrink-0">{m.name.slice(0, 1).toUpperCase()}</div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">{m.name}{m.id === t.me && <span className="text-xs text-slate-400"> (siz)</span>}</div>
                <div className="text-xs text-slate-500 truncate">{m.email} · son giriş {fmtDate(m.last_login_at)}</div>
              </div>
              {owner && m.role !== 'owner' ? (
                <div className="flex items-center gap-1">
                  <select className="text-sm border border-slate-300 rounded-lg px-2 py-1.5 bg-white" value={m.role} disabled={busy}
                    onChange={(e) => post({ action: 'role', userId: m.id, role: e.target.value }, 'Rol değişti. Kişi yeniden giriş yapmalı.')}>
                    <option value="admin">Yönetici</option><option value="staff">Personel</option>
                  </select>
                  <button title="Ekipten çıkar" className="p-1.5 text-slate-400 hover:text-rose-600" disabled={busy}
                    onClick={() => window.confirm(`${m.name} ekipten çıkarılsın mı? Hesabı silinir ve panele giremez.`) && post({ action: 'remove', userId: m.id }, 'Ekipten çıkarıldı.')}><Trash2 className="w-4 h-4" /></button>
                </div>
              ) : <span className="text-xs rounded-full bg-slate-100 px-2.5 py-1">{ROLE_TR[m.role]}</span>}
            </div>
          ))}
          {t.invites.map((i) => (
            <div key={i.id} className="p-3 flex flex-wrap items-center gap-3 bg-amber-50/50">
              <div className="min-w-0 flex-1"><div className="text-sm truncate">{i.email}</div><div className="text-xs text-amber-700">Davet bekliyor · {ROLE_TR[i.role]} · {fmtDate(i.expires_at)} tarihine kadar</div></div>
              <Button variant="ghost" className="text-xs" onClick={() => post({ action: 'revoke', id: i.id }, 'Davet iptal edildi.')}>İptal et</Button>
            </div>
          ))}
        </div>

        {owner && (
          <form className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-2 items-end" onSubmit={(e) => { e.preventDefault(); post({ action: 'invite', ...inv }); }}>
            <Field label="Davet edilecek kişinin e-postası"><input className={inputClass} type="email" required value={inv.email} onChange={(e) => setInv({ ...inv, email: e.target.value })} placeholder="ornek@gmail.com" /></Field>
            <Field label="Rol">
              <select className={inputClass} value={inv.role} onChange={(e) => setInv({ ...inv, role: e.target.value as 'admin' | 'staff' })}>
                <option value="staff">Personel</option><option value="admin">Yönetici</option>
              </select>
            </Field>
            <Button type="submit" loading={busy}><UserPlus className="w-4 h-4" /> Davet et</Button>
            <p className="sm:col-span-3 text-xs text-slate-500"><b>{ROLE_TR[inv.role]}:</b> {ROLE_HELP[inv.role]}</p>
          </form>
        )}
        {link && (
          <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-3 space-y-2">
            <div className="text-sm">Bu bağlantıyı davet ettiğiniz kişiye WhatsApp veya e-postayla gönderin (7 gün geçerli, tek kullanımlık):</div>
            <div className="flex gap-2">
              <input readOnly className={`${inputClass} bg-white font-mono text-xs`} value={link} onFocus={(e) => e.target.select()} />
              <Button variant="secondary" onClick={() => { navigator.clipboard?.writeText(link); toast('Bağlantı kopyalandı.'); }}><Copy className="w-4 h-4" /> Kopyala</Button>
            </div>
          </div>
        )}
      </Card>

      {t.myRole !== 'staff' && t.log.length > 0 && (
        <Card className="p-4 sm:p-6 space-y-3">
          <h2 className="font-semibold flex items-center gap-2"><History className="w-4 h-4" /> Son işlemler (kim ne yaptı)</h2>
          <div className="max-h-80 overflow-y-auto divide-y divide-slate-100 text-sm">
            {t.log.map((l) => (
              <div key={l.id} className="py-2 flex flex-wrap gap-x-2">
                <span className="text-xs text-slate-400 w-32 shrink-0">{fmtDate(l.created_at)}</span>
                <span className="font-medium">{l.user_name}</span>
                <span>{l.action}</span>
                {l.detail && <span className="text-slate-500 w-full sm:w-auto sm:flex-1 break-words">{l.detail}</span>}
              </div>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}

interface Notify { enabled: boolean; mailConfigured: boolean; settings: { email: string; newOrder: boolean; stockOut: boolean; lateOrders: boolean; syncFailed: boolean; dailySummary: boolean } }
const NOTIFY_LABELS: Array<[keyof Notify['settings'], string]> = [
  ['newOrder', 'Yeni sipariş geldiğinde'], ['stockOut', 'Bir ürünün stoğu bittiğinde'], ['lateOrders', 'Kargo süresi geçen sipariş olduğunda'],
  ['syncFailed', 'Pazaryerine gönderilemeyen işlem olduğunda'], ['dailySummary', 'Her sabah dünün özeti (sipariş, ciro, kâr, stok)'],
];

/** Hesabım → Bildirimler */
export function NotifySection() {
  const toast = useToast();
  const [n, setN] = useState<Notify | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { api<Notify>('/api/notifications').then(setN).catch(() => {}); }, []);
  if (!n) return null;
  const s = n.settings;
  async function save(test: boolean) {
    setBusy(test ? 'test' : 'save');
    try {
      await api('/api/notifications', { method: 'PUT', body: { ...s, test } });
      setN({ ...n!, enabled: true });
      toast(test ? 'Kaydedildi ve deneme e-postası gönderildi.' : 'Bildirim ayarları kaydedildi.');
    } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(null); }
  }
  return (
    <Card className="p-4 sm:p-6 space-y-3">
      <h2 className="font-semibold flex items-center gap-2"><Bell className="w-4 h-4" /> E-posta bildirimleri</h2>
      {!n.mailConfigured && <p className="text-sm rounded-lg bg-amber-50 text-amber-800 px-3 py-2">E-posta gönderimi henüz ayarlanmadı. Site yöneticisi Vercel&apos;e Gmail bilgilerini (GMAIL_USER, GMAIL_APP_PASSWORD) eklediğinde bildirimler gelmeye başlar. Ayarları şimdiden kaydedebilirsiniz.</p>}
      {!n.enabled && <p className="text-sm text-slate-600">Bildirimler kapalı. Aşağıdan seçip <b>Kaydet</b>&apos;e basınca açılır. Aynı anda olan olaylar tek e-postada toplanır.</p>}
      <Field label="Bildirimlerin gideceği e-posta"><input className={inputClass} type="email" value={s.email} onChange={(e) => setN({ ...n, settings: { ...s, email: e.target.value } })} /></Field>
      <div className="grid sm:grid-cols-2 gap-2">
        {NOTIFY_LABELS.map(([k, label]) => (
          <label key={k} className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="w-4 h-4 accent-indigo-600" checked={!!s[k]} onChange={(e) => setN({ ...n, settings: { ...s, [k]: e.target.checked } })} /> {label}
          </label>
        ))}
      </div>
      <div className="flex flex-wrap gap-2 justify-end">
        <Button variant="secondary" loading={busy === 'test'} disabled={!n.mailConfigured} onClick={() => save(true)}><Send className="w-4 h-4" /> Kaydet ve deneme gönder</Button>
        <Button loading={busy === 'save'} onClick={() => save(false)}>Kaydet</Button>
      </div>
    </Card>
  );
}
