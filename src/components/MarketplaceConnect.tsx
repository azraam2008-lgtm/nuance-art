'use client';
import { useState } from 'react';
import { CheckCircle2, ExternalLink, Link2, Plug, XCircle } from 'lucide-react';
import { MARKETPLACE_META, type MarketplaceName } from '@/lib/marketplaces/meta';
import { GUIDES } from '@/lib/marketplaces/guides';
import { api, useToast } from './live';
import { Button, Field, MarketplaceBadge, cx, fmtDate, inputClass } from './ui';

export interface Cred {
  marketplace: MarketplaceName; apiKey: string; apiSecretMasked: string; hasSecret: boolean; sellerId: string; isActive: boolean;
  extraConfig: Record<string, unknown>; lastTestedAt: string | null; lastTestOk: boolean | null; lastOrderSyncAt: string | null; mode: 'live' | 'demo' | 'off';
}

/**
 * Bir pazaryerini bağlama formu: "anahtarı nereden alırım" adımları, alanlar, bağlantı testi, kaydet.
 * Başlangıç sihirbazında ve Ayarlar > API Bağlantıları'nda kullanılır.
 */
export default function MarketplaceConnect({ cred, onSaved, compact, back = 'settings' }: { cred: Cred; onSaved?: (connected: boolean) => void; compact?: boolean; back?: 'settings' | 'onboarding' }) {
  const toast = useToast();
  const mp = cred.marketplace;
  const meta = MARKETPLACE_META[mp];
  const guide = GUIDES[mp];
  const [apiKey, setApiKey] = useState(cred.apiKey);
  const [apiSecret, setApiSecret] = useState('');
  const [sellerId, setSellerId] = useState(cred.sellerId);
  const [extra, setExtra] = useState<Record<string, string>>(() => Object.fromEntries(guide.extra.map((f) => [f.key, cred.extraConfig?.[f.key] != null ? String(cred.extraConfig[f.key]) : ''])));
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const extraConfig = () => {
    const out: Record<string, unknown> = { ...(cred.extraConfig ?? {}) };
    for (const f of guide.extra) {
      const v = extra[f.key]?.trim();
      if (!v) delete out[f.key];
      else out[f.key] = f.type === 'number' ? Number(v) : v;
    }
    return out;
  };
  const missing = () => {
    if (!apiKey.trim()) return meta.apiKeyLabel;
    if (mp !== 'etsy' && !sellerId.trim()) return meta.sellerIdLabel;
    if (guide.secretRequired && !apiSecret && !cred.hasSecret) return meta.apiSecretLabel;
    const req = guide.extra.find((f) => f.required && !extra[f.key]?.trim());
    return req?.label ?? null;
  };

  async function test() {
    const m = missing();
    if (m) { setResult({ ok: false, message: `"${m}" alanı zorunlu.` }); return; }
    setTesting(true); setResult(null);
    try {
      setResult(await api<{ ok: boolean; message: string }>('/api/credentials/test', { method: 'POST', body: { marketplace: mp, apiKey, apiSecret: apiSecret || undefined, sellerId, extraConfig: extraConfig() } }));
    } catch (e) {
      setResult({ ok: false, message: (e as Error).message });
    } finally {
      setTesting(false);
    }
  }

  async function save(activate: boolean) {
    const m = activate ? missing() : null;
    if (m) { toast(`"${m}" alanı zorunlu.`, 'err'); return; }
    if (activate && result && !result.ok && !window.confirm('Bağlantı testi başarısız oldu. Yine de kaydedip bağlantıyı etkinleştirmek istiyor musunuz?')) return;
    setSaving(true);
    try {
      await api('/api/credentials', { method: 'PUT', body: { marketplace: mp, apiKey, apiSecret: apiSecret || undefined, sellerId, isActive: activate && (mp !== 'etsy' || !!sellerId), extraConfig: extraConfig() } });
      setApiSecret('');
      toast(activate ? `${meta.label} bağlandı.` : `${meta.label} bağlantısı kapatıldı.`);
      onSaved?.(activate);
    } catch (e) {
      toast((e as Error).message, 'err');
    } finally {
      setSaving(false);
    }
  }

  const etsyNeedsOauth = mp === 'etsy' && !cred.extraConfig?.refreshToken;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2"><MarketplaceBadge name={mp} /><span className="text-sm text-slate-500">{guide.panelName}</span></div>
        <span className={cx('text-xs font-medium', cred.mode === 'live' ? 'text-emerald-600' : 'text-slate-400')}>{cred.mode === 'live' ? '● Bağlı' : '○ Bağlı değil'}</span>
      </div>
      {!compact && (
        <div className="bg-slate-50 rounded-lg p-4 text-sm">
          <div className="font-medium mb-2">Bilgileri nereden alırım?</div>
          <ol className="list-decimal pl-5 space-y-1 text-slate-700">{guide.steps.map((s, i) => <li key={i}>{s.replace('<panel adresi>', typeof window !== 'undefined' ? window.location.origin : '')}</li>)}</ol>
          <a href={guide.panelUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-indigo-600 text-xs mt-2 hover:underline">{guide.panelName} sayfasını aç <ExternalLink className="w-3 h-3" /></a>
          {guide.note && <p className="text-xs text-slate-500 mt-2">{guide.note}</p>}
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label={`${meta.apiKeyLabel} *`}><input className={`${inputClass} font-mono`} value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="off" /></Field>
        <Field label={`${meta.apiSecretLabel}${guide.secretRequired ? ' *' : ''}`} hint={cred.hasSecret ? `Kayıtlı: ${cred.apiSecretMasked} — değiştirmek için yeni değer girin.` : undefined}>
          <input type="password" className={`${inputClass} font-mono`} value={apiSecret} onChange={(e) => setApiSecret(e.target.value)} autoComplete="new-password" placeholder={cred.hasSecret ? '••••••••' : ''} />
        </Field>
        <Field label={`${meta.sellerIdLabel}${mp === 'etsy' ? ' (bağlanınca otomatik)' : ' *'}`}><input className={`${inputClass} font-mono`} value={sellerId} onChange={(e) => setSellerId(e.target.value)} /></Field>
        {guide.extra.map((f) => (
          <Field key={f.key} label={`${f.label}${f.required ? ' *' : ''}`} hint={f.help}>
            <input className={inputClass} type={f.type === 'number' ? 'number' : 'text'} placeholder={f.placeholder} value={extra[f.key] ?? ''} onChange={(e) => setExtra((x) => ({ ...x, [f.key]: e.target.value }))} />
          </Field>
        ))}
      </div>
      {result && <div className={cx('text-sm rounded-lg px-3 py-2 flex items-start gap-2', result.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800')}>{result.ok ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" /> : <XCircle className="w-4 h-4 mt-0.5 shrink-0" />}{result.message}</div>}
      <div className="flex flex-wrap gap-2">
        {mp !== 'etsy' && <Button variant="secondary" loading={testing} onClick={test}><Plug className="w-4 h-4" /> Bağlantıyı Test Et</Button>}
        {mp === 'etsy' ? (
          <>
            <Button variant="secondary" loading={saving} onClick={() => save(!!cred.extraConfig?.refreshToken)}>Anahtarları kaydet</Button>
            {cred.apiKey && <a href={`/api/auth/etsy/start?back=${back}`} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium bg-[#F1641E] text-white hover:opacity-90"><Link2 className="w-4 h-4" /> {etsyNeedsOauth ? 'Etsy ile bağlan' : 'Etsy iznini yenile'}</a>}
          </>
        ) : (
          <Button loading={saving} onClick={() => save(true)}>{cred.mode === 'live' ? 'Güncelle' : 'Kaydet ve bağla'}</Button>
        )}
        {cred.mode === 'live' && <Button variant="ghost" onClick={() => save(false)}>Bağlantıyı kapat</Button>}
      </div>
      {!compact && cred.lastTestedAt && <p className="text-[11px] text-slate-400">Son test: {fmtDate(cred.lastTestedAt)} ({cred.lastTestOk ? 'başarılı' : 'başarısız'}) · Son sipariş senkronu: {fmtDate(cred.lastOrderSyncAt)}</p>}
    </div>
  );
}
