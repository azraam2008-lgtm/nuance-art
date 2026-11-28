// Pazaryeri tarihleri: Türkiye saati doğru ana çevrilir
import assert from 'node:assert/strict';
import { parseMarketDate } from '../src/lib/marketplaces/http';

// Trendyol: 25.11.2026 14:30 Türkiye saati, "UTC gibi" milisaniye olarak gelir
const tyLocal = Date.UTC(2026, 10, 25, 14, 30);
assert.equal(parseMarketDate(tyLocal, { localEpoch: true }), '2026-11-25T11:30:00.000Z', 'Trendyol: 3 saat geri');
// Gerçek UTC milisaniye (Etsy, N11 gibi) olduğu gibi kalır
assert.equal(parseMarketDate(tyLocal), '2026-11-25T14:30:00.000Z');
// Saat dilimi yazmayan metin → Türkiye saati
assert.equal(parseMarketDate('2026-11-25T14:30:00'), '2026-11-25T11:30:00.000Z');
assert.equal(parseMarketDate('2026-11-25 14:30:00'), '2026-11-25T11:30:00.000Z');
assert.equal(parseMarketDate('25.11.2026 14:30'), '2026-11-25T11:30:00.000Z');
// Saat dilimi yazan metne dokunulmaz
assert.equal(parseMarketDate('2026-11-25T14:30:00Z'), '2026-11-25T14:30:00.000Z');
assert.equal(parseMarketDate('2026-11-25T14:30:00+03:00'), '2026-11-25T11:30:00.000Z');
// Saniye cinsinden sayı
assert.equal(parseMarketDate(1795000000), new Date(1795000000 * 1000).toISOString());
// Boş → yedek
assert.equal(parseMarketDate('', { fallback: 0 }), new Date(0).toISOString());
console.log('dates.test.ts: tüm kontroller geçti');
