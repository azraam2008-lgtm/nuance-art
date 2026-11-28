'use client';
import { useEffect, useState } from 'react';
import { BASE_MARKETPLACES, MARKETPLACE_META, isMarketplace, type MarketplaceName } from '@/lib/marketplaces/meta';

type Info = { list: MarketplaceName[]; names: Record<string, string> };
let cache: Promise<Info> | null = null;
const load = () => (cache ??= fetch('/api/credentials').then((r) => r.json()).then((d: { credentials?: Array<{ marketplace: string; extraConfig?: Record<string, unknown> }> }) => ({
  list: (d.credentials ?? []).map((c) => c.marketplace).filter(isMarketplace),
  names: Object.fromEntries((d.credentials ?? []).filter((c) => c.extraConfig?.accountName).map((c) => [c.marketplace, String(c.extraConfig!.accountName)])),
})).catch(() => { cache = null; return { list: [...BASE_MARKETPLACES], names: {} }; }));

function useInfo(): Info {
  const [info, setInfo] = useState<Info>({ list: [...BASE_MARKETPLACES], names: {} });
  useEffect(() => {
    let alive = true;
    load().then((i) => { if (alive && i.list.length) setInfo(i); });
    return () => { alive = false; };
  }, []);
  return info;
}
/** Filtre listeleri için: ana pazaryerleri + bu mağazaya eklenmiş ikinci mağazalar (trendyol_2…) */
export const useMarketplaces = (): MarketplaceName[] => useInfo().list;
/** Pazaryeri etiketi + kullanıcının verdiği mağaza adı: "Trendyol 2 · Berra Tekstil" */
export function useMarketplaceLabel(): (m: string) => string {
  const { names } = useInfo();
  return (m: string) => `${isMarketplace(m) ? MARKETPLACE_META[m].label : m}${names[m] ? ` · ${names[m]}` : ''}`;
}
