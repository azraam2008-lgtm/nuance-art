import 'server-only';
import { AsyncLocalStorage } from 'async_hooks';

/**
 * Çok mağazalı yapı: her istek tek bir mağazanın (store) bağlamında çalışır.
 * Oturumdaki kullanıcının mağazası burada tutulur; db() bu mağazaya göre otomatik filtreler.
 * Cron ve webhook gibi oturumsuz işler, her mağaza için withStore() ile ayrı ayrı çalışır.
 */
export type Role = 'owner' | 'admin' | 'staff';
const als = new AsyncLocalStorage<{ storeId: string; userId?: string; role?: Role; userName?: string }>();

export function withStore<T>(storeId: string, fn: () => Promise<T>, userId?: string, user?: { role: Role; name: string }): Promise<T> {
  if (!storeId) throw new Error('Mağaza bilgisi eksik.');
  return als.run({ storeId, userId, role: user?.role, userName: user?.name }, fn);
}

/** Oturumdaki kullanıcının rolü (cron/webhook gibi sistem işlerinde "owner" yetkisiyle çalışılır) */
export function currentRole(): Role {
  return als.getStore()?.role ?? 'owner';
}
export function currentUserName(): string | null {
  return als.getStore()?.userName ?? null;
}
export function maybeUserId(): string | null {
  return als.getStore()?.userId ?? null;
}
/** Personel: maliyet, kâr, fiyat ve API anahtarlarını görmez/değiştiremez */
export const isStaff = () => currentRole() === 'staff';

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
