import { test } from 'node:test';
import assert from 'node:assert/strict';
import { legFare, parseOdsay, routeFare } from './odsay.ts';

test('ODsay 경로를 걷기·버스 구간으로 바꾼다', () => {
  const r = parseOdsay({
    result: { path: [{ info: { payment: 1150, totalTime: 20 }, subPath: [
      { trafficType: 3, sectionTime: 4 },
      { trafficType: 2, sectionTime: 12, startName: '제주국제공항', endName: '제주시청', stationCount: 4, startLocalStationID: '405000153', lane: [{ busNo: '365', busLocalBlID: '405136501' }, { busNo: '465' }] },
      { trafficType: 3, sectionTime: 0, distance: 140 },
    ] }] },
  });
  assert.ok(r.ok);
  assert.deepEqual(r.routes[0].candidate, { legs: [{ walkBeforeMin: 4, rideMin: 12 }], walkAfterMin: 2 });
  assert.deepEqual(r.routes[0].rides[0].busNos, ['365', '465']);
  assert.deepEqual(r.routes[0].rides[0].routeIds, ['405136501', '']);
  assert.equal(r.routes[0].rides[0].stationId, '405000153');
  assert.equal(r.routes[0].fare, 1150);
});

test('ODsay 오류는 이유로 돌려준다', () => {
  assert.deepEqual(parseOdsay({ error: { code: '-98', msg: '검색 결과 없음' } }), { ok: false, reason: '경로 없음' });
  assert.equal(parseOdsay({ foo: 1 }).ok, false);
});

test('요금: 환승 2번까지는 가장 비싼 버스 요금만 (301 + 급행 101 = 3,000원)', () => {
  assert.equal(legFare('301', 15000), 1150);
  assert.equal(legFare('101', 18000), 2000);
  assert.equal(legFare('101', 27000), 2400);
  assert.equal(legFare('101', 60000), 3000);
  assert.equal(legFare('600', 10000), null);
  assert.equal(routeFare([1150, 3000], 4150), 3000);
  assert.equal(routeFare([1150, 1150, 1150, 1150], 4600), 2300); // 4번째 버스는 다시 냄
  assert.equal(routeFare([1150, null], 6650), 6650);
});
