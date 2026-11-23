import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { GET } from './route.ts';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
// 호출마다 다른 IP라 레이트리밋에 안 걸린다
let n = 0;
const call = (qs: string, headers: Record<string, string> = {}) => GET(new Request(`https://a.app/api/search?${qs}`, { headers: { 'x-forwarded-for': `10.0.0.${++n}`, ...headers } }));
const kakao = (...bodies: unknown[]) => { let i = 0; globalThis.fetch = (async () => Response.json(bodies[Math.min(i++, bodies.length - 1)])) as typeof fetch; };

test('검색어 없음·51자는 400', async () => {
  process.env.KAKAO_REST_KEY = 'k';
  assert.equal((await call('q=')).status, 400);
  assert.equal((await call(`q=${'가'.repeat(51)}`)).status, 400);
});

test('다른 사이트에서 부르면 403', async () => {
  assert.equal((await call('q=a', { 'sec-fetch-site': 'cross-site' })).status, 403);
});

test('같은 IP가 분당 한도를 넘으면 429', async () => {
  process.env.KAKAO_REST_KEY = 'k';
  kakao({ documents: [] });
  const ip = { 'x-forwarded-for': '7.7.7.7' };
  let last = 0;
  for (let i = 0; i < 31; i++) last = (await GET(new Request('https://a.app/api/search?q=a', { headers: ip }))).status;
  assert.equal(last, 429);
});

test('카카오 키가 없으면 500', async () => {
  delete process.env.KAKAO_REST_KEY;
  assert.equal((await call('q=a')).status, 500);
});

test('좌표가 깨졌거나 제주 밖인 항목은 버린다', async () => {
  process.env.KAKAO_REST_KEY = 'k';
  kakao({ documents: [
    { place_name: '제주공항', road_address_name: '공항로 2', x: '126.49', y: '33.51' },
    { place_name: '빈좌표', x: '', y: 'abc' },
    { place_name: '서울', x: '126.97', y: '37.56' },
    { place_name: '', x: '126.5', y: '33.4' },
  ] });
  const r = await call('q=공항');
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).places, [{ name: '제주공항', address: '공항로 2', lat: 33.51, lng: 126.49 }]);
});

test('이름으로 없으면 주소 검색으로 찾는다', async () => {
  process.env.KAKAO_REST_KEY = 'k';
  kakao({ documents: [] }, { documents: [{ address_name: '제주 하귀', road_address: { address_name: '하귀로15길 47' }, x: '126.41', y: '33.47' }] });
  const r = await call('q=하귀로15길 47');
  assert.deepEqual((await r.json()).places, [{ name: '하귀로15길 47', address: '하귀로15길 47', lat: 33.47, lng: 126.41 }]);
});

test('카카오가 오류·이상한 응답이면 502, 응답이 없으면 504', async () => {
  process.env.KAKAO_REST_KEY = 'k';
  kakao({ errorType: 'AccessDeniedError' });
  assert.equal((await call('q=a')).status, 502);
  globalThis.fetch = (async () => { throw new Error('x'); }) as typeof fetch;
  assert.equal((await call('q=b')).status, 504);
});
