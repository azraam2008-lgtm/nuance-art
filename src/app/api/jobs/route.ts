import { handle, HttpError, readJson } from '@/lib/api';
import { db, must } from '@/lib/supabase/server';
import { currentStoreId } from '@/lib/tenant';
import { processDueJobs } from '@/lib/sync/jobs';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** İşlem Merkezi: pazaryerine gönderilemeyen / tekrar denenecek işler */
export const GET = handle(async (req: Request) => {
  const view = new URL(req.url).searchParams.get('view') ?? 'open';
  let q = db().from('sync_jobs').select('id, kind, marketplace_name, ref_id, payload, status, attempts, max_attempts, run_at, last_error, created_at, updated_at, finished_at')
    .order('updated_at', { ascending: false }).limit(200);
  q = view === 'done' ? q.in('status', ['done', 'cancelled']) : q.in('status', ['pending', 'running', 'failed']);
  const jobs = must(await q);
  const { count: failed } = await db().from('sync_jobs').select('id', { count: 'exact', head: true }).eq('status', 'failed');
  const { count: pending } = await db().from('sync_jobs').select('id', { count: 'exact', head: true }).in('status', ['pending', 'running']);
  return { jobs, counts: { failed: failed ?? 0, pending: pending ?? 0 } };
});

/** Tekrar dene (tek iş veya hepsi) / yoksay */
export const POST = handle(async (req: Request) => {
  const b = await readJson<{ action?: string; id?: string }>(req);
  const now = new Date().toISOString();
  const validId = (id?: string) => { if (!id || !/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(400, 'Geçersiz kayıt.'); return id; };
  if (b.action === 'cancel') {
    must(await db().from('sync_jobs').update({ status: 'cancelled', finished_at: now, updated_at: now }).eq('id', validId(b.id)).in('status', ['pending', 'failed']).select('id'));
    return { ok: true };
  }
  if (b.action === 'retry' || b.action === 'retry_all') {
    let q = db().from('sync_jobs').update({ status: 'pending', run_at: now, attempts: 0, locked_at: null, updated_at: now }).in('status', ['pending', 'failed']);
    if (b.action === 'retry') q = q.eq('id', validId(b.id));
    must(await q.select('id'));
    const result = await processDueJobs({ storeId: currentStoreId(), budgetMs: 40_000, limit: b.action === 'retry' ? 10 : 100 });
    return { ok: true, result };
  }
  throw new HttpError(400, 'Geçersiz işlem.');
});
