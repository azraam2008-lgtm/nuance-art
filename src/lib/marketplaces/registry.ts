import 'server-only';
import { withSecondAccounts, type MarketplaceName } from './meta';
import type { MarketplaceAdapter, MarketplaceCredentials } from './types';
import { GUIDES, hasRequiredKeys } from './guides';
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
  /** Deneme mağazası: her pazaryeri simülasyonla çalışır, gerçek istek gönderilmez */
  demo?: boolean;
}

/**
 * Adaptör fabrikası. Yeni pazaryeri eklemek için:
 *   1) adapters/yeni.ts içinde MarketplaceAdapter arayüzünü uygulayın
 *   2) meta.ts'e meta bilgisini ekleyin
 *   3) Aşağıdaki FACTORIES nesnesine bir satır ekleyin
 *   4) SQL: insert into marketplaces(name,label,color) values ('yeni','Yeni','#000');
 *            insert into marketplace_credentials(marketplace_name) values ('yeni');
 */
type Factory = (c: MarketplaceCredentials, o: AdapterOptions) => MarketplaceAdapter;
const FACTORIES: Record<MarketplaceName, Factory> = withSecondAccounts<Factory>({
  trendyol: (c) => new TrendyolAdapter(c),
  hepsiburada: (c) => new HepsiburadaAdapter(c),
  n11: (c) => new N11Adapter(c),
  ciceksepeti: (c) => new CiceksepetiAdapter(c),
  pazarama: (c) => new PazaramaAdapter(c),
  idefix: (c) => new IdefixAdapter(c),
  koctas: (c) => new KoctasAdapter(c),
  etsy: (c, o) => new EtsyAdapter(c, o.saveExtra),
}, (_b, f) => f);

/**
 * Bağlı (aktif ve anahtarları girilmiş) pazaryeri için gerçek adaptörü döndürür; bağlı değilse null.
 * Deneme mağazasında (veya geliştirmede DEMO_MODE=true iken) tüm pazaryerleri simülasyon adaptörüyle çalışır.
 */
export function createAdapter(name: MarketplaceName, creds: MarketplaceCredentials | null, isActive: boolean, opts: AdapterOptions = {}): MarketplaceAdapter | null {
  if (opts.demo || process.env.DEMO_MODE === 'true') return new DemoAdapter(name);
  const connected = isActive && !!creds && hasRequiredKeys(name, creds);
  if (!connected) return null;
  // Boş bırakılan gelişmiş ayarlar için varsayılan değerler (ör. Koçtaş panel adresi)
  const extra = { ...creds!.extra };
  for (const f of GUIDES[name].extra) if (f.default && (extra[f.key] === undefined || extra[f.key] === '')) extra[f.key] = f.default;
  return FACTORIES[name]({ ...creds!, extra }, opts);
}
