import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBusLocation, minsAway, stopsAway } from './realtime.ts';

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

import { applyRealtime, rideKeys, tripsToRoutes, headwayMin } from './realtime.ts';
import type { Route } from './odsay.ts';

const route: Route = {
  candidate: { legs: [{ walkBeforeMin: 3, rideMin: 12 }], walkAfterMin: 2 },
  rides: [{ busNos: ['365', '465'], routeIds: ['405136501', '405146501'], stationId: '405000153', from: '공항', to: '시청', stops: 4 }],
  fare: 1150, odsayMin: 17,
};

test('실시간 쌍과 분 변환: 두 노선을 합쳐 가까운 순, 정류장당 3분', () => {
  assert.deepEqual(rideKeys([route], true), ['405136501:405000153', '405146501:405000153']);
  const r = applyRealtime(route, { '405136501:405000153': [5], '405146501:405000153': [2] });
  assert.deepEqual(r.candidate.legs[0].nextBusesMin, [6, 15]);
  assert.deepEqual(applyRealtime(route, { '405136501:405000153': { error: 'x' } }), route);
  assert.equal(applyRealtime(route, { '405136501:405000153': [] }).noBusNow, true);
  // 시간표: 같은 구간 노선들의 시각을 합치고, 오늘 운행이 끝났으면 첫차 시각
  const t = applyRealtime(route, {}, {}, { scheduled: { '405136501:405000153': [30, 10], '405146501:405000153': [20] } });
  assert.deepEqual(t.candidate.legs[0].timetableMin, [10, 20, 30]);
  assert.equal(applyRealtime(route, {}, {}, { scheduled: {}, firstBus: { '405136501:405000153': 350, '405146501:405000153': 340 } }).firstBus, 340);
});

test('우리 후보: ODsay에 이미 있는 노선·정류장은 빼고 화면 후보로, 요금은 환승 규칙', () => {
  const pt = { lat: 33.5, lng: 126.5 };
  const l = { routeIds: ['405136501'], nos: ['365'], fromId: '405000153', fromName: '공항', toId: '405000154', toName: '시청', stops: 4, walkBeforeMin: 2.4, rideMin: 8, distM: 3000, fromPt: pt, toPt: pt, path: [] };
  const t = { legs: [l], walkAfterMin: 1, cost: 11 };
  assert.equal(tripsToRoutes([t], [route]).length, 0);
  const [r] = tripsToRoutes([{ ...t, legs: [{ ...l, routeIds: ['405999999'] }, { ...l, nos: ['101'], routeIds: ['405888888'], distM: 30000, walkBeforeMin: 3 }] }], [route]);
  assert.deepEqual(r.candidate, { legs: [{ walkBeforeMin: 2, rideMin: 8 }, { walkBeforeMin: 3, rideMin: 8 }], walkAfterMin: 1 });
  assert.equal(r.fare, 2400); // 365(1,150) → 급행 101 30km(2,400): 차액만
});

test('배차 간격: 노선 길이 × 정류장당 소요 ÷ 버스 수, 환승 구간에 채워진다', () => {
  const loc = Array.from({ length: 40 }, (_, i) => ({ bus: i % 10 === 0 }));
  assert.equal(headwayMin(loc), 15); // 40정류장 × 1.5분 ÷ 4대
  assert.equal(headwayMin([{ bus: false }]), undefined);
  const transfer: Route = { ...route, candidate: { legs: [route.candidate.legs[0], { walkBeforeMin: 1, rideMin: 5 }], walkAfterMin: 0 },
    rides: [route.rides[0], { busNos: ['500'], routeIds: ['405150001', '405150002'], stationId: '405000200', from: '시청', to: '노형', stops: 3 }] };
  assert.deepEqual(rideKeys([transfer], true), ['405136501:405000153', '405146501:405000153']);
  assert.deepEqual(rideKeys([transfer], false), ['405150001:405000200', '405150002:405000200']);
  const r = applyRealtime(transfer, { '405136501:405000153': [1] }, { '405150001': 20, '405150002': 20 });
  assert.equal(r.candidate.legs[1].intervalMin, 10); // 두 노선 합쳐 10분 간격
});

test('ODsay 구간의 노선이 그 정류장들에 안 서면 경로를 뺀다', async () => {
  const { onOurRoutes, stopKeys } = await import('./realtime.ts');
  const ride = { busNos: ['302', '301'], routeIds: ['405130201', '405130101'], stationId: 'A', endStationId: 'B', from: '', to: '', stops: 3 };
  const route = { candidate: { legs: [{ walkBeforeMin: 1, rideMin: 5 }], walkAfterMin: 1 }, rides: [ride], fare: 0, odsayMin: 7 };
  assert.deepEqual(stopKeys([route]), ['405130201:A:B', '405130101:A:B']);
  assert.equal(onOurRoutes(route, { '405130201:A:B': false, '405130101:A:B': true }), true); // 하나라도 서면 남김
  assert.equal(onOurRoutes(route, { '405130201:A:B': false, '405130101:A:B': false }), false);
  assert.equal(onOurRoutes(route, {}), true); // 확인 못 한 건 남김
});

test('우리 후보도 내릴 정류장 ID를 넘김 (탄 버스 위치를 내릴 정류장 기준으로 조회)', async () => {
  const { tripsToRoutes } = await import('./realtime.ts');
  const p = { lat: 33.5, lng: 126.5 };
  const leg = { routeIds: ['405329203'], nos: ['292-3'], fromId: '405000043', fromName: '남주동', toId: '405000099', toName: '신성마을', stops: 18, walkBeforeMin: 1, rideMin: 13, distM: 9000, fromPt: p, toPt: p, path: [] };
  const [r] = tripsToRoutes([{ legs: [leg], walkAfterMin: 13, cost: 0 } as never], []);
  assert.equal(r.rides[0].endStationId, '405000099');
});

test('버스가 오는 구간이 느리면 정류장 수 × 평균이 아니라 시간표 소요로 잰다 (182번: 4정류장 앞이 12분)', () => {
  const r = parseBusLocation(xml);
  assert.ok(r.ok);
  // 정류장 1~5의 기점 기준 소요: 앞 구간은 정류장당 3분, 뒤 구간은 1분
  const off = (o: number) => [0, 0, 3, 6, 9, 10][o];
  assert.deepEqual(minsAway(r.stops, 'E', off), [4, 10]); // 버스 C(3번): 10-6, 버스 A(1번): 10-0
  const rt = { ...route, rides: [{ ...route.rides[0], routeIds: ['405136501'], stops: 4 }] };
  // 정류장 수 기준(2정류장 × 12/4 = 6분)이 아니라 서버가 잰 분(4분)
  const got = applyRealtime(rt, { '405136501:405000153': [2] }, {}, { rtMin: { '405136501:405000153': [11] } });
  assert.deepEqual(got.candidate.legs[0].nextBusesMin, [11]);
  assert.deepEqual(applyRealtime(rt, { '405136501:405000153': [2] }).candidate.legs[0].nextBusesMin, [6]);
});
