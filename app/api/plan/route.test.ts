import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GET } from './route.ts';
import { PLAN_RATE_PER_MIN } from '../../../lib/config.ts';

const data = <T>(n: string) => JSON.parse(readFileSync(`data/${n}`, 'utf8')) as T;
const stations = new Map(data<{ id: string; lat: number; lng: number }[]>('stations.json').map((s) => [s.id, s]));
const shapes = data<Record<string, unknown>>('shapes.json');
// 데이터가 달마다 바뀌므로 노선을 고정하지 않고 "정류장 10개 이상 + 모양 있음" 노선을 하나 고른다
const route = data<{ id: string; stops: string[] }[]>('routes.json').find((r) => r.stops.length >= 12 && shapes[r.id] && r.stops.every((s) => stations.has(s)))!;

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
let n = 0;
const call = (qs: string, headers: Record<string, string> = {}) => GET(new Request(`https://a.app/api/plan?${qs}`, { headers: { 'x-forwarded-for': `10.1.0.${++n}`, ...headers } }));
let busopenCalls = 0;
const allRoutes = data<{ id: string; stops: string[] }[]>('routes.json');
// 요청한 노선의 정류장을 순서대로 주고, 버스는 한 대도 없는 응답
const mockBusopen = () => {
  busopenCalls = 0;
  globalThis.fetch = (async (url: string) => {
    busopenCalls++;
    const stops = allRoutes.find((r) => r.id === new URL(url).searchParams.get('route'))?.stops ?? [];
    const items = stops.map((id, i) => `<item><plateNo>null</plateNo><stationId>${id}</stationId><stationOrd>${i + 1}</stationOrd></item>`).join('');
    return new Response(`<response><header><resultCode>00</resultCode></header><body><items>${items}</items></body></response>`);
  }) as typeof fetch;
};
const pt = (id: string) => `${stations.get(id)!.lat},${stations.get(id)!.lng}`;

test('막힌 요청: 다른 사이트 403, 너무 긴 쿼리 414', async () => {
  assert.equal((await call('q=1', { 'sec-fetch-site': 'cross-site' })).status, 403);
  assert.equal((await call(`q=${'1'.repeat(7000)}`)).status, 414);
});

test('같은 IP가 분당 상한을 넘으면 429', async () => {
  const ip = { 'x-forwarded-for': '10.9.9.9' };
  let last = 0;
  for (let i = 0; i <= PLAN_RATE_PER_MIN; i++) last = (await GET(new Request('https://a.app/api/plan?x=1', { headers: ip }))).status;
  assert.equal(last, 429);
});

test('이상한 ID·정류장은 무시하고 빈 결과', async () => {
  mockBusopen();
  const r = await call(`q=abc:xyz,123:456,${route.id}:999999999`);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.deepEqual(j.results, {});
  assert.equal(busopenCalls, 0); // 검증을 통과 못한 쌍으로는 busopen을 부르지 않는다
});

test('paths: 노선 모양 조각을 돌려주고, 범위 밖 정류장 수는 무시', async () => {
  const k = `${route.id}:${route.stops[0]}:5`;
  const j = await (await call(`paths=${k},${route.id}:${route.stops[0]}:99999,${route.id}:${route.stops[0]}:x`)).json();
  assert.ok(j.paths[k].length >= 2);
  assert.deepEqual(Object.keys(j.paths), [k]);
});

test('출발·도착 좌표로 우리 경로를 찾고, 같은 노선 위치는 15초 안에 다시 받지 않는다', async () => {
  mockBusopen();
  const qs = `from=${pt(route.stops[0])}&to=${pt(route.stops[10])}&lite=1`;
  const j = await (await call(qs)).json();
  assert.ok(j.trips.length > 0);
  assert.ok(j.trips.some((t: { legs: { routeIds: string[] }[] }) => t.legs.length === 1));
  assert.ok(Object.values(j.results).every((v) => Array.isArray(v))); // 실시간 조회는 됐고 오는 버스가 없다는 빈 배열
  const first = busopenCalls;
  assert.ok(first > 0 && first <= 16);
  await call(qs); // 다른 IP, 같은 노선들
  assert.equal(busopenCalls, first);
});

test('busopen이 실패하면 이유를 담고, 실패는 합치기 캐시에 남지 않아 다음 요청이 다시 부른다', async () => {
  // 앞 테스트의 성공 결과(15초 합치기)와 겹치지 않게 그 노선과 정류장을 공유하지 않는 노선을 고른다
  const other = allRoutes.find((r) => r.id !== route.id && r.stops.length >= 5 && !r.stops.some((s) => route.stops.includes(s)))!;
  const key = `${other.id}:${other.stops[2]}`;
  globalThis.fetch = (async () => { throw new Error('boom'); }) as typeof fetch;
  const j = await (await call(`q=${key}`)).json();
  assert.ok(typeof j.results[key]?.error === 'string');
  mockBusopen();
  const j2 = await (await call(`q=${key}`)).json();
  assert.ok(Array.isArray(j2.results[key]));
  assert.ok(busopenCalls > 0);
});

test('rtMin: busopen 1-based stationOrd를 timetable 0-based 인덱스로 맞춰 계산한다', async () => {
  const { offsetAt, rideFactor } = await import('../../../lib/timetable.ts');
  const tt = data<Record<string, { p: number[] }>>('timetable.json');
  const target = allRoutes.findLast((r) => r.id !== route.id && r.stops.length >= 8 && tt[r.id]?.p.length >= 4 && !r.stops.some((s) => route.stops.includes(s)))!;
  const busIdx = 1, stopIdx = 5;
  globalThis.fetch = (async () => {
    const items = target.stops.map((id, i) => `<item><plateNo>${i === busIdx ? '제주79아1234' : 'null'}</plateNo><stationId>${id}</stationId><stationOrd>${i + 1}</stationOrd></item>`).join('');
    return new Response(`<response><header><resultCode>00</resultCode></header><body><items>${items}</items></body></response>`);
  }) as typeof fetch;
  const key = `${target.id}:${target.stops[stopIdx]}`;
  const j = await (await call(`q=${key}`)).json();
  const expected = Math.round((offsetAt(tt[target.id].p, stopIdx) - offsetAt(tt[target.id].p, busIdx)) * rideFactor(new Date()) * 10) / 10;
  assert.deepEqual(j.rtMin[key], [expected]);
});
