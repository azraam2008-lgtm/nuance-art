import { handle } from '@/lib/api';
import { db, must } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export const GET = handle(async () => {
  const logs = must(await db().from('sync_logs').select('*').order('created_at', { ascending: false }).order('id', { ascending: false }).limit(80));
  return { logs };
});
