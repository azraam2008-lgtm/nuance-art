import 'server-only';
import { randomBytes, randomUUID } from 'crypto';
import { db, must } from '@/lib/supabase/server';
import { encryptSecret, decryptSecret } from '@/lib/crypto';
import { isDemoStore } from '@/lib/demo';
import { errorMessage } from '@/lib/marketplaces/http';
import { MARKETPLACE_META, isMarketplace, type MarketplaceName } from '@/lib/marketplaces/meta';
import { isRetryable } from '@/lib/sync/job-log';
import { changeOrderStatus, getAdapter, log } from '@/lib/sync/engine';
import { audit } from '@/lib/audit';
import { buildLines, extractBuyer, type InvoiceDraft } from './model';
import { DEFAULT_SETTINGS, type InvoiceProvider, type InvoicingSecrets, type InvoicingSettings, type IssueResult } from './types';
import { ParasutProvider } from './providers/parasut';
import { NilveraProvider } from './providers/nilvera';
import { DemoInvoiceProvider } from './providers/demo';
import { UyumsoftProvider } from './providers/uyumsoft';

const BUCKET = 'invoices';
const BACKOFF_MIN = [1, 5, 15, 60, 180, 360];
const MAX_ATTEMPTS = 7;

// ---------------------------------------------------------------- ayarlar
export async function getInvoicingSettings(): Promise<InvoicingSettings & { siteUrl?: string }> {
  const { data } = await db().from('app_settings').select('value').eq('key', 'invoicing').maybeSingle();
  const v = (data?.value ?? {}) as Partial<InvoicingSettings> & { siteUrl?: string };
  return {
    ...DEFAULT_SETTINGS, ...v,
    seller: { ...DEFAULT_SETTINGS.seller, ...(v.seller ?? {}) },
    parasut: { ...DEFAULT_SETTINGS.parasut, ...(v.parasut ?? {}) },
    nilvera: { ...DEFAULT_SETTINGS.nilvera, ...(v.nilvera ?? {}) },
    uyumsoft: { ...DEFAULT_SETTINGS.uyumsoft, ...(v.uyumsoft ?? {}) },
  };
}
export async function getInvoicingSecrets(): Promise<InvoicingSecrets> {
  const { data } = await db().from('app_settings').select('value').eq('key', 'invoicing_secrets').maybeSingle();
  const v = (data?.value ?? {}) as Record<string, string>;
  const out: InvoicingSecrets = {};
  for (const [k, x] of Object.entries(v)) if (x) (out as Record<string, string>)[k] = decryptSecret(x);
  return out;
}
export async function saveInvoicing(settings: InvoicingSettings & { siteUrl?: string }, secrets: InvoicingSecrets) {
  const now = new Date().toISOString();
  must(await db().from('app_settings').upsert({ key: 'invoicing', value: settings, updated_at: now }).select('key'));
  const { data } = await db().from('app_settings').select('value').eq('key', 'invoicing_secrets').maybeSingle();
  const cur = (data?.value ?? {}) as Record<string, string>;
  for (const [k, x] of Object.entries(secrets)) if (typeof x === 'string' && x.trim()) cur[k] = encryptSecret(x.trim()); // boş gelen korunur
  must(await db().from('app_settings').upsert({ key: 'invoicing_secrets', value: cur, updated_at: now }).select('key'));
}

/** Otomatik kesim yapan sağlayıcı; "kesmiyorum" / "kendi programım" için null */
export async function providerFor(s?: InvoicingSettings): Promise<InvoiceProvider | null> {
  if (await isDemoStore()) return new DemoInvoiceProvider();
  const settings = s ?? await getInvoicingSettings();
  if (settings.provider === 'parasut') return new ParasutProvider(settings, await getInvoicingSecrets());
  if (settings.provider === 'nilvera') return new NilveraProvider(settings, await getInvoicingSecrets());
  if (settings.provider === 'uyumsoft') return new UyumsoftProvider(settings, await getInvoicingSecrets());
  return null;
}

/** Satıcı bilgisi eksikse kesimden önce açıkça söyler */
export function sellerProblems(s: InvoicingSettings): string[] {
  const p: string[] = [];
  if (!s.seller.name) p.push('firma unvanı');
  if (!/^\d{10,11}$/.test(s.seller.taxNumber)) p.push('vergi/TC kimlik numarası');
  if (!s.seller.taxOffice) p.push('vergi dairesi');
  if (!s.seller.address || !s.seller.city) p.push('adres ve il');
  return p;
}

// ---------------------------------------------------------------- sipariş → fatura taslağı
interface OrderRow {
  id: string; external_order_id: string; marketplace_name: string; customer_name: string; order_date: string; status: string; carrier: string | null; raw: unknown;
  items: Array<{ sku: string; product_title: string; quantity: number; unit_price: number; product: { vat_rate: number | null } | null }>;
}
export async function buildDraft(orderId: string): Promise<InvoiceDraft & { status: string; raw: unknown }> {
  const o = must(await db().from('orders')
    .select('id, external_order_id, marketplace_name, customer_name, order_date, status, carrier, raw, items:order_items(sku, product_title, quantity, unit_price, product:products(vat_rate))')
    .eq('id', orderId).single()) as unknown as OrderRow;
  const { lines, totals } = buildLines(o.items.map((i) => ({ sku: i.sku, title: i.product_title, quantity: i.quantity, unitPrice: Number(i.unit_price), vatRate: Number(i.product?.vat_rate ?? 20) })));
  return {
    orderId: o.id, orderNo: o.external_order_id.split('/')[0], marketplace: o.marketplace_name,
    marketplaceLabel: isMarketplace(o.marketplace_name) ? MARKETPLACE_META[o.marketplace_name].label : o.marketplace_name,
    orderDate: o.order_date, buyer: extractBuyer(o.raw, o.customer_name), lines, totals, carrier: o.carrier, status: o.status, raw: o.raw,
  };
}

// ---------------------------------------------------------------- kuyruk
interface InvoiceRow {
  id: string; order_id: string; provider: string; status: string; attempts: number; uuid: string | null; provider_ref: Record<string, unknown>;
  invoice_number: string | null; pdf_path: string | null; public_token: string | null;
}

/** Siparişi faturalama kuyruğuna alır (aynı sipariş ikinci kez eklenmez) */
export async function queueInvoices(orderIds: string[]): Promise<number> {
  const s = await getInvoicingSettings();
  const demo = await isDemoStore();
  const provider = demo ? 'demo' : s.provider;
  if (provider === 'none' || provider === 'manual') return 0;
  const rows = orderIds.map((order_id) => ({ order_id, provider, status: 'pending', uuid: randomUUID(), next_try_at: new Date().toISOString() }));
  const res = await db().from('invoices').upsert(rows, { onConflict: 'order_id', ignoreDuplicates: true }).select('id');
  if (res.error) throw new Error(res.error.message);
  // Daha önce başarısız olanları yeniden sıraya al
  await db().from('invoices').update({ status: 'pending', next_try_at: new Date().toISOString(), attempts: 0 }).in('order_id', orderIds).eq('status', 'failed');
  return res.data?.length ?? 0;
}

/** Sipariş kargoya verilince (otomatik mod açıksa) çağrılır; hata asıl işlemi bozmaz */
export async function autoQueueOnShip(orderId: string) {
  try {
    const s = await getInvoicingSettings();
    if (s.auto) { await queueInvoices([orderId]); await processDueInvoices({ orderIds: [orderId], budgetMs: 20_000 }); }
  } catch (e) { console.error('[invoice auto]', e); }
}

async function storePdf(orderId: string, pdf: Uint8Array): Promise<string | null> {
  const path = `${db().storeId}/${orderId}.pdf`;
  const up = () => db().storage.from(BUCKET).upload(path, Buffer.from(pdf), { contentType: 'application/pdf', upsert: true });
  let { error } = await up();
  if (error && /not found|bucket/i.test(error.message)) {
    await db().storage.createBucket(BUCKET, { public: false });
    ({ error } = await up());
  }
  if (error) { console.error('[invoice pdf]', error.message); return null; }
  return path;
}

/** Kesilen faturayı siparişe işler ve pazaryerine bildirir */
async function afterIssued(orderId: string, number: string, token: string, siteUrl: string | undefined, hasPdf: boolean): Promise<string> {
  const d = must(await db().from('orders').select('status, marketplace_name, external_order_id, raw').eq('id', orderId).single()) as { status: string; marketplace_name: MarketplaceName; external_order_id: string; raw: unknown };
  await db().from('orders').update({ invoice_number: number }).eq('id', orderId);
  const notes: string[] = [];
  // Hazırlık aşamasındaysa "Faturalandı" durumu fatura numarasıyla pazaryerine gider (Trendyol, idefix)
  if (['new', 'approved', 'preparing'].includes(d.status)) {
    try { await changeOrderStatus(orderId, 'invoiced', { invoiceNumber: number }); notes.push('sipariş "Faturalandı" yapıldı'); }
    catch (e) { notes.push(`durum güncellenemedi: ${errorMessage(e)}`); }
  }
  // Fatura bağlantısı (Trendyol)
  try {
    const adapter = await getAdapter(d.marketplace_name);
    if (adapter.sendInvoiceLink && hasPdf && siteUrl) {
      const r = await adapter.sendInvoiceLink({ externalOrderId: d.external_order_id, raw: d.raw, invoiceNumber: number, invoiceLink: `${siteUrl}/api/invoice-file/${token}`, invoiceDate: new Date().toISOString() });
      notes.push(r.message);
    } else if (!adapter.sendInvoiceLink) {
      notes.push(`${MARKETPLACE_META[d.marketplace_name].label} fatura dosyası almayı API ile desteklemiyor; numara sipariş durumuyla iletilir`);
    }
  } catch (e) { notes.push(errorMessage(e)); }
  return notes.join(' · ');
}

/** Tek faturayı işler. Kilitleme: deneme sayacını koşullu artırarak (iki çalışan aynı faturayı almaz) */
export async function processInvoice(row: InvoiceRow): Promise<{ ok: boolean; message: string }> {
  const claimed = await db().from('invoices').update({ attempts: row.attempts + 1, updated_at: new Date().toISOString() })
    .eq('id', row.id).eq('attempts', row.attempts).in('status', ['pending', 'processing']).select('id');
  if (!claimed.data?.length) return { ok: false, message: 'Başka bir işlem bu faturayı işliyor.' };
  const settings = await getInvoicingSettings();
  const provider = await providerFor(settings);
  const fail = async (message: string, retry: boolean) => {
    const attempts = row.attempts + 1;
    const again = retry && attempts < MAX_ATTEMPTS;
    await db().from('invoices').update({
      status: again ? 'pending' : 'failed', last_error: message.slice(0, 1000), updated_at: new Date().toISOString(),
      next_try_at: new Date(Date.now() + BACKOFF_MIN[Math.min(attempts - 1, BACKOFF_MIN.length - 1)] * 60_000).toISOString(),
    }).eq('id', row.id);
    return { ok: false, message: again ? `${message} (tekrar denenecek)` : message };
  };
  if (!provider) return fail('Fatura sağlayıcısı seçilmemiş (Ayarlar → Fatura).', false);
  if (provider.name !== 'demo') {
    const missing = sellerProblems(settings);
    if (missing.length) return fail(`Satıcı bilgileri eksik: ${missing.join(', ')} (Ayarlar → Fatura).`, false);
  }
  let r: IssueResult;
  try {
    const draft = await buildDraft(row.order_id);
    if (!draft.lines.length) return fail('Siparişte faturalanacak ürün yok.', false);
    r = await provider.issue(draft, { uuid: row.uuid ?? randomUUID(), ref: row.provider_ref ?? {} });
  } catch (e) {
    const m = errorMessage(e);
    return fail(m, isRetryable(m));
  }
  if (r.status === 'failed') {
    await db().from('invoices').update({ provider_ref: r.ref ?? row.provider_ref }).eq('id', row.id);
    return fail(r.message, false);
  }
  if (r.status === 'processing') {
    await db().from('invoices').update({ status: 'processing', provider_ref: r.ref ?? row.provider_ref, uuid: r.uuid ?? row.uuid, last_error: null, next_try_at: new Date(Date.now() + 3 * 60_000).toISOString() }).eq('id', row.id);
    return { ok: true, message: r.message };
  }
  const token = row.public_token ?? randomBytes(24).toString('base64url');
  const pdfPath = r.pdf?.length ? await storePdf(row.order_id, r.pdf) : row.pdf_path;
  const number = r.invoiceNumber ?? '';
  const draft = await buildDraft(row.order_id);
  await db().from('invoices').update({
    status: 'issued', kind: r.kind ?? 'e_archive', invoice_number: number || null, uuid: r.uuid ?? row.uuid, issued_at: r.issuedAt ?? new Date().toISOString(),
    total: draft.totals.gross, pdf_path: pdfPath, public_token: token, provider_ref: r.ref ?? row.provider_ref, last_error: null, updated_at: new Date().toISOString(),
  }).eq('id', row.id);
  const sent = number ? await afterIssued(row.order_id, number, token, settings.siteUrl, !!pdfPath) : 'Fatura numarası gelmedi';
  await db().from('invoices').update({ marketplace_sent: sent.slice(0, 1000) }).eq('id', row.id);
  await log('info', 'order', isMarketplace(draft.marketplace) ? draft.marketplace : null, `#${draft.orderNo} fatura kesildi: ${number}`);
  await audit('Fatura kesildi', `${draft.marketplaceLabel} #${draft.orderNo} → ${number}`);
  return { ok: true, message: `${r.message} No: ${number}` };
}

/** Zamanı gelen faturaları işler (zamanlayıcı ve "Fatura kes" düğmesi) */
export async function processDueInvoices(opts: { orderIds?: string[]; budgetMs?: number } = {}) {
  const started = Date.now();
  let q = db().from('invoices').select('id, order_id, provider, status, attempts, uuid, provider_ref, invoice_number, pdf_path, public_token').in('status', ['pending', 'processing']);
  q = opts.orderIds ? q.in('order_id', opts.orderIds) : q.lte('next_try_at', new Date().toISOString());
  const rows = must(await q.order('next_try_at').limit(opts.orderIds ? 50 : 20)) as InvoiceRow[];
  const results: Array<{ orderId: string; ok: boolean; message: string }> = [];
  for (const row of rows) {
    if (Date.now() - started > (opts.budgetMs ?? 45_000)) { results.push({ orderId: row.order_id, ok: false, message: 'Süre doldu; zamanlayıcı birazdan devam edecek.' }); continue; }
    results.push({ orderId: row.order_id, ...(await processInvoice(row)) });
  }
  return results;
}

/** Kendi programında kesilen faturanın numarası (ve isteğe bağlı PDF) panele girilir */
export async function setManualInvoice(orderId: string, number: string, pdf: Uint8Array | null) {
  const settings = await getInvoicingSettings();
  const { data: cur } = await db().from('invoices').select('id, public_token, pdf_path').eq('order_id', orderId).maybeSingle();
  const token = cur?.public_token ?? randomBytes(24).toString('base64url');
  const pdfPath = pdf?.length ? await storePdf(orderId, pdf) : cur?.pdf_path ?? null;
  const draft = await buildDraft(orderId);
  must(await db().from('invoices').upsert({
    order_id: orderId, provider: 'manual', status: 'issued', kind: 'manual', invoice_number: number, issued_at: new Date().toISOString(),
    total: draft.totals.gross, pdf_path: pdfPath, public_token: token, last_error: null, updated_at: new Date().toISOString(),
  }, { onConflict: 'order_id' }).select('id'));
  const sent = await afterIssued(orderId, number, token, settings.siteUrl, !!pdfPath);
  await db().from('invoices').update({ marketplace_sent: sent.slice(0, 1000) }).eq('order_id', orderId);
  await audit('Fatura numarası girildi', `${draft.marketplaceLabel} #${draft.orderNo} → ${number}`);
  return { message: sent };
}

export async function invoicePdf(path: string): Promise<Blob | null> {
  const { data } = await db().storage.from(BUCKET).download(path);
  return data ?? null;
}
