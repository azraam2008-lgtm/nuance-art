import 'server-only';
import { db, must } from '@/lib/supabase/server';
import { MARKETPLACES, MARKETPLACE_META, isMarketplace, type MarketplaceName } from '@/lib/marketplaces/meta';
import type { RemoteProduct } from '@/lib/marketplaces/types';
import { errorMessage } from '@/lib/marketplaces/http';
import { loadAdapters, log } from './engine';
import { addToIndex, buildIndex, findMatch, mergeStock, type CatalogIndex } from './catalog-merge';

/**
 * Bağlı TÜM pazaryerlerindeki ürünleri panele alır ve tek katalogda birleştirir:
 * aynı barkod/stok kodu tek ürün olur, her pazaryeri o ürünün ilanı olarak bağlanır; yalnızca birinde olan ürün de eklenir.
 * Uzun sürebileceği için adım adım çalışır: her çağrı ~40 sn çalışır ve kaldığı yeri (cursor) döner; ekran bitene kadar tekrar çağırır.
 * Tekrar çalıştırmak güvenlidir: zaten bağlı ürünler tekrar eklenmez, yalnızca yeni ürünler eklenir.
 */
export interface ImportCursor { mps: MarketplaceName[]; i: number; page: number; startedAt: string }
export interface ImportStep {
  cursor: ImportCursor | null;
  current: { marketplace: MarketplaceName; page: number } | null;
  fetched: number; created: number; linked: number; already: number;
  errors: string[];
  notes: string[];
  perMarketplace: Record<string, number>;
}
const PAGE = 50;
const MAX_PAGES = 400;

interface P { id: string; sku: string; barcode: string; title: string; total_stock: number; price: number; created_at: string; description: string | null; images: string[] | null }

async function loadCatalog(): Promise<Map<string, P>> {
  const out = new Map<string, P>();
  for (let off = 0; off < 100_000; off += 1000) {
    const page = must(await db().from('products').select('id, sku, barcode, title, total_stock, price, created_at, description, images').order('created_at').range(off, off + 999)) as P[];
    for (const p of page) out.set(p.id, p);
    if (page.length < 1000) break;
  }
  return out;
}

export async function importCatalogStep(prev: ImportCursor | null, budgetMs = 30_000, deps: { loadAdapters: typeof loadAdapters } = { loadAdapters }): Promise<ImportStep> {
  const started = Date.now();
  const adapters = await deps.loadAdapters();
  const cursor: ImportCursor = prev ?? {
    mps: MARKETPLACES.filter((m) => adapters.get(m)?.adapter),
    i: 0, page: 0, startedAt: new Date().toISOString(),
  };
  const step: ImportStep = { cursor, current: null, fetched: 0, created: 0, linked: 0, already: 0, errors: [], notes: [], perMarketplace: {} };
  if (!cursor.mps.length) { step.cursor = null; step.errors.push('Bağlı pazaryeri yok. Önce API Bağlantıları\'ndan bir pazaryeri bağlayın.'); return step; }

  const catalog = await loadCatalog();
  const idx: CatalogIndex = buildIndex([...catalog.values()]);

  // Her çağrı en az bir sayfa işler (süre ne olursa olsun ilerleme garanti)
  let first = true;
  while (cursor.i < cursor.mps.length && (first || Date.now() - started < budgetMs)) {
    first = false;
    const mp = cursor.mps[cursor.i];
    const label = MARKETPLACE_META[mp].label;
    const adapter = adapters.get(mp)?.adapter;
    step.current = { marketplace: mp, page: cursor.page };
    let remote: RemoteProduct[] = [];
    try {
      if (!adapter) throw new Error('bağlı değil');
      remote = await adapter.fetchProducts(cursor.page, PAGE);
    } catch (e) {
      step.errors.push(`${label}: ürünler alınamadı (${errorMessage(e)})`);
      cursor.i++; cursor.page = 0; continue;
    }
    const linkedIds = new Set<string>();
    for (let off = 0; off < 200_000; off += 1000) {
      const rows = must(await db().from('marketplace_listings').select('product_id').eq('marketplace_name', mp).order('created_at').range(off, off + 999)) as Array<{ product_id: string }>;
      for (const l of rows) linkedIds.add(l.product_id);
      if (rows.length < 1000) break;
    }

    for (const rp of remote) {
      step.fetched++;
      step.perMarketplace[mp] = (step.perMarketplace[mp] ?? 0) + 1;
      const sku = (rp.sku || rp.barcode || `${mp.toUpperCase()}-${rp.externalId}`).trim().slice(0, 100);
      const barcode = (rp.barcode || sku).trim().slice(0, 100);
      const stock = Math.max(0, Math.trunc(rp.stock ?? 0));
      try {
        let pid = findMatch(idx, { sku, barcode });
        if (!pid) {
          const ins = await db().from('products').insert({
            sku, barcode, title: rp.title || sku, description: rp.description ?? '', category: rp.category ?? '', brand: rp.brand ?? '',
            vat_rate: rp.vatRate ?? 20, price: rp.price ?? 0, list_price: rp.listPrice ?? rp.price ?? 0, cost_price: 0,
            total_stock: stock, low_stock_threshold: 5, image_url: rp.images?.[0] ?? null, images: rp.images ?? [],
            marketplace_attributes: { [mp]: rp.attributes ?? {} },
            group_code: rp.groupCode && rp.groupCode !== sku ? rp.groupCode : null,
          }).select('id, sku, barcode, title, total_stock, price, created_at, description, images').single();
          if (ins.error) {
            // Aynı anda eklenmiş olabilir: kayıtlı olanı bul
            const { data: ex } = await db().from('products').select('id, sku, barcode, title, total_stock, price, created_at, description, images').or(`sku.eq.${sku.replace(/[,()]/g, '')},barcode.eq.${barcode.replace(/[,()]/g, '')}`).limit(1).maybeSingle();
            if (!ex) throw new Error(ins.error.message);
            catalog.set(ex.id, ex as P); addToIndex(idx, ex as P); pid = ex.id;
          } else {
            const p = ins.data as P;
            catalog.set(p.id, p); addToIndex(idx, p); pid = p.id; step.created++;
          }
        } else {
          const p = catalog.get(pid)!;
          const createdNow = p.created_at >= cursor.startedAt;
          if (createdNow) {
            // Bu aktarımda başka pazaryerinden eklendi: stokları birleştir (sıfır olmayan en düşük)
            const merged = mergeStock(p.total_stock, stock);
            if (merged !== p.total_stock) {
              await db().from('products').update({ total_stock: merged }).eq('id', pid);
              step.notes.push(`${p.sku}: stok ${label}'da ${stock}, diğerinde ${p.total_stock} → ortak stok ${merged}`);
              p.total_stock = merged;
            }
          } else if (stock !== p.total_stock && !linkedIds.has(pid)) {
            step.notes.push(`${p.sku}: ${label}'da stok ${stock}, panelde ${p.total_stock} → panel değeri ${label}'a gönderilecek`);
          }
          // Eksik bilgileri tamamla (var olanı ezmeden)
          const fill: Record<string, unknown> = {};
          if (!p.description && rp.description) fill.description = rp.description;
          if (!(p.images?.length) && rp.images?.length) { fill.images = rp.images; fill.image_url = rp.images[0]; }
          if (Object.keys(fill).length) await db().from('products').update(fill).eq('id', pid);
        }
        const p = catalog.get(pid!)!;
        if (linkedIds.has(pid!)) {
          await db().from('marketplace_listings').update({ external_product_id: rp.externalId || null, last_synced_at: new Date().toISOString() })
            .eq('product_id', pid).eq('marketplace_name', mp).is('external_product_id', null);
          step.already++;
        } else {
          const priceDiff = rp.price && Math.abs(Number(rp.price) - Number(p.price)) > 0.009;
          const r = await db().from('marketplace_listings').upsert({
            product_id: pid, marketplace_name: mp, external_product_id: rp.externalId || null, listing_status: 'active',
            last_synced_at: new Date().toISOString(), last_pushed_stock: stock,
            // Pazaryerindeki fiyat farklıysa korunur (ortak fiyat onu ezmesin)
            price_override: priceDiff ? rp.price : null,
          }, { onConflict: 'product_id,marketplace_name' });
          if (r.error) throw new Error(r.error.message);
          linkedIds.add(pid!);
          step.linked++;
        }
      } catch (e) {
        step.errors.push(`${label} ${sku}: ${errorMessage(e)}`);
      }
    }
    await log('info', 'listing', mp, `${label}: ${remote.length} ürün kataloğa işlendi (sayfa ${cursor.page + 1}).`);
    if (remote.length < PAGE || cursor.page + 1 >= MAX_PAGES) { cursor.i++; cursor.page = 0; } else cursor.page++;
  }
  step.cursor = cursor.i < cursor.mps.length ? cursor : null;
  step.notes = step.notes.slice(0, 50);
  step.errors = step.errors.slice(0, 50);
  return step;
}

export const isImportCursor = (v: unknown): v is ImportCursor =>
  !!v && typeof v === 'object' && Array.isArray((v as ImportCursor).mps) && (v as ImportCursor).mps.every(isMarketplace)
  && Number.isInteger((v as ImportCursor).i) && Number.isInteger((v as ImportCursor).page) && typeof (v as ImportCursor).startedAt === 'string';
