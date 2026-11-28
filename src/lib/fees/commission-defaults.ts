// Varsayılan komisyon oranları (%) — kategoriye göre değişir; ürün bazında düzeltilmelidir
const BASE_DEFAULT_COMMISSION: Record<string, number> = {
  trendyol: 20, hepsiburada: 18, n11: 18, ciceksepeti: 20, pazarama: 17, idefix: 15, koctas: 15, etsy: 6.5,
};

/** İkinci mağaza (ör. trendyol_2) ana pazaryerinin değerini kullanır */
export const DEFAULT_COMMISSION: Record<string, number> = new Proxy(BASE_DEFAULT_COMMISSION, { get: (t, k) => (typeof k === 'string' ? t[k] ?? t[k.replace(/_2$/, '')] : undefined) });
