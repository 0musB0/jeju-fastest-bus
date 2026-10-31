import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBusLocation, stopsAway } from './realtime.ts';

const item = (id: string, ord: number, plate = 'null') => `<item><plateNo>${plate}</plateNo><stationId>${id}</stationId><stationOrd>${ord}</stationOrd></item>`;
const xml = `<response><header><resultCode>00</resultCode></header><body><items>${[
  item('A', 1, '제주79아1111'), item('B', 2), item('C', 3, '제주79아3077'), item('D', 4), item('E', 5),
].join('')}</items></body></response>`;

test('버스 위치에서 우리 정류장까지 남은 정류장 수', () => {
  const r = parseBusLocation(xml);
  assert.ok(r.ok);
  assert.deepEqual(stopsAway(r.stops, 'E'), [2, 4]);
  assert.deepEqual(stopsAway(r.stops, 'B'), [1]); // 이미 지나간 버스(3번 정류장)는 빼고
  assert.equal(stopsAway(r.stops, 'Z'), null); // 노선에 없는 정류장 (방향이 반대인 정류장 포함)
  // 같은 정류장이 두 번 나와도 버스 한 대는 한 번만
  assert.deepEqual(stopsAway([...r.stops, { stationId: 'E', ord: 6, bus: false }], 'E'), [2, 4]);
});

test('결과 코드가 00이 아니면 오류 이유', () => {
  assert.equal(parseBusLocation('<response><header><resultCode>99</resultCode></header></response>').ok, false);
  assert.equal(parseBusLocation('<html>오류</html>').ok, false);
});

import { applyRealtime, realtimeKeys, directToRoutes } from './realtime.ts';
import type { Route } from './odsay.ts';

const route: Route = {
  candidate: { legs: [{ walkBeforeMin: 3, rideMin: 12 }], walkAfterMin: 2 },
  rides: [{ busNos: ['365', '465'], routeIds: ['405136501', '405146501'], stationId: '405000153', from: '공항', to: '시청', stops: 4 }],
  fare: 1150, odsayMin: 17,
};

test('실시간 쌍과 분 변환: 두 노선을 합쳐 가까운 순, 정류장당 3분', () => {
  assert.deepEqual(realtimeKeys([route]), ['405136501:405000153', '405146501:405000153']);
  const r = applyRealtime(route, { '405136501:405000153': [5], '405146501:405000153': [2] });
  assert.deepEqual(r.candidate.legs[0].nextBusesMin, [6, 15]);
  assert.equal(applyRealtime(route, { '405136501:405000153': { error: 'x' } }), route);
  assert.equal(applyRealtime(route, { '405136501:405000153': [] }).noBusNow, true);
});

test('직행 후보: ODsay에 이미 있는 노선·정류장은 빼고 후보로 바꾼다', () => {
  const d = { routeId: '405136501', no: '365', heading: '시청', fromId: '405000153', fromName: '공항', toName: '시청', stops: 4, walkBeforeMin: 2.4, walkAfterMin: 1 };
  assert.equal(directToRoutes([d], [route]).length, 0);
  const [r] = directToRoutes([{ ...d, routeId: '405999999' }], [route]);
  assert.deepEqual(r.candidate, { legs: [{ walkBeforeMin: 2, rideMin: 8 }], walkAfterMin: 1 });
});
