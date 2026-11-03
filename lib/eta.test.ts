import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arrivalMin, kstClock, kstClock12 } from './eta.ts';

const ride = 20, walkAfter = 3;

test('계획 문서 예시: 가까운 A보다 B가 17분 빠르다', () => {
  const a = arrivalMin({ legs: [{ walkBeforeMin: 2, nextBusesMin: [25], rideMin: ride }], walkAfterMin: walkAfter })!;
  const b = arrivalMin({ legs: [{ walkBeforeMin: 6, nextBusesMin: [8], rideMin: ride }], walkAfterMin: walkAfter })!;
  assert.equal(a.min - b.min, 17);
  assert.equal(b.min, 8 + ride + walkAfter); // 걷기와 대기는 더하지 않고 큰 값
  assert.equal(b.source, 'realtime');
});

test('놓치는 버스: 1분 여유 없이 닿으면 다음 버스를 탄다', () => {
  const r = arrivalMin({ legs: [{ walkBeforeMin: 5, nextBusesMin: [5, 17], rideMin: 10 }], walkAfterMin: 0 })!;
  assert.equal(r.min, 27);
});

test('실시간 버스가 모두 지나가면 배차 간격으로 채운다', () => {
  const r = arrivalMin({ legs: [{ walkBeforeMin: 10, nextBusesMin: [3], intervalMin: 20, rideMin: 10 }], walkAfterMin: 0 })!;
  assert.deepEqual({ min: r?.min, source: r?.source }, { min: 10 + 10 + 10, source: 'timetable' });
});

test('환승: 3분 여유 없이 오는 실시간 버스는 못 타고 다음 수단(배차 간격)으로', () => {
  const r = arrivalMin({
    legs: [
      { walkBeforeMin: 2, nextBusesMin: [4], rideMin: 10 },
      { walkBeforeMin: 3, nextBusesMin: [18], intervalMin: 30, rideMin: 15 },
    ],
    walkAfterMin: 5,
  })!;
  // 4분 탑승 → 14분 하차 → 17분 환승 정류장 → 간격 절반 15분 대기 → 32분 탑승 → 47분 하차 → 52분 도착
  assert.deepEqual({ min: r?.min, source: r?.source }, { min: 52, source: 'timetable' });
});

test('시간표: 실시간이 없으면 시간표의 다음 버스, 환승도 시간표 우선', () => {
  const r = arrivalMin({
    legs: [
      { walkBeforeMin: 5, timetableMin: [3, 12], intervalMin: 60, rideMin: 10 },
      { walkBeforeMin: 2, timetableMin: [20, 40], intervalMin: 10, rideMin: 5 },
    ],
    walkAfterMin: 1,
  })!;
  // 12분 버스(3분 버스는 놓침) → 22분 하차 → 24분 환승 정류장 → 40분 버스 → 45분 → 46분 도착
  assert.deepEqual({ min: r?.min, source: r?.source }, { min: 46, source: 'timetable' });
});

test('대기를 추정할 수 없으면 null', () => {
  assert.equal(arrivalMin({ legs: [{ walkBeforeMin: 2, rideMin: 10 }], walkAfterMin: 0 }), null);
});

test('자정 전후 KST: UTC 14:55는 KST 23:55, 20분 뒤는 00:15', () => {
  const now = new Date('2026-10-31T14:55:00Z');
  assert.equal(kstClock(now), '23:55');
  assert.equal(kstClock(now, 20), '00:15');
  assert.equal(kstClock12(now), '11:55 PM');
  assert.equal(kstClock12(now, 20), '12:15 AM');
});

test('환승: 앞 버스에서 내린 뒤 3분 안에 오는 버스는 못 탄다고 보고 다음 차로', () => {
  const c = { legs: [{ walkBeforeMin: 0, nextBusesMin: [5], rideMin: 10 }, { walkBeforeMin: 1, timetableMin: [17, 30], rideMin: 10 }], walkAfterMin: 0 };
  // 15분에 내려 16분에 정류장, 17분 버스는 여유 1분 → 30분 버스
  assert.equal(arrivalMin(c)?.min, 40);
});

test('환승 버스가 몇 분 뒤 오는지와 여유를 화면에 줄 수 있다', () => {
  const c = { legs: [{ walkBeforeMin: 0, nextBusesMin: [5], rideMin: 10 }, { walkBeforeMin: 1, timetableMin: [17, 30], rideMin: 10 }], walkAfterMin: 0 };
  assert.deepEqual(arrivalMin(c)?.boards, [{ at: 5, atStop: 0, how: 'realtime' }, { at: 30, atStop: 16, how: 'timetable' }]);
});

test('실시간이 기준: 시간표는 실시간에 안 보이는(아직 기점 출발 전) 버스에만', () => {
  const leg = { walkBeforeMin: 2, rideMin: 10, nextBusesMin: [25], pendingMin: [5, 40] };
  const r = arrivalMin({ legs: [leg], walkAfterMin: 1 })!;
  assert.equal(r.min, 16); // 기점에서 곧 출발할 5분 뒤 버스
  assert.equal(r.boards[0].how, 'timetable');
  // 시간표에 더 이른 버스가 있어도 이미 출발한(실시간에 보여야 할) 버스면 실시간을 믿는다
  const r2 = arrivalMin({ legs: [{ walkBeforeMin: 2, rideMin: 10, nextBusesMin: [25], timetableMin: [8, 30] }], walkAfterMin: 1 })!;
  assert.equal(r2.min, 36);
  assert.equal(r2.boards[0].how, 'realtime');
  // 실시간 버스를 못 타면 그 뒤 시간표 버스
  const r3 = arrivalMin({ legs: [{ walkBeforeMin: 5, rideMin: 10, nextBusesMin: [3], timetableMin: [3, 8, 30] }], walkAfterMin: 1 })!;
  assert.equal(r3.min, 19);
});

test('환승 버스도 실시간 버스가 있으면 그 버스를 탄다', () => {
  const c = { legs: [{ walkBeforeMin: 2, nextBusesMin: [5], rideMin: 10 }, { walkBeforeMin: 1, nextBusesMin: [10, 20], timetableMin: [150], rideMin: 20 }], walkAfterMin: 3 };
  const r = arrivalMin(c)!;
  // 15분에 내려 16분에 환승 정류장, 3분 여유 → 20분 뒤 실시간 버스 (시간표 150분 아님)
  assert.equal(r.boards[1].at, 20);
  assert.equal(r.boards[1].how, 'realtime');
  assert.equal(r.min, 43);
});

test('실시간상 오는 버스가 없으면 시간표 버스는 안 쓰고 아직 출발 안 한 버스만', () => {
  // 292번 남주동: 실시간 [] (방금 지나감), 시간표 2분 뒤(지나간 그 차)·142분 뒤(아직 기점 출발 전)
  const leg = { walkBeforeMin: 0, nextBusesMin: [], timetableMin: [2, 142], pendingMin: [142], rideMin: 13 };
  assert.equal(arrivalMin({ legs: [leg], walkAfterMin: 13 })!.boards[0].at, 142);
  // 실시간 조회 자체가 안 됐으면(nextBusesMin 없음) 시간표
  const { nextBusesMin, ...noLive } = leg;
  assert.equal(arrivalMin({ legs: [noLive], walkAfterMin: 13 })!.boards[0].at, 2);
});
