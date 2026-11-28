'use client';
import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { MARKETPLACES, MARKETPLACE_META, type MarketplaceName } from '@/lib/marketplaces/meta';
import { useLiveData } from './live';
import { useMarketplaceShortName } from './useMarketplaces';
import { Card, cx, tl, tl2 } from './ui';

interface Trend {
  distribution: Array<{ marketplace: MarketplaceName; revenue: number; share: number }>;
  monthly: Array<Record<string, number | string>>;
  daily: Array<Record<string, number | string>>;
}
const compact = (v: number) => new Intl.NumberFormat('tr-TR', { notation: 'compact', maximumFractionDigits: 1 }).format(v) + ' ₺';

/** Ciro trendi (pazaryeri/mağaza kırılımlı) ve bu ayın dağılımı — eskiden ana sayfadaydı, artık Kârlılık'ta */
export default function RevenueTrend() {
  const { data } = useLiveData<Trend>('/api/profit/trend');
  const name = useMarketplaceShortName();
  const [range, setRange] = useState<'monthly' | 'daily'>('monthly');
  if (!data) return null;
  const active = MARKETPLACES.filter((m) => [...data.monthly, ...data.daily].some((r) => Number(r[m] ?? 0) > 0));
  const dist = data.distribution.filter((d) => d.revenue > 0);
  const fmt = (v: number, n: string) => [tl2(v), name(n)] as [string, string];
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <Card className="lg:col-span-2 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h3 className="font-semibold">Ciro trendi</h3>
          <div className="inline-flex bg-slate-100 rounded-lg p-0.5 text-xs">
            {(['monthly', 'daily'] as const).map((r) => (
              <button key={r} onClick={() => setRange(r)} className={cx('px-3 py-1 rounded-md', range === r && 'bg-white shadow-sm')}>{r === 'monthly' ? 'Aylık (12 ay)' : 'Günlük (30 gün)'}</button>
            ))}
          </div>
        </div>
        <div className="h-60 sm:h-72">
          <ResponsiveContainer width="100%" height="100%">
            {range === 'monthly' ? (
              <BarChart data={data.monthly}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={compact} tick={{ fontSize: 11 }} width={56} />
                <Tooltip formatter={fmt} />
                <Legend formatter={(v: string) => name(v)} wrapperStyle={{ fontSize: 12 }} />
                {active.map((m) => <Bar key={m} dataKey={m} stackId="a" fill={MARKETPLACE_META[m].chart} />)}
              </BarChart>
            ) : (
              <LineChart data={data.daily}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={3} />
                <YAxis tickFormatter={compact} tick={{ fontSize: 11 }} width={56} />
                <Tooltip formatter={fmt} />
                <Legend formatter={(v: string) => name(v)} wrapperStyle={{ fontSize: 12 }} />
                {active.map((m) => <Line key={m} type="monotone" dataKey={m} stroke={MARKETPLACE_META[m].chart} strokeWidth={2} dot={false} />)}
              </LineChart>
            )}
          </ResponsiveContainer>
        </div>
      </Card>
      <Card className="p-5">
        <h3 className="font-semibold mb-3">Bu ayın ciro dağılımı</h3>
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={dist} dataKey="revenue" nameKey="marketplace" innerRadius="60%" outerRadius="90%" paddingAngle={2}>
                {dist.map((d) => <Cell key={d.marketplace} fill={MARKETPLACE_META[d.marketplace].chart} />)}
              </Pie>
              <Tooltip formatter={fmt} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <ul className="mt-4 space-y-1.5 text-xs sm:text-sm">
          {!dist.length && <p className="text-sm text-slate-500 text-center">Bu ay henüz satış yok.</p>}
          {dist.map((d) => (
            <li key={d.marketplace} className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: MARKETPLACE_META[d.marketplace].chart }} />
              <span className="flex-1 min-w-0 truncate">{name(d.marketplace)}</span>
              <span className="text-slate-500 whitespace-nowrap">{tl(d.revenue)}</span>
              <span className="w-12 shrink-0 text-right font-medium">%{(d.share * 100).toFixed(1)}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
