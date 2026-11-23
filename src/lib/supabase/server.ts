import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { currentStoreId } from '@/lib/tenant';

let client: SupabaseClient | null = null;

/**
 * Ham sunucu istemcisi (service_role — RLS'i aşar, asla tarayıcıya gönderilmez).
 * Mağaza filtresi UYGULAMAZ: yalnızca kullanıcı/mağaza tabloları (app_users, stores…) ve
 * tüm mağazaları dolaşan işler (cron) için kullanın. Mağaza verisi için db() kullanın.
 */
export function rawDb(): SupabaseClient {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '').trim();
  if (!url || !key) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY ortam değişkenleri tanımlı olmalı (.env.local).');
  }
  client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

/** Her satırı bir mağazaya ait olan tablolar ve görünümler */
const TENANT_TABLES = new Set([
  'products', 'marketplace_listings', 'orders', 'order_items', 'stock_movements', 'marketplace_credentials',
  'sync_logs', 'fee_rules', 'carrier_rates', 'app_settings', 'order_costs', 'ad_spend',
  'v_stock_breakdown', 'v_daily_revenue',
]);
/** Mağaza parametresi (p_store_id) alan SQL fonksiyonları */
const TENANT_RPCS = new Set(['apply_order', 'set_order_status', 'adjust_stock', 'seed_demo_data']);

type Builder = ReturnType<SupabaseClient['from']>;
type Scoped = Pick<Builder, 'select' | 'insert' | 'upsert' | 'update' | 'delete'>;

/** Tekil anahtarı mağaza bazında olan tablolar: upsert çakışma sütunlarına store_id eklenir */
const STORE_UNIQUE: Record<string, string> = {
  app_settings: 'key', marketplace_credentials: 'marketplace_name', fee_rules: 'marketplace_name,effective_from', carrier_rates: 'rate_table,carrier,effective_from',
};
const scopeConflict = (table: string, opts?: { onConflict?: string }) => {
  if (!(table in STORE_UNIQUE)) return opts;
  const cols = opts?.onConflict || STORE_UNIQUE[table];
  return { ...opts, onConflict: cols.startsWith('store_id') ? cols : `store_id,${cols}` };
};

const addStore = <T,>(rows: T, sid: string): T =>
  (Array.isArray(rows) ? rows.map((r) => ({ ...r, store_id: sid })) : { ...(rows as object), store_id: sid }) as T;

/**
 * Mağazaya kapsamlı istemci: okuma/güncelleme/silme otomatik olarak "store_id = oturumdaki mağaza"
 * ile filtrelenir, eklemelere store_id yazılır. Böylece bir mağaza başka mağazanın verisini göremez.
 */
export function db() {
  const sid = currentStoreId();
  const base = rawDb();
  return {
    from(table: string): Scoped {
      const qb = base.from(table);
      if (!TENANT_TABLES.has(table)) return qb;
      return {
        select: ((cols?: string, opts?: Parameters<Builder['select']>[1]) => qb.select(cols, opts).eq('store_id', sid)) as Builder['select'],
        insert: ((rows: object, opts?: object) => qb.insert(addStore(rows, sid), opts)) as Builder['insert'],
        upsert: ((rows: object, opts?: { onConflict?: string }) => qb.upsert(addStore(rows, sid), scopeConflict(table, opts))) as Builder['upsert'],
        update: ((vals: object, opts?: object) => qb.update(vals, opts).eq('store_id', sid)) as Builder['update'],
        delete: ((opts?: object) => qb.delete(opts).eq('store_id', sid)) as Builder['delete'],
      };
    },
    rpc(fn: string, args: Record<string, unknown> = {}) {
      return base.rpc(fn, TENANT_RPCS.has(fn) ? { ...args, p_store_id: sid } : args);
    },
    get storage() {
      return base.storage;
    },
    storeId: sid,
  };
}

/** Supabase hatasını fırlatır, aksi halde veriyi döndürür */
export function must<T>(res: { data: T | null; error: { message: string; details?: string; hint?: string; code?: string } | null; status?: number }): T {
  if (res.error) {
    const e = res.error;
    throw new Error(e.message || e.details || e.hint || `Veritabanı hatası (${e.code ?? res.status ?? 'bilinmiyor'})`);
  }
  return res.data as T;
}
