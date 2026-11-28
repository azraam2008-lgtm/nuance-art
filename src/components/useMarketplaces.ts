'use client';
import { useEffect, useState } from 'react';
import { BASE_MARKETPLACES, isMarketplace, type MarketplaceName } from '@/lib/marketplaces/meta';

let cache: Promise<MarketplaceName[]> | null = null;
/** Filtre listeleri için: ana pazaryerleri + bu mağazaya eklenmiş ikinci mağazalar (trendyol_2…) */
export function useMarketplaces(): MarketplaceName[] {
  const [list, setList] = useState<MarketplaceName[]>([...BASE_MARKETPLACES]);
  useEffect(() => {
    cache ??= fetch('/api/credentials').then((r) => r.json()).then((d: { credentials?: Array<{ marketplace: string }> }) =>
      (d.credentials ?? []).map((c) => c.marketplace).filter(isMarketplace)).catch(() => { cache = null; return [...BASE_MARKETPLACES]; });
    let alive = true;
    cache.then((l) => { if (alive && l.length) setList(l); });
    return () => { alive = false; };
  }, []);
  return list;
}
