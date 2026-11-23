// Hangi hatalar otomatik tekrar denenir?
import assert from 'node:assert/strict';

async function main() {
  const { isRetryable } = await import('../src/lib/sync/job-log');
  assert.equal(isRetryable('HTTP 500 — Internal Server Error'), true);
  assert.equal(isRetryable('HTTP 503 — busy'), true);
  assert.equal(isRetryable('HTTP 429 — Too Many Requests'), true);
  assert.equal(isRetryable('Bağlantı hatası: Zaman aşımı'), true);
  assert.equal(isRetryable('HTTP 401 — Unauthorized'), false);
  assert.equal(isRetryable('HTTP 400 — kategori özelliği eksik'), false);
  assert.equal(isRetryable('Trendyol kategori ID ve marka ID gerekli'), false);
  console.log('jobs.test.ts: tüm kontroller geçti');
}
main().catch((e) => { console.error(e); process.exit(1); });
