import assert from 'node:assert/strict';
import { parseRateText } from '../src/lib/fees/rates';
assert.deepEqual(parseRateText('Dosya;81,82\n1;81,82\n2;86,92\n5;102,88'), [81.82, 81.82, 86.92, 86.92, 86.92, 102.88]);
assert.deepEqual(parseRateText('88.96\n88.96\n97.87'), [88.96, 88.96, 97.87]);
assert.deepEqual(parseRateText('0\t1.234,50\n1\t1.300,00'), [1234.5, 1300]);
assert.throws(() => parseRateText('abc;def'));
console.log('✓ tarife ayrıştırıcı');
