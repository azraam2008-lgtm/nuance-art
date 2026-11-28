// Pazaryeri başına seçilebilir kargo firmaları (istemci tarafında da kullanılır)
const BASE_CARRIERS_BY_MARKETPLACE: Record<string, string[]> = {
  trendyol: ['TEX', 'PTT', 'Aras', 'Sürat', 'Kolay Gelsin', 'DHL eCommerce', 'Yurtiçi', 'CEVA', 'Horoz'],
  hepsiburada: ['HepsiJET', 'Sürat', 'Aras', 'Yurtiçi', 'MNG', 'PTT'],
  n11: ['PTT', 'Aras', 'Sürat', 'Yurtiçi', 'Kolay Gelsin', 'DHL eCommerce'],
  ciceksepeti: ['Aras', 'Yurtiçi', 'Sürat', 'MNG', 'PTT'],
  pazarama: ['Aras', 'Sürat', 'PTT', 'DHL eCommerce', 'Kolay Gelsin', 'Yurtiçi'],
  idefix: ['Aras', 'Yurtiçi', 'Sürat', 'PTT', 'DHL eCommerce', 'Hepsijet'],
  koctas: ['Yurtiçi', 'MNG', 'Sendeo', 'Borusan', 'CEVA', 'Horoz'],
  etsy: ['PTT Global', 'DHL Express', 'UPS', 'FedEx'],
};

/** İkinci mağaza (ör. trendyol_2) ana pazaryerinin değerini kullanır */
export const CARRIERS_BY_MARKETPLACE: Record<string, string[]> = new Proxy(BASE_CARRIERS_BY_MARKETPLACE, { get: (t, k) => (typeof k === 'string' ? t[k] ?? t[k.replace(/_2$/, '')] : undefined) });
