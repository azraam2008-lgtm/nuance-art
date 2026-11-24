import { handle, HttpError } from '@/lib/api';
import { db, must } from '@/lib/supabase/server';
import { extractLabel, type LabelInfo } from '@/lib/shipping/label';
import { isDemoStore } from '@/lib/demo';
import { audit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

interface Row {
  id: string; external_order_id: string; marketplace_name: string; customer_name: string; order_date: string; status: string;
  carrier: string | null; tracking_number: string | null; raw: unknown;
  items: Array<{ sku: string; product_title: string; quantity: number; product: { variant_attrs: Record<string, string> | null; image_url: string | null } | null }>;
}

/**
 * Kargo etiketi + sevk fişi verisi: seçilen siparişlerin kargo barkodu (pazaryerinden gelen takip numarası),
 * alıcı adı/adresi ve pakete girecek ürünler. Barkod pazaryeri verisinde yoksa açıkça "yok" döner.
 */
export const GET = handle(async (req: Request) => {
  const ids = (new URL(req.url).searchParams.get('ids') ?? '').split(',').filter((x) => /^[0-9a-f-]{36}$/i.test(x));
  if (!ids.length) throw new HttpError(400, 'Sipariş seçilmedi.');
  if (ids.length > 100) throw new HttpError(400, 'Tek seferde en fazla 100 etiket yazdırılabilir.');
  const rows = must(await db().from('orders')
    .select('id, external_order_id, marketplace_name, customer_name, order_date, status, carrier, tracking_number, raw, items:order_items(sku, product_title, quantity, product:products(variant_attrs, image_url))')
    .in('id', ids)) as unknown as Row[];
  const demo = await isDemoStore();
  const order = new Map(ids.map((id, i) => [id, i]));
  const labels = rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)).map((o) => {
    let label: LabelInfo = extractLabel(o.raw, { customerName: o.customer_name, trackingNumber: o.tracking_number, carrier: o.carrier });
    if (demo && label.source === 'none') {
      // Deneme mağazası: görünümü göstermek için örnek barkod ve adres (gerçek değildir)
      const digits = o.id.replace(/\D/g, '').padEnd(12, '7').slice(0, 12);
      label = { ...label, trackingNumber: `DEMO${digits}`, carrier: label.carrier ?? 'Örnek Kargo', address: label.address || 'Örnek Mah. Deneme Sok. No:1 — Kadıköy / İstanbul', source: 'marketplace' };
    }
    return {
      id: o.id, orderNo: o.external_order_id.split('/')[0], marketplace: o.marketplace_name, orderDate: o.order_date, status: o.status, label,
      items: o.items.map((i) => ({ sku: i.sku, title: i.product_title, quantity: i.quantity, variant: Object.values(i.product?.variant_attrs ?? {}).join(' / '), image: i.product?.image_url ?? null })),
    };
  });
  await audit('Kargo etiketi yazdırıldı', `${labels.length} sipariş`);
  return { labels, demo };
});
