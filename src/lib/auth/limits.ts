import 'server-only';
import { rawDb } from '@/lib/supabase/server';

/**
 * Kaba kuvvet koruması. Denemeler veritabanında tutulur; böylece Vercel'in birden fazla
 * sunucu örneği arasında da geçerlidir (bellek içi sayaç her örnekte sıfırdan başlardı).
 */
export type AttemptKind = 'login' | 'reset' | 'signup';

const RULES: Record<AttemptKind, { windowMin: number; perKey: number; perIp: number; failuresOnly: boolean }> = {
  login: { windowMin: 15, perKey: 5, perIp: 30, failuresOnly: true },   // aynı e-postaya 15 dk'da 5 hatalı deneme
  reset: { windowMin: 60, perKey: 3, perIp: 10, failuresOnly: false },  // saatte 3 şifre sıfırlama maili
  signup: { windowMin: 60, perKey: 3, perIp: 10, failuresOnly: false },
};

export async function checkLimit(kind: AttemptKind, key: string, ip: string): Promise<string | null> {
  const rule = RULES[kind];
  const since = new Date(Date.now() - rule.windowMin * 60_000).toISOString();
  const count = async (k: string) => {
    let q = rawDb().from('auth_attempts').select('id', { count: 'exact', head: true }).eq('kind', kind).eq('key', k).gte('created_at', since);
    if (rule.failuresOnly) q = q.eq('ok', false);
    const { count: c, error } = await q;
    if (error) throw new Error(error.message || 'Deneme sayacı okunamadı.');
    return c ?? 0;
  };
  const [byKey, byIp] = await Promise.all([count(key), count(`ip:${ip}`)]);
  if (byKey >= rule.perKey || byIp >= rule.perIp) {
    return kind === 'login'
      ? `Çok fazla hatalı deneme. Güvenliğiniz için ${rule.windowMin} dakika bekleyin ya da "Şifremi unuttum" ile yeni şifre oluşturun.`
      : 'Çok fazla deneme yapıldı. Lütfen bir saat sonra tekrar deneyin.';
  }
  return null;
}

export async function recordAttempt(kind: AttemptKind, key: string, ip: string, ok: boolean) {
  await rawDb().from('auth_attempts').insert([{ kind, key, ok }, { kind, key: `ip:${ip}`, ok }]);
  if (ok && kind === 'login') {
    // Başarılı girişte bu e-postanın hatalı deneme sayacı sıfırlanır
    await rawDb().from('auth_attempts').delete().eq('kind', 'login').eq('key', key).eq('ok', false);
  }
  // Eski kayıtları ara ara temizle
  if (Math.random() < 0.02) {
    await rawDb().from('auth_attempts').delete().lt('created_at', new Date(Date.now() - 2 * 86_400_000).toISOString());
  }
}
