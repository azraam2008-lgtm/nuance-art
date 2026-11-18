import type { MarketplaceName } from '../meta';
import { MARKETPLACE_META, ORDER_PREFIX } from '../meta';
import type {
  AdapterResult, MarketplaceAdapter, NormalizedOrder, ProductPayload, RemoteProduct, StockUpdate,
} from '../types';

const wait = (min: number, max: number) => new Promise((r) => setTimeout(r, min + Math.random() * (max - min)));

/**
 * Demo / Simülasyon adaptörü.
 * Gerçek API anahtarı girilene kadar (veya FORCE_DEMO_MODE=true iken) tüm pazaryerleri bu adaptörü kullanır.
 * Ağ çağrısı yapmaz; gecikmeyi ve pazaryeri yanıtlarını gerçekçi biçimde taklit eder.
 * Sipariş üretimi /api/simulate üzerinden yapılır; motor aynı akışı (apply_order → stok gönderimi) çalıştırır.
 */
export class DemoAdapter implements MarketplaceAdapter {
  readonly mode = 'demo' as const;
  constructor(readonly name: MarketplaceName) {}

  async testConnection(): Promise<AdapterResult> {
    await wait(300, 700);
    return { ok: true, message: `${MARKETPLACE_META[this.name].label}: Demo modu aktif (gerçek API çağrısı yapılmadı).` };
  }

  async createProduct(p: ProductPayload): Promise<AdapterResult> {
    await wait(400, 1200);
    if (!p.category.trim()) {
      return { ok: false, status: 'error', message: 'Kategori eşlemesi eksik (simülasyon).' };
    }
    const prefix = ORDER_PREFIX[this.name];
    return {
      ok: true,
      status: 'active',
      externalId: `${prefix}-${Math.floor(100000 + Math.random() * 900000)}`,
      message: `${MARKETPLACE_META[this.name].at} yayınlandı (simülasyon).`,
    };
  }

  async checkListing(): Promise<AdapterResult> {
    return { ok: true, status: 'active', message: 'Onaylandı (simülasyon).' };
  }

  async updateStock(items: StockUpdate[]): Promise<AdapterResult> {
    await wait(150, 600);
    return { ok: true, message: `${items.length} ürün stoğu güncellendi (simülasyon).` };
  }

  async fetchOrders(): Promise<NormalizedOrder[]> {
    return [];
  }

  async fetchProducts(page: number): Promise<RemoteProduct[]> {
    await wait(300, 700);
    if (page > 0) return [];
    const base = { description: '', brand: 'NuanceArt', vatRate: 20, costPrice: 0, images: [] as string[], attributes: {} };
    return [
      { ...base, externalId: 'TY-88112', sku: 'JUT-301', barcode: '8690000001100', title: 'Pamuklu Jüt Kurdele 1 cm x 25 m - Natürel', category: 'Hediye Paketleme', price: 69.9, listPrice: 84.9, stock: 80, costPrice: 22 },
      { ...base, externalId: 'TY-88140', sku: 'MKR-015', barcode: '8690000001117', title: 'Makrome Duvar Süsü - Küçük Boy', category: 'Ev Dekorasyon', price: 249.9, listPrice: 299.9, stock: 30, costPrice: 95 },
      { ...base, externalId: 'TY-88203', sku: 'TRR-044', barcode: '8690000001124', title: 'Sukulent Teraryum Seti (Cam Fanus)', category: 'Bahçe & Bitki', price: 399.9, listPrice: 449.9, stock: 22, costPrice: 160 },
      { ...base, externalId: 'TY-88317', sku: 'KRD-002', barcode: '8690000001131', title: 'Saten Kurdele 2,5 cm x 10 m - Lacivert', category: 'Hediye Paketleme', price: 49.9, listPrice: 59.9, stock: 40, costPrice: 18 },
    ].map((p) => ({ ...p, description: `${p.title} — Trendyol mağazasından aktarıldı.` }));
  }
}
