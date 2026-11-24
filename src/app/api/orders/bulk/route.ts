import { handle, HttpError, readJson } from '@/lib/api';
import { isOrderStatus } from '@/lib/marketplaces/meta';
import { changeOrderStatus, markShipped, type RemoteStatusResult } from '@/lib/sync/engine';
import { errorMessage } from '@/lib/marketplaces/http';
import { audit } from '@/lib/audit';
import { getInvoicingSettings, processDueInvoices, queueInvoices } from '@/lib/invoicing/service';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Toplu sipariş işlemi: seçilen siparişlerin durumunu değiştirir veya kargoya verildi yapar.
 * Her sipariş ayrı işlenir; sonuç sipariş ve pazaryeri bazında döner (biri başarısız olsa diğerleri devam eder).
 */
export const POST = handle(async (req: Request) => {
  const b = await readJson<{ ids?: unknown[]; status?: string; action?: 'ship' }>(req);
  const ids = (Array.isArray(b.ids) ? b.ids : []).map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x));
  if (!ids.length) throw new HttpError(400, 'Sipariş seçilmedi.');
  if (ids.length > 50) throw new HttpError(400, 'Tek seferde en fazla 50 sipariş işlenebilir.');
  if (b.action !== 'ship' && !isOrderStatus(b.status)) throw new HttpError(400, 'Geçersiz durum.');
  const started = Date.now();
  const results: Array<{ id: string; ok: boolean; message: string; remote?: RemoteStatusResult }> = [];
  for (const id of ids) {
    if (Date.now() - started > 50_000) { results.push({ id, ok: false, message: 'Süre doldu; bu sipariş işlenmedi, tekrar deneyin.' }); continue; }
    try {
      const r = b.action === 'ship' ? await markShipped(id) : await changeOrderStatus(id, b.status as Parameters<typeof changeOrderStatus>[1]);
      results.push({ id, ok: true, message: 'Tamam', remote: r.remote });
    } catch (e) {
      results.push({ id, ok: false, message: errorMessage(e) });
    }
  }
  const okCount = results.filter((r) => r.ok).length;
  // Otomatik fatura: kargoya verilenler sıraya alınır; kalan süre yetmezse zamanlayıcı keser
  if (b.action === 'ship' || b.status === 'shipped') {
    try {
      const s = await getInvoicingSettings();
      const shipped = results.filter((r) => r.ok).map((r) => r.id);
      if (s.auto && shipped.length) { await queueInvoices(shipped); await processDueInvoices({ orderIds: shipped, budgetMs: Math.max(0, 55_000 - (Date.now() - started)) }); }
    } catch (e) { console.error('[invoice bulk]', e); }
  }
  if (okCount) await audit('Toplu sipariş işlemi', `${okCount} sipariş → ${b.action === 'ship' ? 'kargoya verildi' : b.status}`);
  return { results };
});
