// Mağaza ayrımı testi: db() her sorguya store_id filtresi ekliyor mu, eklemelere store_id yazıyor mu?
import assert from 'node:assert/strict';
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'http://127.0.0.1:9';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test';

async function main() {
const { db } = await import('../src/lib/supabase/server');
const { withStore } = await import('../src/lib/tenant');
type B = { url: URL; method: string; body?: unknown };
const peek = (b: unknown) => b as B;
const A = '11111111-1111-1111-1111-111111111111';

await withStore(A, async () => {
  const sel = peek(db().from('products').select('id').eq('sku', 'X'));
  assert.equal(sel.url.searchParams.get('store_id'), `eq.${A}`, 'select filtrelenmeli');

  const upd = peek(db().from('orders').update({ status: 'new' }).eq('id', 'o1'));
  assert.equal(upd.url.searchParams.get('store_id'), `eq.${A}`, 'update filtrelenmeli');

  const del = peek(db().from('ad_spend').delete().eq('id', 'a1'));
  assert.equal(del.url.searchParams.get('store_id'), `eq.${A}`, 'delete filtrelenmeli');

  const ins = peek(db().from('products').insert({ sku: 'X' }));
  assert.deepEqual(ins.body, { sku: 'X', store_id: A }, 'insert store_id yazmalı');

  const many = peek(db().from('sync_logs').insert([{ message: 'a' }, { message: 'b' }]));
  assert.deepEqual(many.body, [{ message: 'a', store_id: A }, { message: 'b', store_id: A }]);

  const ups = peek(db().from('app_settings').upsert({ key: 'k', value: 1 }));
  assert.equal(ups.url.searchParams.get('on_conflict'), 'store_id,key', 'app_settings upsert mağaza bazında');

  const ups2 = peek(db().from('marketplace_credentials').upsert({ marketplace_name: 'n11' }, { onConflict: 'marketplace_name' }));
  assert.equal(ups2.url.searchParams.get('on_conflict'), 'store_id,marketplace_name');

  const ups3 = peek(db().from('marketplace_listings').upsert({ product_id: 'p' }, { onConflict: 'product_id,marketplace_name' }));
  assert.equal(ups3.url.searchParams.get('on_conflict'), 'product_id,marketplace_name', 'mağazadan bağımsız tekil anahtar değişmemeli');

  const rpc = peek(db().rpc('apply_order', { p_marketplace: 'n11' }));
  assert.deepEqual(rpc.body, { p_marketplace: 'n11', p_store_id: A }, 'rpc mağaza parametresi almalı');

  const glob = peek(db().from('marketplaces').select('name'));
  assert.equal(glob.url.searchParams.get('store_id'), null, 'ortak tablo filtrelenmemeli');
});

assert.throws(() => db(), /Mağaza bağlamı yok/, 'oturumsuz db() hata vermeli');
console.log('tenant.test.ts: tüm kontroller geçti');
}
main().catch((e) => { console.error(e); process.exit(1); });
