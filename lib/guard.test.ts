import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clientIp, guardRequest, originOk, rateLimited } from './guard.ts';

const h = (o: Record<string, string>) => new Headers(o);

test('Origin 검증: 같은 출처만 통과', () => {
  assert.ok(originOk(h({ 'sec-fetch-site': 'same-origin' })));
  assert.ok(!originOk(h({ 'sec-fetch-site': 'cross-site' })));
  assert.ok(originOk(h({ origin: 'https://a.app', host: 'a.app' })));
  assert.ok(!originOk(h({ origin: 'https://evil.com', host: 'a.app' })));
  assert.ok(!originOk(h({ origin: 'not a url', host: 'a.app' })));
  assert.ok(originOk(h({}))); // 헤더가 없으면(curl) 레이트리밋이 맡는다
});

test('레이트리밋: 한도를 넘으면 막고 1분 뒤 풀린다', () => {
  for (let i = 0; i < 3; i++) assert.ok(!rateLimited('t1', 3, 1000 + i));
  assert.ok(rateLimited('t1', 3, 1100));
  assert.ok(!rateLimited('t1', 3, 1000 + 61000));
  assert.ok(!rateLimited('t2', 3, 1100)); // 다른 키는 따로
});

test('clientIp: 첫 주소만', () => {
  assert.equal(clientIp(h({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' })), '1.2.3.4');
  assert.equal(clientIp(h({})), 'unknown');
});

test('guardRequest: 403 · 414 · 429, 정상은 null', async () => {
  const mk = (qs: string, headers: Record<string, string> = {}) => new Request(`https://a.app/api/x?${qs}`, { headers: { 'x-forwarded-for': '9.9.9.9', ...headers } });
  assert.equal(guardRequest(mk('a=1'), 'g', 2), null);
  assert.equal(guardRequest(mk('a=1', { 'sec-fetch-site': 'cross-site' }), 'g', 2)?.status, 403);
  assert.equal(guardRequest(mk(`a=${'x'.repeat(7000)}`), 'g', 2)?.status, 414);
  assert.equal(guardRequest(mk('a=1'), 'g', 2), null);
  const r = guardRequest(mk('a=1'), 'g', 2);
  assert.equal(r?.status, 429);
  assert.equal(r?.headers.get('retry-after'), '60');
});
