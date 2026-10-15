import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHmac } from 'node:crypto';
import { createApp } from '../lib/app.js';
import { expenseInput, validDate } from '../lib/validation.js';

// Test-only repository: production always uses Neon; no fallback storage exists.
function testStore() {
  const rows = new Map();
  let attempts = 0;
  return {
    allowLogin: async () => ++attempts <= 10,
    list: async (month, date) => [...rows.values()].filter(r => r.date.startsWith(month) && (!date || r.date === date)),
    summary: async month => {
      const list = [...rows.values()].filter(r => r.date.startsWith(month));
      const sums = new Map();
      for (const row of list) { const s = sums.get(row.category) || { category: row.category, total: 0, count: 0 }; s.total += row.amount; s.count++; sums.set(row.category, s); }
      return { total: list.reduce((n, r) => n + r.amount, 0), count: list.length, categories: [...sums.values()] };
    },
    create: async data => { const row = { id: randomUUID(), ...data }; rows.set(row.id, row); return row; },
    update: async (id, data) => { if (!rows.has(id)) return undefined; const row = { id, ...data }; rows.set(id, row); return row; },
    remove: async id => rows.delete(id)
  };
}
async function fixture(t, options = {}) {
  const server = createApp({ password: 'test-password-only-123', store: testStore(), ...options }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  return async (path, method = 'GET', body, headers = {}) => {
    const res = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', 'X-Moa-Request': '1', Cookie: cookie, ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (res.headers.has('set-cookie')) cookie = res.headers.get('set-cookie').split(';')[0];
    return res;
  };
}
test('authentication, CRUD, date search and independent monthly totals', async t => {
  const request = await fixture(t);
  assert.equal((await request('/api/expenses?month=2026-10')).status, 401);
  assert.equal((await request('/api/login', 'POST', { password: 'wrong' })).status, 401);
  const login = await request('/api/login', 'POST', { password: 'test-password-only-123' });
  assert.equal(login.status, 200);
  assert.match(login.headers.get('set-cookie'), /HttpOnly/);
  assert.match(login.headers.get('set-cookie'), /SameSite=Strict/);
  const data = { date: '2026-10-15', title: '<script>alert(1)</script>', category: '식비', amount: 12000 };
  const first = await request('/api/expenses', 'POST', data); assert.equal(first.status, 201);
  const row = await first.json();
  await request('/api/expenses', 'POST', { ...data, date: '2026-10-16', amount: 3000 });
  await request('/api/expenses', 'POST', { ...data, date: '2026-09-01', amount: 9999 });
  const filtered = await (await request('/api/expenses?month=2026-10&date=2026-10-15')).json();
  assert.equal(filtered.expenses.length, 1);
  assert.equal(filtered.expenses[0].title, data.title);
  assert.equal((await (await request('/api/summary?month=2026-10')).json()).total, 15000);
  assert.equal((await request(`/api/expenses/${row.id}`, 'PUT', { ...data, category: '교통', amount: 5000 })).status, 200);
  const summary = await (await request('/api/summary?month=2026-10')).json();
  assert.equal(summary.total, 8000); assert.equal(summary.count, 2); assert.equal(summary.categories.length, 2);
  assert.equal((await request(`/api/expenses/${row.id}`, 'DELETE', {})).status, 204);
  assert.equal((await request(`/api/expenses/${row.id}`, 'DELETE', {})).status, 404);
  await request('/api/logout', 'POST', {});
  assert.equal((await request('/api/session')).status, 401);
});
test('invalid dates, amounts, categories, month filters and IDs are rejected', async t => {
  const request = await fixture(t);
  await request('/api/login', 'POST', { password: 'test-password-only-123' });
  const data = { date: '2026-10-15', title: '점심', category: '식비', amount: 5000 };
  for (const patch of [{ date: '2026-02-30' }, { amount: 0 }, { amount: 1.5 }, { amount: '5000' }, { amount: 1000000000 }, { title: ' ' }, { title: 'x'.repeat(101) }, { category: 'unknown' }]) {
    assert.equal((await request('/api/expenses', 'POST', { ...data, ...patch })).status, 400);
  }
  for (const path of ['/api/expenses?month=2026-13', '/api/expenses?month=2026-10&date=2026-09-01', '/api/expenses?month[]=2026-10', '/api/summary?month=bad']) assert.equal((await request(path)).status, 400);
  assert.equal((await request('/api/expenses/not-a-uuid', 'DELETE', {})).status, 400);
  assert.equal(validDate('2024-02-29'), true); assert.equal(validDate('2025-02-29'), false);
  assert.throws(() => expenseInput(null));
});
test('CSRF, tampering, expired sessions, secret files and rate limits', async t => {
  const request = await fixture(t);
  assert.equal((await request('/api/login', 'POST', { password: 'test-password-only-123' }, { 'X-Moa-Request': '' })).status, 403);
  assert.equal((await request('/api/login', 'POST', {}, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await request('/api/session', 'GET', undefined, { Cookie: 'moa_session=forged.fake' })).status, 401);
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() - 1000 })).toString('base64url');
  const signature = createHmac('sha256', 'test-password-only-123').update(payload).digest('base64url');
  assert.equal((await request('/api/session', 'GET', undefined, { Cookie: `moa_session=${payload}.${signature}` })).status, 401);
  for (const path of ['/.env', '/server.js', '/lib/store.js', '/package.json']) assert.equal((await request(path)).status, 404);
  for (let i = 0; i < 10; i++) assert.equal((await request('/api/login', 'POST', { password: 'wrong' })).status, 401);
  assert.equal((await request('/api/login', 'POST', { password: 'test-password-only-123' })).status, 429);
});
test('missing configuration and database failure expose no secrets', async t => {
  const unconfigured = await fixture(t, { store: undefined });
  assert.deepEqual(await (await unconfigured('/api/health')).json(), { configured: false });
  assert.equal((await unconfigured('/api/login', 'POST', { password: 'anything' })).status, 503);
  const broken = await fixture(t, { store: { allowLogin: async () => { throw new Error('postgresql://SECRET:password@private'); } } });
  const response = await broken('/api/login', 'POST', { password: 'anything' });
  assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /SECRET|postgresql/);
});
