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
