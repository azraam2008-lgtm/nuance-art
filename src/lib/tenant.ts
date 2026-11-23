import 'server-only';
import { AsyncLocalStorage } from 'async_hooks';

/**
 * Çok mağazalı yapı: her istek tek bir mağazanın (store) bağlamında çalışır.
 * Oturumdaki kullanıcının mağazası burada tutulur; db() bu mağazaya göre otomatik filtreler.
 * Cron ve webhook gibi oturumsuz işler, her mağaza için withStore() ile ayrı ayrı çalışır.
 */
const als = new AsyncLocalStorage<{ storeId: string; userId?: string }>();

export function withStore<T>(storeId: string, fn: () => Promise<T>, userId?: string): Promise<T> {
  if (!storeId) throw new Error('Mağaza bilgisi eksik.');
  return als.run({ storeId, userId }, fn);
}

/** Oturumdaki kullanıcının kimliği (cron/webhook bağlamında yoktur) */
export function currentUserId(): string {
  const u = als.getStore()?.userId;
  if (!u) throw new Error('Oturum gerekli.');
  return u;
}

export function currentStoreId(): string {
  const s = als.getStore()?.storeId;
  if (!s) throw new Error('Mağaza bağlamı yok (oturum gerekli).');
  return s;
}

export function hasStore(): boolean {
  return !!als.getStore()?.storeId;
}
