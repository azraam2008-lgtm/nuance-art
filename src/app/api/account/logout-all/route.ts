import { NextResponse } from 'next/server';
import { handle } from '@/lib/api';
import { rawDb, must } from '@/lib/supabase/server';
import { currentUserId } from '@/lib/tenant';
import { clearSession } from '@/lib/auth/server';

export const dynamic = 'force-dynamic';

/** Tüm cihazlardan çıkış: oturum sürümü artar, bütün eski çerezler geçersiz olur */
export const POST = handle(async () => {
  const u = must(await rawDb().from('app_users').select('session_version').eq('id', currentUserId()).single()) as { session_version: number };
  must(await rawDb().from('app_users').update({ session_version: (u.session_version ?? 0) + 1 }).eq('id', currentUserId()).select('id'));
  return clearSession(NextResponse.json({ ok: true }));
});
