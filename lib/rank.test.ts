import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankRoutes } from './rank.ts';
import type { Route } from './odsay.ts';

// 버스 한 번 타는 ODsay 경로: 걷기 walk분, 타는 시간 ride분
const route = (id: string, st: string, walk: number, ride: number, odsayMin = 30): Route => ({
  candidate: { legs: [{ walkBeforeMin: walk, rideMin: ride }], walkAfterMin: 2 },
  rides: [{ busNos: [id], routeIds: [id], stationId: st, from: st, to: 'X', stops: 5, endStationId: 'x' }],
  fare: 1150, odsayMin,
});
const live = (k: string, mins: number[]) => ({ [k]: mins });

test('도착이 빠른 순으로 정렬: 가까워도 버스가 늦게 오면 뒤', () => {
  const a = route('111111111', 'S1', 2, 10), b = route('222222222', 'S2', 6, 10);
  // 결과 값은 남은 정류장 수, 서버가 시간표로 잰 분은 rtMin
  const { shown } = rankRoutes([a, b], [], { ...live('111111111:S1', [3]), ...live('222222222:S2', [1]) }, {}, { rtMin: { '111111111:S1': [25], '222222222:S2': [8] } }, 600);
  assert.deepEqual(shown.map((r) => r.rides[0].routeIds[0]), ['222222222', '111111111']);
  assert.equal(Math.round(shown[0].eta!.min), 8 + 10 + 2);
});

test('대기를 모르는 경로는 계산되는 경로가 있으면 뺀다', () => {
  const a = route('111111111', 'S1', 2, 10), b = route('222222222', 'S2', 2, 10);
  const { ranked, shown } = rankRoutes([a, b], [], live('111111111:S1', [5]), {}, {}, 600);
  assert.equal(ranked.length, 2);
  assert.deepEqual(shown.map((r) => r.rides[0].routeIds[0]), ['111111111']);
});

test('아무것도 계산되지 않으면 모두 남긴다 (이동 시간 순)', () => {
  const a = route('111111111', 'S1', 2, 10, 40), b = route('222222222', 'S2', 2, 10, 20);
  const { shown } = rankRoutes([a, b], [], {}, {}, {}, 600);
  assert.deepEqual(shown.map((r) => r.odsayMin), [20, 40]);
});

test('오늘 운행이 끝난 경로(첫차가 이미 지남)는 endedList로, shown에서는 뺀다', () => {
  const a = route('111111111', 'S1', 2, 10);
  const r = rankRoutes([a], [], {}, {}, { firstBus: { '111111111:S1': 300 } }, 600);
  assert.equal(r.shown.length, 0);
  assert.equal(r.endedList.length, 1);
  // 첫차가 아직 안 왔으면(새벽) 그대로 둔다
  assert.equal(rankRoutes([a], [], {}, {}, { firstBus: { '111111111:S1': 700 } }, 600).shown.length, 1);
});

test('같은 버스를 더 멀리서 타는 후보는 가까운 쪽이 더 빠르면 뺀다', () => {
  const near = route('111111111', 'S1', 2, 10), far = route('111111111', 'S9', 15, 10);
  const { shown } = rankRoutes([near, far], [], { ...live('111111111:S1', [5]), ...live('111111111:S9', [5]) }, {}, {}, 600);
  assert.deepEqual(shown.map((r) => r.rides[0].stationId), ['S1']);
});
