import { handle, readJson } from '@/lib/api';
import { importCatalogStep, isImportCursor } from '@/lib/sync/catalog-import';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Tüm pazaryerlerindeki ürünleri panele çek (adım adım; ekran cursor bitene kadar tekrar çağırır) */
export const POST = handle(async (req: Request) => {
  const b = await readJson<{ cursor?: unknown }>(req).catch(() => ({ cursor: null }));
  const step = await importCatalogStep(isImportCursor(b.cursor) ? b.cursor : null);
  if (!step.cursor) await audit('Pazaryeri ürünleri panele çekildi', `${step.created} yeni, ${step.linked} bağlandı (son adım)`);
  return step;
});
