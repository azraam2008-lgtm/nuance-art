// Test için bellek içi sahte Supabase istemcisi (yalnızca katalog aktarımının kullandığı sorgular)
type Row = Record<string, any>;
export const tables: Record<string, Row[]> = {};
const UNIQUE: Record<string, string[][]> = { products: [['sku'], ['barcode']], marketplace_listings: [['product_id', 'marketplace_name']] };
let seq = 0;

class Q {
  private filters: Array<(r: Row) => boolean> = [];
  private op: 'select' | 'insert' | 'update' | 'upsert' = 'select';
  private payload: any = null; private conflict = ''; private one: 'single' | 'maybe' | null = null; private rng: [number, number] | null = null; private lim = Infinity;
  constructor(private t: string) { tables[t] ??= []; }
  select() { return this; }
  insert(rows: any) { this.op = 'insert'; this.payload = rows; return this; }
  upsert(rows: any, o?: { onConflict?: string }) { this.op = 'upsert'; this.payload = rows; this.conflict = o?.onConflict ?? ''; return this; }
  update(v: any) { this.op = 'update'; this.payload = v; return this; }
  eq(c: string, v: any) { this.filters.push((r) => r[c] === v); return this; }
  is(c: string, v: any) { this.filters.push((r) => (r[c] ?? null) === v); return this; }
  in(c: string, v: any[]) { this.filters.push((r) => v.includes(r[c])); return this; }
  or(expr: string) { const parts = expr.split(',').map((p) => { const [c, , ...v] = p.split('.'); return [c, v.join('.')]; }); this.filters.push((r) => parts.some(([c, v]) => String(r[c]) === v)); return this; }
  order() { return this; }
  range(a: number, b: number) { this.rng = [a, b]; return this; }
  limit(n: number) { this.lim = n; return this; }
  single() { this.one = 'single'; return this; }
  maybeSingle() { this.one = 'maybe'; return this; }
  private dup(r: Row, ignore?: Row) {
    return (UNIQUE[this.t] ?? []).some((cols) => tables[this.t].some((x) => x !== ignore && cols.every((c) => x[c] === r[c])));
  }
  private run(): { data: any; error: any } {
    const T = tables[this.t];
    const match = (r: Row) => this.filters.every((f) => f(r));
    let out: Row[] = [];
    if (this.op === 'insert') {
      for (const r of [].concat(this.payload)) {
        const row = { id: `id${++seq}`, created_at: new Date(Date.now() + seq).toISOString(), ...(r as Row) };
        if (this.dup(row)) return { data: null, error: { message: 'duplicate key', code: '23505' } };
        T.push(row); out.push(row);
      }
    } else if (this.op === 'upsert') {
      const cols = this.conflict.split(',');
      for (const r of [].concat(this.payload) as Row[]) {
        const ex = T.find((x) => cols.every((c) => x[c] === r[c]));
        if (ex) { Object.assign(ex, r); out.push(ex); } else { const row = { id: `id${++seq}`, created_at: new Date().toISOString(), ...r }; T.push(row); out.push(row); }
      }
    } else if (this.op === 'update') {
      for (const r of T.filter(match)) { Object.assign(r, this.payload); out.push(r); }
    } else {
      out = T.filter(match);
      if (this.rng) out = out.slice(this.rng[0], this.rng[1] + 1);
      out = out.slice(0, this.lim);
    }
    if (this.one) {
      if (!out.length) return this.one === 'single' ? { data: null, error: { message: 'no rows' } } : { data: null, error: null };
      return { data: { ...out[0] }, error: null };
    }
    return { data: out.map((r) => ({ ...r })), error: null };
  }
  then(ok?: any, bad?: any) { return Promise.resolve(this.run()).then(ok, bad); }
}
const client = { from: (t: string) => new Q(t), rpc: async () => ({ data: null, error: null }), storage: {}, storeId: 's1' };
export const db = () => client;
export const rawDb = () => client;
export function must<T>(res: { data: T | null; error: any }): T { if (res.error) throw new Error(res.error.message); return res.data as T; }
