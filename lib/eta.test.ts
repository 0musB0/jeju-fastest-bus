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
  assert.deepEqual(r, { min: 10 + 10 + 10, source: 'timetable' });
});

test('환승: 두 번째 버스는 실시간이 있어도 시간표 기준', () => {
  const r = arrivalMin({
    legs: [
      { walkBeforeMin: 2, nextBusesMin: [4], rideMin: 10 },
      { walkBeforeMin: 3, nextBusesMin: [18], intervalMin: 30, rideMin: 15 },
    ],
    walkAfterMin: 5,
  })!;
  // 4분 탑승 → 14분 하차 → 17분 환승 정류장 → 간격 절반 15분 대기 → 32분 탑승 → 47분 하차 → 52분 도착
  assert.deepEqual(r, { min: 52, source: 'timetable' });
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
  assert.deepEqual(r, { min: 46, source: 'timetable' });
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
