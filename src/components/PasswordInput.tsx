'use client';
import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { cx, inputClass } from './ui';

/** Şifre kuralları (sunucudaki validatePassword ile aynı) — kullanıcıya canlı gösterilir */
export function passwordChecks(pw: string, email = '') {
  const local = email.split('@')[0]?.toLocaleLowerCase('tr') ?? '';
  return [
    { ok: pw.length >= 10, label: 'En az 10 karakter' },
    { ok: /\p{L}/u.test(pw) && /\d/.test(pw), label: 'Harf ve rakam içeriyor' },
    { ok: !(local.length >= 4 && pw.toLocaleLowerCase('tr').includes(local)), label: 'E-posta adınızı içermiyor' },
  ];
}

function strength(pw: string): { score: number; label: string; color: string } {
  let s = 0;
  if (pw.length >= 10) s++;
  if (pw.length >= 14) s++;
  if (/[a-zçğıöşü]/.test(pw) && /[A-ZÇĞİÖŞÜ]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^\p{L}\d]/u.test(pw)) s++;
  if (!pw) return { score: 0, label: '', color: 'bg-slate-200' };
  if (s <= 2) return { score: 1, label: 'Zayıf', color: 'bg-rose-500' };
  if (s === 3) return { score: 2, label: 'Orta', color: 'bg-amber-500' };
  if (s === 4) return { score: 3, label: 'İyi', color: 'bg-emerald-500' };
  return { score: 4, label: 'Çok güçlü', color: 'bg-emerald-600' };
}

/** Göster/gizle düğmeli şifre alanı; meter=true ise güç göstergesi ve kurallar listesi çıkar */
export default function PasswordInput({ value, onChange, autoComplete = 'current-password', meter, email, placeholder }: {
  value: string; onChange: (v: string) => void; autoComplete?: string; meter?: boolean; email?: string; placeholder?: string;
}) {
  const [show, setShow] = useState(false);
  const st = strength(value);
  return (
    <div>
      <div className="relative">
        <input className={cx(inputClass, 'pr-10')} type={show ? 'text' : 'password'} autoComplete={autoComplete} required
          value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
        <button type="button" onClick={() => setShow((x) => !x)} title={show ? 'Şifreyi gizle' : 'Şifreyi göster'}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600">
          {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
      {meter && (
        <div className="mt-2 space-y-1.5">
          <div className="flex gap-1">{[1, 2, 3, 4].map((i) => <div key={i} className={cx('h-1.5 flex-1 rounded', i <= st.score ? st.color : 'bg-slate-200')} />)}</div>
          <ul className="text-[11px] space-y-0.5">
            {passwordChecks(value, email).map((c) => (
              <li key={c.label} className={c.ok ? 'text-emerald-600' : 'text-slate-400'}>{c.ok ? '✓' : '○'} {c.label}</li>
            ))}
            {st.label && <li className="text-slate-500">Güç: <b>{st.label}</b> {st.score < 3 && '— büyük harf, sembol (!?*) ekleyerek ya da uzatarak güçlendirin.'}</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
