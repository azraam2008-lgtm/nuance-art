import { handle, HttpError, readJson, requireRole } from '@/lib/api';
import { appOrigin } from '@/lib/auth/server';
import { maskSecret } from '@/lib/crypto';
import { getInvoicingSecrets, getInvoicingSettings, providerFor, saveInvoicing, sellerProblems } from '@/lib/invoicing/service';
import { DEFAULT_SETTINGS, type InvoicingSettings, type ProviderName } from '@/lib/invoicing/types';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

const PROVIDERS: ProviderName[] = ['none', 'manual', 'parasut', 'nilvera'];
const clip = (v: unknown, n = 200) => String(v ?? '').trim().slice(0, n);

/** Fatura ayarları (gizli anahtarlar yalnızca maskeli döner) */
export const GET = handle(async () => {
  const s = await getInvoicingSettings();
  const sec = await getInvoicingSecrets();
  return {
    settings: s,
    secrets: { parasutClientSecret: maskSecret(sec.parasutClientSecret ?? ''), parasutPassword: maskSecret(sec.parasutPassword ?? ''), nilveraApiKey: maskSecret(sec.nilveraApiKey ?? '') },
    problems: s.provider === 'parasut' || s.provider === 'nilvera' ? sellerProblems(s) : [],
  };
});

export const PUT = handle(async (req: Request) => {
  requireRole('admin');
  const b = await readJson<{ settings?: Partial<InvoicingSettings>; secrets?: Record<string, string> }>(req);
  const x = b.settings ?? {};
  const provider = PROVIDERS.includes(x.provider as ProviderName) ? (x.provider as ProviderName) : 'none';
  const sel = (x.seller ?? {}) as Partial<InvoicingSettings['seller']>;
  const taxNumber = clip(sel.taxNumber, 11).replace(/\D/g, '');
  if (taxNumber && !/^\d{10,11}$/.test(taxNumber)) throw new HttpError(400, 'Vergi numarası 10, TC kimlik numarası 11 haneli olmalı.');
  const settings: InvoicingSettings & { siteUrl: string } = {
    provider, auto: !!x.auto && provider !== 'none' && provider !== 'manual',
    series: clip(x.series, 3).toUpperCase().replace(/[^A-Z]/g, '') || DEFAULT_SETTINGS.series,
    seller: {
      name: clip(sel.name), taxNumber, taxOffice: clip(sel.taxOffice, 80), address: clip(sel.address, 300), district: clip(sel.district, 80), city: clip(sel.city, 80),
      postalCode: clip(sel.postalCode, 10), country: 'Türkiye', email: clip(sel.email, 120), phone: clip(sel.phone, 30), website: clip(sel.website, 120),
    },
    parasut: { clientId: clip(x.parasut?.clientId), username: clip(x.parasut?.username), companyId: clip(x.parasut?.companyId, 20).replace(/\D/g, ''), productId: clip(x.parasut?.productId, 20), baseUrl: clip(x.parasut?.baseUrl) },
    nilvera: { test: !!x.nilvera?.test, baseUrl: clip(x.nilvera?.baseUrl) },
    siteUrl: appOrigin(req),
  };
  const s = b.secrets ?? {};
  await saveInvoicing(settings, { parasutClientSecret: s.parasutClientSecret, parasutPassword: s.parasutPassword, nilveraApiKey: s.nilveraApiKey });
  await audit('Fatura ayarları değişti', settings.provider);
  return { ok: true, problems: provider === 'parasut' || provider === 'nilvera' ? sellerProblems(settings) : [] };
});

/** Bağlantı testi */
export const POST = handle(async () => {
  requireRole('admin');
  const p = await providerFor();
  if (!p) return { ok: true, message: 'Otomatik fatura sağlayıcısı seçilmedi; test edilecek bağlantı yok.' };
  return p.test();
});
