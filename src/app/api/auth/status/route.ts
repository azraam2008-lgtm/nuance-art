import { NextResponse } from 'next/server';
import { db } from '@/lib/supabase/server';
import { currentUser } from '@/lib/auth/server';

export const dynamic = 'force-dynamic';

/** İlk açılışta hangi ekranın gösterileceğine karar verir: kurulum → giriş → başlangıç sihirbazı → panel */
/** Supabase bağlantı hatasını, kullanıcının ne yapması gerektiğini söyleyen bir mesaja çevirir */
function explain(e: { message?: string; code?: string; hint?: string }, status: number) {
  const raw = [e.code, e.message].filter(Boolean).join(' – ') || `HTTP ${status}`;
  const msg = `${e.message ?? ''} ${e.code ?? ''}`.toLowerCase();
  if (e.code === 'PGRST205' || e.code === '42P01' || status === 404 || msg.includes('could not find the table') || msg.includes('does not exist')) {
    return `Veritabanı tabloları kurulmamış. Supabase → SQL Editor'de schema.sql dosyasının tamamını yapıştırıp Run'a basın. (${raw})`;
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

export async function GET() {
  try {
    const { count, error, status } = await db().from('app_users').select('id', { count: 'exact' }).limit(1);
    if (error) throw new Error(explain(error, status));
    const user = await currentUser();
    const { data } = await db().from('app_settings').select('key, value').in('key', ['onboarding', 'company']);
    const onboarding = data?.find((r) => r.key === 'onboarding')?.value as { completedAt?: string } | undefined;
    const company = data?.find((r) => r.key === 'company')?.value as { name?: string } | undefined;
    return NextResponse.json({
      hasUser: (count ?? 0) > 0,
      user: user ? { email: user.email, name: user.name } : null,
      onboarded: !!onboarding?.completedAt,
      companyName: company?.name ?? null,
      demoMode: process.env.DEMO_MODE === 'true',
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e), configError: true }, { status: 500 });
  }
}
