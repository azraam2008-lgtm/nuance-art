import type { InvoiceDraft, Party } from './model';

export type ProviderName = 'none' | 'manual' | 'parasut' | 'nilvera' | 'uyumsoft';

/** app_settings → invoicing (gizli anahtarlar ayrı ve şifreli: invoicing_secrets) */
export interface InvoicingSettings {
  provider: ProviderName;
  /** Sipariş "kargoya verildi" olunca faturayı otomatik kes */
  auto: boolean;
  seller: Party & { website: string };
  /** Nilvera fatura seri öneki (3 harf), Paraşüt'te kullanılmaz */
  series: string;
  parasut: { clientId: string; username: string; companyId: string; productId: string; baseUrl: string };
  nilvera: { test: boolean; baseUrl: string };
  uyumsoft: { username: string; test: boolean; baseUrl: string };
}
export interface InvoicingSecrets { parasutClientSecret?: string; parasutPassword?: string; nilveraApiKey?: string; uyumsoftPassword?: string }

export interface IssueState { uuid: string; ref: Record<string, unknown> }
export interface IssueResult {
  status: 'issued' | 'processing' | 'failed';
  message: string;
  kind?: 'e_archive' | 'e_invoice';
  invoiceNumber?: string | null;
  uuid?: string | null;
  issuedAt?: string | null;
  pdf?: Uint8Array | null;
  /** Sonraki denemede kaldığı yerden devam etmek için (ör. Paraşüt'te oluşturulan taslak) */
  ref?: Record<string, unknown>;
}

export interface InvoiceProvider {
  readonly name: ProviderName | 'demo';
  test(): Promise<{ ok: boolean; message: string }>;
  issue(draft: InvoiceDraft, state: IssueState): Promise<IssueResult>;
}

export const EMPTY_PARTY: Party = { name: '', taxNumber: '', taxOffice: '', address: '', district: '', city: '', postalCode: '', country: 'Türkiye', email: '', phone: '' };
export const DEFAULT_SETTINGS: InvoicingSettings = {
  provider: 'none', auto: false, seller: { ...EMPTY_PARTY, website: '' }, series: 'KRV',
  parasut: { clientId: '', username: '', companyId: '', productId: '', baseUrl: '' },
  nilvera: { test: false, baseUrl: '' },
  uyumsoft: { username: '', test: false, baseUrl: '' },
};
export const PROVIDER_LABEL: Record<ProviderName, string> = {
  none: 'Fatura kesmiyorum', manual: 'Kendi programımla keserim (numarayı panele yazarım)', parasut: 'Paraşüt', nilvera: 'Nilvera', uyumsoft: 'Uyumsoft',
};
