import { handle, istanbulDate } from '@/lib/api';
import { db, must } from '@/lib/supabase/server';
import { MARKETPLACES, type MarketplaceName } from '@/lib/marketplaces/meta';

export const dynamic = 'force-dynamic';

type Row = { day: string; marketplace_name: MarketplaceName; revenue: number; order_count: number };
const r2 = (n: number) => Math.round(n * 100) / 100;
const zero = () => Object.fromEntries(MARKETPLACES.map((m) => [m, 0])) as Record<MarketplaceName, number>;

/** Ciro trendi (12 ay / 30 gün) ve bu ayın pazaryeri dağılımı — Kârlılık sayfasında (eskiden ana sayfadaydı) */
export const GET = handle(async () => {
  const today = istanbulDate();
  const [y, m] = today.split('-').map(Number);
  const monthKey = today.slice(0, 7);
  const from = new Date(Date.UTC(y, m - 1 - 11, 1)).toISOString().slice(0, 10);
  const rows = must(await db().from('v_daily_revenue').select('*').gte('day', from)) as Row[];

  const monthByMp = zero();
  for (const r of rows) if (r.day.slice(0, 7) === monthKey) monthByMp[r.marketplace_name] += Number(r.revenue);
  const monthRevenue = Object.values(monthByMp).reduce((a, b) => a + b, 0);

  const monthly: Array<Record<string, number | string>> = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    const key = d.toISOString().slice(0, 7);
    const entry: Record<string, number | string> = { key, label: d.toLocaleDateString('tr-TR', { month: 'short', year: '2-digit', timeZone: 'UTC' }), ...zero() };
    for (const r of rows) if (r.day.slice(0, 7) === key) entry[r.marketplace_name] = Number(entry[r.marketplace_name]) + Number(r.revenue);
    for (const mp of MARKETPLACES) entry[mp] = r2(Number(entry[mp]));
    monthly.push(entry);
  }

  const daily: Array<Record<string, number | string>> = [];
  const base = new Date(`${today}T00:00:00Z`);
  for (let i = 29; i >= 0; i--) {
    const d = new Date(base.getTime() - i * 86_400_000);
    const key = d.toISOString().slice(0, 10);
    const entry: Record<string, number | string> = { key, label: `${key.slice(8, 10)}.${key.slice(5, 7)}`, ...zero() };
    for (const r of rows) if (r.day === key) entry[r.marketplace_name] = Number(entry[r.marketplace_name]) + Number(r.revenue);
    for (const mp of MARKETPLACES) entry[mp] = r2(Number(entry[mp]));
    daily.push(entry);
  }

  return {
    distribution: MARKETPLACES.map((mp) => ({ marketplace: mp, revenue: r2(monthByMp[mp]), share: monthRevenue ? monthByMp[mp] / monthRevenue : 0 })),
    monthly,
    daily,
  };
});
