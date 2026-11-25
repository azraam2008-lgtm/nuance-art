import { handle } from '@/lib/api';
import { db, must } from '@/lib/supabase/server';
import { isMarketplace, isOrderStatus, OPEN_STATUSES } from '@/lib/marketplaces/meta';

export const dynamic = 'force-dynamic';

// Tüm pazaryerlerinin siparişleri tek tabloda: pazaryeri / durum filtresi + arama + sayfalama
export const GET = handle(async (req: Request) => {
  const sp = new URL(req.url).searchParams;
  const marketplace = sp.get('marketplace');
  const status = sp.get('status');
  const q = (sp.get('q') ?? '').replace(/[,()%*\\]/g, ' ').trim();
  const page = Math.max(0, Number(sp.get('page') ?? 0));
  const pageSize = Math.min(200, Math.max(1, Number(sp.get('pageSize') ?? 50)));

  const late = sp.get('late') === '1';
  const now = new Date().toISOString();
  // Fatura tablosu henüz kurulmadıysa (schema.sql 9h çalıştırılmadı) siparişler yine de listelenir
  const build = async (inv: boolean) => {
    let query = db()
      .from('orders')
      .select(`id, external_order_id, marketplace_name, customer_name, total_amount, status, order_date, shipped_at, carrier, tracking_number, invoice_number, return_reason, items:order_items(sku, product_title, quantity, unit_price), cost:order_costs${late ? '!inner' : ''}(net_profit, status, margin_on_revenue, same_day_eligible, same_day_met, fast_eligible, fast_met, deadline)${inv ? ', invoice:invoices(status, invoice_number, last_error)' : ''}`, { count: 'exact' })
      .order('order_date', { ascending: false })
      .range(page * pageSize, page * pageSize + pageSize - 1);

    if (isMarketplace(marketplace)) query = query.eq('marketplace_name', marketplace);
    if (isOrderStatus(status)) query = query.eq('status', status);
    // Geciken: kargoya verilmemiş ve pazaryerinin kargoya teslim süresi (termin) geçmiş
    if (late) query = query.in('status', OPEN_STATUSES).is('shipped_at', null).lt('cost.deadline', now);
    if (q) {
      const items = must(await db().from('order_items').select('order_id').ilike('product_title', `%${q}%`).limit(500)) as Array<{ order_id: string }>;
      const ids = [...new Set(items.map((i) => i.order_id))];
      const conds = [`external_order_id.ilike.%${q}%`, `customer_name.ilike.%${q}%`];
      if (ids.length) conds.push(`id.in.(${ids.join(',')})`);
      query = query.or(conds.join(','));
    }
    return query;
  };
  let res = await (await build(true));
  if (res.error && /invoices/i.test(res.error.message)) res = await (await build(false));
  const { data, error, count } = res;
  if (error) throw new Error(error.message);
  const lateCount = (await db().from('orders').select('id, order_costs!inner(deadline)', { count: 'exact', head: true })
    .in('status', OPEN_STATUSES).is('shipped_at', null).lt('order_costs.deadline', now)).count ?? 0;
  return { orders: data, total: count ?? 0, page, pageSize, lateCount };
});
