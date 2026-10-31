import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOdsay } from './odsay.ts';

test('ODsay 경로를 걷기·버스 구간으로 바꾼다', () => {
  const r = parseOdsay({
    result: { path: [{ info: { payment: 1150, totalTime: 20 }, subPath: [
      { trafficType: 3, sectionTime: 4 },
      { trafficType: 2, sectionTime: 12, startName: '제주국제공항', endName: '제주시청', stationCount: 4, lane: [{ busNo: '365' }, { busNo: '465' }] },
      { trafficType: 3, sectionTime: 0, distance: 140 },
    ] }] },
  });
  assert.ok(r.ok);
  assert.deepEqual(r.routes[0].candidate, { legs: [{ walkBeforeMin: 4, rideMin: 12 }], walkAfterMin: 2 });
  assert.deepEqual(r.routes[0].rides[0].busNos, ['365', '465']);
  assert.equal(r.routes[0].fare, 1150);
});

test('ODsay 오류는 이유로 돌려준다', () => {
  assert.deepEqual(parseOdsay({ error: { code: '-98', msg: '검색 결과 없음' } }), { ok: false, reason: '경로 없음' });
  assert.equal(parseOdsay({ foo: 1 }).ok, false);
});
