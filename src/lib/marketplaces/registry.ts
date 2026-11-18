import 'server-only';
import type { MarketplaceName } from './meta';
import type { MarketplaceAdapter, MarketplaceCredentials } from './types';
import { TrendyolAdapter } from './adapters/trendyol';
import { HepsiburadaAdapter } from './adapters/hepsiburada';
import { N11Adapter } from './adapters/n11';
import { CiceksepetiAdapter } from './adapters/ciceksepeti';
import { PazaramaAdapter } from './adapters/pazarama';
import { IdefixAdapter } from './adapters/idefix';
import { KoctasAdapter } from './adapters/koctas';
import { EtsyAdapter } from './adapters/etsy';
import { DemoAdapter } from './adapters/demo';

export interface AdapterOptions {
  /** OAuth jetonu yenilenince extra_config'i veritabanına yazar (Etsy) */
  saveExtra?: (extra: Record<string, unknown>) => Promise<void>;
}

/**
 * Adaptör fabrikası. Yeni pazaryeri eklemek için:
 *   1) adapters/yeni.ts içinde MarketplaceAdapter arayüzünü uygulayın
 *   2) meta.ts'e meta bilgisini ekleyin
 *   3) Aşağıdaki FACTORIES nesnesine bir satır ekleyin
 *   4) SQL: insert into marketplaces(name,label,color) values ('yeni','Yeni','#000');
 *            insert into marketplace_credentials(marketplace_name) values ('yeni');
 */
const FACTORIES: Record<MarketplaceName, (c: MarketplaceCredentials, o: AdapterOptions) => MarketplaceAdapter> = {
  trendyol: (c) => new TrendyolAdapter(c),
  hepsiburada: (c) => new HepsiburadaAdapter(c),
  n11: (c) => new N11Adapter(c),
  ciceksepeti: (c) => new CiceksepetiAdapter(c),
  pazarama: (c) => new PazaramaAdapter(c),
  idefix: (c) => new IdefixAdapter(c),
  koctas: (c) => new KoctasAdapter(c),
  etsy: (c, o) => new EtsyAdapter(c, o.saveExtra),
};

/**
 * Bağlı (aktif ve anahtarları girilmiş) pazaryeri için gerçek adaptörü döndürür; bağlı değilse null.
 * Yalnızca geliştirme amaçlı DEMO_MODE=true iken bağlı olmayan pazaryerleri simülasyon adaptörüyle çalışır.
 */
export function createAdapter(name: MarketplaceName, creds: MarketplaceCredentials | null, isActive: boolean, opts: AdapterOptions = {}): MarketplaceAdapter | null {
  const demo = process.env.DEMO_MODE === 'true';
  const connected = isActive && !!creds && !!creds.apiKey && (!!creds.sellerId || name === 'etsy');
  if (!connected) return demo ? new DemoAdapter(name) : null;
  return FACTORIES[name](creds!, opts);
}
