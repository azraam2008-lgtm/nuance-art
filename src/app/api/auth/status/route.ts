import { NextResponse } from 'next/server';
import { db } from '@/lib/supabase/server';
import { currentUser } from '@/lib/auth/server';

export const dynamic = 'force-dynamic';

/** İlk açılışta hangi ekranın gösterileceğine karar verir: kurulum → giriş → başlangıç sihirbazı → panel */
export async function GET() {
  try {
    const { count, error } = await db().from('app_users').select('id', { count: 'exact', head: true });
    if (error) throw new Error(`Veritabanına bağlanılamadı: ${error.message || error.code || 'bilinmeyen hata'}. .env değişkenlerini ve schema.sql kurulumunu kontrol edin.`);
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
