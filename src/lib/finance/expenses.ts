// İşletme giderlerinin bir tarih aralığına düşen payı (saf fonksiyon; test edilebilir).
export interface ExpenseRow { category: string; amount: number; expense_date: string; monthly: boolean; end_date: string | null }

const day = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
const DAY = 86_400_000;

/**
 * Tek seferlik gider: tarihi aralıktaysa tamamı.
 * Aylık gider: aralıktaki her gün için (o ayın tutarı / ayın gün sayısı) — böylece "bu ay" ya da "son 7 gün" gibi
 * aralıklarda kira gibi giderler orantılı yansır.
 */
export function expenseShare(e: ExpenseRow, from: string, to: string): number {
  const a = day(from), b = day(to);
  if (!e.monthly) { const d = day(e.expense_date); return d >= a && d <= b ? Number(e.amount) : 0; }
  const start = Math.max(a, day(e.expense_date));
  const end = Math.min(b, e.end_date ? day(e.end_date) : b);
  let total = 0;
  for (let t = start; t <= end; t += DAY) {
    const d = new Date(t);
    const daysInMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    total += Number(e.amount) / daysInMonth;
  }
  return Math.round(total * 100) / 100;
}

export const EXPENSE_CATEGORIES = ['Kira', 'Personel', 'Muhasebe', 'Elektrik / su / internet', 'Yazılım / abonelik', 'Malzeme / hammadde', 'Kargo malzemesi', 'Vergi / harç', 'Diğer'] as const;
