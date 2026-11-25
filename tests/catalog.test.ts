// Pazaryeri ürünlerini tek katalogda birleştirme
import assert from 'node:assert/strict';
import { addToIndex, buildIndex, findMatch, mergeStock } from '../src/lib/sync/catalog-merge';

const idx = buildIndex([{ id: 'p1', sku: 'MUM-01', barcode: '8690000000011' }]);
assert.equal(findMatch(idx, { sku: 'farkli', barcode: '8690000000011' }), 'p1', 'aynı barkod');
assert.equal(findMatch(idx, { sku: ' mum-01 ', barcode: '' }), 'p1', 'barkod yok → SKU (büyük/küçük harf, boşluk önemsiz)');
assert.equal(findMatch(idx, { sku: 'X', barcode: 'MUM-01' }), 'p1', 'bir pazaryeri SKU\'yu barkod alanında tutuyorsa');
assert.equal(findMatch(idx, { sku: 'YENI', barcode: '869999' }), null);
addToIndex(idx, { id: 'p2', sku: 'YENI', barcode: '869999' });
assert.equal(findMatch(idx, { sku: 'YENI', barcode: '' }), 'p2', 'aynı çalışmada eklenen ürün de eşleşir');

assert.equal(mergeStock(5, 3), 3);
assert.equal(mergeStock(0, 7), 7, 'bir pazaryerinde 0/pasif olması diğerini sıfırlamaz');
assert.equal(mergeStock(4, 0), 4);
assert.equal(mergeStock(0, 0), 0);
console.log('catalog.test.ts: tüm kontroller geçti');
