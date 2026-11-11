import { test } from 'node:test';
import assert from 'node:assert/strict';
import { passed, riding, shift, walking, type Followed } from './follow.ts';
import { arrivalMin } from './eta.ts';

// 온평리 201(5분 뒤, 10분 탐) → 고성환승 212(걸어서 2분, 20분 탐) → 걸어서 3분
const ride = (no: string, id: string, st: string) => ({ busNos: [no], routeIds: [id], stationId: st, from: st, to: st, stops: 5 });
function route(): Followed {
  const candidate = { legs: [
    { walkBeforeMin: 2, nextBusesMin: [5], rideMin: 10, src: [[5, '405320112']] as [number, string][] },
    { walkBeforeMin: 2, timetableMin: [20], rideMin: 20, src: [[20, '405321202']] as [number, string][] },
  ], walkAfterMin: 3 };
  return { candidate, rides: [ride('201-12', '405320112', '406000001'), ride('212-2', '405321202', '406000002')], odsayMin: 0, fare: 1150, eta: arrivalMin(candidate) };
}
const T0 = 1_800_000_000_000, min = 60_000;

test('지나감: 곧 올 버스가 3분 넘게 늦어지면 지나간 것, 멀리 있는 버스가 늦어진 건 아님', () => {
  assert.equal(passed(101, 115, 100), true); // 1분 뒤 버스 → 15분 뒤로
  assert.equal(passed(110, 115, 100), false); // 10분 뒤 버스가 늦어짐 (지연)
  assert.equal(passed(101, 103, 100), false); // 2분 늦어짐은 어림 오차
});

test('walking: 누른 뒤 걸어간 만큼 첫 걷기를 줄임 (정류장에 닿으면 0)', () => {
  const r = route();
  assert.equal(walking(r, 1).candidate.legs[0].walkBeforeMin, 1);
  assert.equal(walking(r, 5).candidate.legs[0].walkBeforeMin, 0);
  assert.equal(walking(r, 5).candidate.legs[1].walkBeforeMin, 2); // 환승 걷기는 그대로
});

test('shift: 지난 시간만큼 남은 분과 탈 시각을 당김', () => {
  const r = shift(route(), 4);
  assert.equal(r.eta!.min, route().eta!.min - 4);
  assert.equal(r.eta!.boards[0].at, 1);
});

test('첫 버스 안: 남은 탑승 + 환승 버스는 새 실시간으로', () => {
  const r = route(); // 5분 뒤 201, 15분에 내림
  // 8분 뒤: 7분 더 타고, 걸어서 2분 → 9분에 정류장, 212 실시간 12분 뒤 (3분 여유 OK)
  const out = riding({ r, t: T0, k: 1 }, T0 + 8 * min, { '405321202:406000002': [6] }, {}, {});
  // 실시간 6정류장 × (20분/5정류장) = 24분 뒤 → 탑승 24 + 20 + 3
  assert.equal(out.rode, 1);
  assert.equal(out.eta!.boards[0].at, 0);
  assert.equal(out.eta!.min, 24 + 20 + 3);
});

test('환승 버스 안(k=2): 그 버스의 남은 시간 + 걷기만', () => {
  const r = route(); // 212를 20분에 타서 40분에 내림, 도착 43분
  const out = riding({ r, t: T0, k: 2 }, T0 + 30 * min, {}, {}, {});
  assert.equal(out.rode, 2);
  assert.equal(out.eta!.min, 10 + 3);
  assert.equal(out.eta!.boards.length, 2);
  assert.deepEqual(out.candidate.legs[1].src, [[0, '405321202']]); // 탄 버스 번호 유지
});

test('환승 버스 정보가 없으면 고정한 시각을 당겨서 씀', () => {
  const r = route();
  const out = riding({ r, t: T0, k: 1 }, T0 + 8 * min, {}, {}, {});
  assert.equal(out.eta!.min, r.eta!.min - 8);
});

test('환승 정류장에 내린 뒤: 남은 걷기만, 곧 오는 버스는 1분 여유로 탈 수 있음', () => {
  const r = route(); // 201에서 15분에 내림, 환승 걷기 2분
  // 18분 뒤: 내린 지 3분 → 이미 정류장. 212가 2분 뒤 (6정류장 × 4분이 아니라 0.5정류장 → 2분)
  const out = riding({ r, t: T0, k: 1 }, T0 + 18 * min, { '405321202:406000002': [0.5] }, {}, {});
  assert.equal(out.eta!.boards[1].at, 2);
  assert.equal(out.eta!.min, 2 + 20 + 3);
  assert.equal(out.candidate.legs[1].walkBeforeMin, 0);
});

test('마지막 버스에서 내린 뒤: 남은 걷기만', () => {
  const r = route(); // 212에서 40분에 내림, 걸어서 3분
  const out = riding({ r, t: T0, k: 2 }, T0 + 41 * min, {}, {}, {});
  assert.equal(out.eta!.min, 2);
});

// 내릴 정류장 키가 있는 경로 (구간마다 5정류장)
function routeEnd(): Followed {
  const r = route();
  return { ...r, rides: r.rides.map((x, i) => ({ ...x, endStationId: `40700000${i}` })) };
}

test('탄 버스가 늦으면 실제 위치로 남은 시간을 늘림', () => {
  const r = routeEnd(); // 212를 20분에 타서 시간표로는 40분에 내림 (5정류장 20분)
  // 38분 뒤: 시간표로는 2분 남았는데 내 버스는 아직 3정류장 남음, 뒤차는 5정류장 넘게 뒤
  const out = riding({ r, t: T0, k: 2 }, T0 + 38 * min, { '405321202:407000001': [3, 9] }, {}, {});
  assert.equal(out.eta!.min, 12 + 3); // 3정류장 × 4분 + 걷기 3
  assert.deepEqual(out.bus, { key: '405321202:407000001', left: 3 }); // 화면에 지금 위치를 보여줄 버스
});

test('시간표로는 내렸을 때인데 버스가 아직 오는 중이면 버스 안으로 봄', () => {
  const r = routeEnd();
  const out = riding({ r, t: T0, k: 2 }, T0 + 45 * min, { '405321202:407000001': [1] }, {}, {});
  assert.equal(out.eta!.min, 4 + 3);
});

test('내 버스가 이미 지나갔고 뒤차만 있으면 시간표대로 (뒤차를 내 버스로 오인하지 않음)', () => {
  const r = routeEnd();
  const out = riding({ r, t: T0, k: 2 }, T0 + 41 * min, { '405321202:407000001': [4] }, {}, {});
  assert.equal(out.eta!.min, 2);
});

import { onBus, pace, searchOrigin } from './follow.ts';
const A = { lat: 33.45, lng: 126.56 }, G = { lat: 33.5, lng: 126.6 };
test('searchOrigin: 탑승 전·위치 없음은 그대로, 탑승 후엔 내 위치', () => {
  assert.deepEqual(searchOrigin(false, false, G, A, A), A); // 직접 고른 출발지는 GPS가 있어도 고정
  assert.deepEqual(searchOrigin(true, false, G, A, { ...A, name: '제주대' }), { ...G, name: '제주대' }); // 탑승 뒤엔 내 위치
  assert.deepEqual(searchOrigin(true, false, undefined, A, A), A); // 위치 없으면 그대로
});
test('searchOrigin: "현재 위치" 출발은 탑승 전에도 GPS로 다시 잡고, 나쁘면·조금 움직였으면 이전 좌표', () => {
  const H = { ...A, name: '현재 위치' }, far = { lat: A.lat + 0.001, lng: A.lng }, near = { lat: A.lat + 0.0001, lng: A.lng };
  assert.deepEqual(searchOrigin(false, true, { ...far, acc: 10 }, A, H), { ...far, name: '현재 위치' }); // (a) 새 GPS
  assert.deepEqual(searchOrigin(false, true, { ...near, acc: 10 }, A, H), H); // (b) 30m 이내면 이전 좌표
  assert.deepEqual(searchOrigin(false, true, { ...far, acc: 300 }, A, H), H); // (c) 정확도 200m 초과면 이전 좌표
  assert.deepEqual(searchOrigin(false, true, undefined, A, H), H); // 위치를 못 읽으면 이전 좌표
  assert.deepEqual(searchOrigin(false, false, { ...far, acc: 10 }, A, { ...H, name: '제주대' }), { ...A, name: '제주대' }); // (d) 직접 고른 출발지는 고정
});
test('pace: 시간표보다 느리면 >1, 빠르면 <1, 상·하한, 정보 부족은 1', () => {
  const p = { key: 'a:b', left: 20, t: 0 };
  assert.equal(pace(p, { key: "a:b", left: 15, t: 10 * min }, 1), 1.5); // 5정류장에 10분 = 2배 → 상한 1.5
  assert.equal(pace(p, { key: 'a:b', left: 15, t: 6 * min }, 1), 1.2); // (c)
  assert.equal(pace(p, { key: 'a:b', left: 10, t: 5 * min }, 1), 0.8); // 하한
  assert.equal(pace(p, { key: 'x', left: 15, t: 10 * min }, 1), 1);
  assert.equal(pace(undefined, p, 1), 1);
  assert.equal(pace(p, { key: 'a:b', left: 20, t: 10 * min }, 1), 1);
});
test('onBus: 느린 버스(pace>1)는 남은 분이 늘어남', () => {
  const r = { busNos: ['1'], routeIds: ['R'], stationId: 's', endStationId: 'e', from: 's', to: 'e', stops: 10 } as never;
  const res = { 'R:e': [4] } as never;
  const base = onBus(r, 'R', 20, 10, res)!, slow = onBus(r, 'R', 20, 10, res, 1.25)!;
  assert.equal(base.min, 8);
  assert.equal(slow.min, 10);
});
