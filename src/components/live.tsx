'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { browserClient } from '@/lib/supabase/browser';

/* ---------------------------------------------------------------
 * Canlı güncelleme: Supabase Realtime "panel" broadcast kanalı.
 * DB tetikleyicileri her değişiklikte yalnızca "refresh" sinyali yollar;
 * sayfalar bu sinyalde verilerini API'den yeniden çeker.
 * Realtime yapılandırılmamışsa 15 sn'lik yoklamaya düşer.
 * ------------------------------------------------------------- */

const LiveContext = createContext<{ version: number; connected: boolean; bump: () => void }>({ version: 0, connected: false, bump: () => {} });

export function LiveProvider({ children }: { children: ReactNode }) {
  const [version, setVersion] = useState(0);
  const [connected, setConnected] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const bump = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setVersion((v) => v + 1), 300); // ardışık sinyalleri birleştir
  }, []);

  useEffect(() => {
    const sb = browserClient();
    if (!sb) return;
    const channel = sb
      .channel('panel', { config: { broadcast: { self: false } } })
      .on('broadcast', { event: 'refresh' }, () => bump())
      .subscribe((status) => setConnected(status === 'SUBSCRIBED'));
    return () => { sb.removeChannel(channel); };
  }, [bump]);

  useEffect(() => {
    const id = setInterval(() => setVersion((v) => v + 1), connected ? 60_000 : 15_000);
    return () => clearInterval(id);
  }, [connected]);

  return <LiveContext.Provider value={{ version, connected, bump }}>{children}</LiveContext.Provider>;
}

export const useLive = () => useContext(LiveContext);

export async function api<T = unknown>(url: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(url, {
    method: init?.method ?? 'GET',
    headers: init?.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
  return data as T;
}

/** URL'deki veriyi çeker; canlı sinyal geldiğinde sessizce yeniler */
export function useLiveData<T>(url: string) {
  const { version } = useLive();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [local, setLocal] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api<T>(url)
      .then((d) => { if (!cancelled) { setData(d); setError(null); } })
      .catch((e: Error) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [url, version, local]);

  return { data, error, loading: loading && !data, reload: () => setLocal((v) => v + 1) };
}

/* ---------------- Toast ---------------- */
type Toast = { id: number; text: string; kind: 'ok' | 'warn' | 'err' };
const ToastContext = createContext<(text: string, kind?: Toast['kind']) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((text: string, kind: Toast['kind'] = 'ok') => {
    const id = Date.now() + Math.random();
    setItems((t) => [...t, { id, text, kind }]);
    setTimeout(() => setItems((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="fixed bottom-20 lg:bottom-4 left-3 right-3 sm:left-auto sm:right-4 z-[60] space-y-2 sm:max-w-sm">
        {items.map((t) => (
          <div key={t.id} className={`fade-in px-4 py-3 rounded-lg shadow-lg text-sm text-white ${t.kind === 'ok' ? 'bg-emerald-600' : t.kind === 'warn' ? 'bg-amber-600' : 'bg-rose-600'}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
export const useToast = () => useContext(ToastContext);
