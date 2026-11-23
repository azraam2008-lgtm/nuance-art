import assert from 'node:assert/strict';
import { expenseShare } from '../src/lib/finance/expenses';

const rent = { category: 'Kira', amount: 3000, expense_date: '2026-01-01', monthly: true, end_date: null };
assert.equal(expenseShare(rent, '2026-11-01', '2026-11-30'), 3000, 'tam ay = aylık tutar');
assert.equal(expenseShare(rent, '2026-11-01', '2026-11-15'), 1500, 'yarım ay = yarısı');
assert.equal(expenseShare(rent, '2025-12-01', '2025-12-31'), 0, 'başlamadan önce yok');
assert.equal(expenseShare({ ...rent, end_date: '2026-06-30' }, '2026-07-01', '2026-07-31'), 0, 'bittikten sonra yok');
const once = { category: 'Diğer', amount: 500, expense_date: '2026-11-10', monthly: false, end_date: null };
assert.equal(expenseShare(once, '2026-11-01', '2026-11-30'), 500);
assert.equal(expenseShare(once, '2026-11-11', '2026-11-30'), 0);
console.log('expenses.test.ts: tüm kontroller geçti');
