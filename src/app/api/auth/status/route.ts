import { NextResponse } from 'next/server';
import { db, rawDb } from '@/lib/supabase/server';
import { activeUser } from '@/lib/auth/server';
import { withStore } from '@/lib/tenant';
import { mailConfigured } from '@/lib/auth/mail';
import { isDemoStore } from '@/lib/demo';

export const dynamic = 'force-dynamic';

/** Supabase bağlantı hatasını, kullanıcının ne yapması gerektiğini söyleyen bir mesaja çevirir */
function explain(e: { message?: string; code?: string; hint?: string }, status: number) {
  const raw = [e.code, e.message].filter(Boolean).join(' – ') || `HTTP ${status}`;
  const msg = `${e.message ?? ''} ${e.code ?? ''}`.toLowerCase();
  if (e.code === 'PGRST205' || e.code === '42P01' || e.code === '42703' || status === 404 || msg.includes('could not find the table') || msg.includes('does not exist')) {
    return `Veritabanı güncel değil. Supabase → SQL Editor'de schema.sql dosyasının tamamını yapıştırıp Run'a basın. (${raw})`;
  }
  if (e.code === '42501') {
    return `Veritabanı izinleri eksik. Supabase → SQL Editor'de schema.sql dosyasının en altındaki "10. Yetkiler" bölümünü çalıştırın. Hata sürerse Vercel'deki SUPABASE_SERVICE_ROLE_KEY değerinin sb_secret_ ile başlayan secret anahtar olduğundan emin olun. (${raw})`;
  }
  if (status === 401 || status === 403 || msg.includes('api key') || msg.includes('jwt') || msg.includes('permission denied')) {
    return `Supabase anahtarı hatalı. Vercel'deki SUPABASE_SERVICE_ROLE_KEY değerine Supabase → Project Settings → API Keys sayfasındaki "secret" (sb_secret_...) veya "service_role" anahtarını yapıştırıp yeniden yayınlayın. (${raw})`;
  }
  if (msg.includes('fetch failed') || msg.includes('enotfound') || msg.includes('getaddrinfo')) {
    return `Supabase adresine ulaşılamadı. Vercel'deki PUBLIC_SUPABASE_URL değeri https://xxxx.supabase.co biçiminde olmalı; Supabase projesi duraklatılmışsa Restore deyin. (${raw})`;
  }
  return `Veritabanına bağlanılamadı (${raw}). Vercel ortam değişkenlerini ve schema.sql kurulumunu kontrol edin.`;
}

/** Hangi ekranın gösterileceğine karar verir: giriş/kayıt → başlangıç sihirbazı → panel */
export async function GET() {
  try {
    // Çok mağazalı şema kurulmuş mu? (stores tablosu + app_users.store_id)
    const { error, status } = await rawDb().from('app_users').select('id, store_id, session_version').limit(1);
    if (error) throw new Error(explain(error, status));
    const s2 = await rawDb().from('stores').select('id').limit(1);
    if (s2.error) throw new Error(explain(s2.error, s2.status));

    const user = await activeUser();
    const base = { mailConfigured: mailConfigured(), demoMode: process.env.DEMO_MODE === 'true' };
    if (!user) return NextResponse.json({ ...base, user: null, onboarded: false, companyName: null });
    return await withStore(user.storeId, async () => {
      const { data } = await db().from('app_settings').select('key, value').in('key', ['onboarding', 'company']);
      const rows = (data ?? []) as Array<{ key: string; value: Record<string, unknown> }>;
      const onboarding = rows.find((r) => r.key === 'onboarding')?.value as { completedAt?: string } | undefined;
      const company = rows.find((r) => r.key === 'company')?.value as { name?: string } | undefined;
      return NextResponse.json({
        ...base,
        demoMode: await isDemoStore(user.storeId),
        user: { email: user.email, name: user.name, role: user.role },
        onboarded: !!onboarding?.completedAt,
        companyName: company?.name ?? null,
      });
    }, user.id);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e), configError: true }, { status: 500 });
  }
}
