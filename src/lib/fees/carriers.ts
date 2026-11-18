// Pazaryeri başına seçilebilir kargo firmaları (istemci tarafında da kullanılır)
export const CARRIERS_BY_MARKETPLACE: Record<string, string[]> = {
  trendyol: ['TEX', 'PTT', 'Aras', 'Sürat', 'Kolay Gelsin', 'DHL eCommerce', 'Yurtiçi', 'CEVA', 'Horoz'],
  hepsiburada: ['HepsiJET', 'Sürat', 'Aras', 'Yurtiçi', 'MNG', 'PTT'],
  n11: ['PTT', 'Aras', 'Sürat', 'Yurtiçi', 'Kolay Gelsin', 'DHL eCommerce'],
  ciceksepeti: ['Aras', 'Yurtiçi', 'Sürat', 'MNG', 'PTT'],
  pazarama: ['Aras', 'Sürat', 'PTT', 'DHL eCommerce', 'Kolay Gelsin', 'Yurtiçi'],
  idefix: ['Aras', 'Yurtiçi', 'Sürat', 'PTT', 'DHL eCommerce', 'Hepsijet'],
  koctas: ['Yurtiçi', 'MNG', 'Sendeo', 'Borusan', 'CEVA', 'Horoz'],
  etsy: ['PTT Global', 'DHL Express', 'UPS', 'FedEx'],
};
