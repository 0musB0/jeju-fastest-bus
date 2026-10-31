import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arrivals, buildEntry, firstAt, kstMinutes, parseTime, sameStop, tripsFor } from './timetable.ts';

test('시각 칸 읽기', () => {
  assert.equal(parseTime('5:50(출발)'), 350);
  assert.equal(parseTime('06:13'), 373);
  assert.equal(parseTime('X'), null);
  assert.equal(parseTime(''), null);
});

test('표의 정류장 이름 ↔ BIS 정류장 이름', () => {
  assert.ok(sameStop('제주터미널(노형로방향)', '제주버스터미널(노형로 방향)'));
  assert.ok(!sameStop('제주터미널(노형로방향)', '제주버스터미널(동광로 방향)'));
  assert.ok(sameStop('공항(제주국제공항3(용담,시청))', '제주국제공항3(용담,시청)'));
  assert.ok(sameStop('동문로타리', '동문로터리'));
  assert.ok(sameStop('하귀초교', '하귀초등학교'));
  assert.ok(sameStop('신사동종점', '신사동'));
  assert.ok(sameStop('조천리사무소', '조천환승정류장(조천리사무소)'));
  assert.ok(!sameStop('봉개동', '명도암 마을회관'));
});

// 43번 표 일부: 같은 표에 방향·변형이 섞여 있다
const tab = {
  cols: ['노선번호', '제주터미널(노형로방향)', '봉개동', '명도암', '절물', '비고'],
  rows: [
    ['43-1번', '06:50', '07:42', '07:49', '07:55', ''],
    ['43-1번', '08:40', '09:32', '09:39', '09:45', ''],
    ['43-2번', '09:10', '10:06', '10:13', '10:19', ''],
    ['43-1번', '20:10', '21:02', '21:09(종료)', 'X', ''], // 절물까지 안 감
  ],
};
// 노선: 터미널(0) … 봉개동(30) 명도암(31) 절물(32)
const stops = ['제주버스터미널(노형로 방향)', ...Array.from({ length: 29 }, (_, i) => `중간${i}`), '봉개동', '명도암 마을회관', '제주절물자연휴양림'];
stops[32] = '절물';

test('표 → 이 노선의 운행만 고르기 (X로 건너뛴 행 제외)', () => {
  const trips = tripsFor(tab, stops);
  assert.equal(trips.length, 3);
  assert.deepEqual(trips[0], [[0, 410], [30, 462], [31, 469], [32, 475]]);
  // 반대 방향 노선에는 맞지 않는다
  assert.equal(tripsFor(tab, [...stops].reverse()).length, 0);
});

test('정류장 도착 시각: 기준점 사이는 비례로', () => {
  const e = buildEntry(tripsFor(tab, stops))!;
  assert.deepEqual(e.t, [410, 520, 550]);
  // 순번 15는 터미널+26분(봉개동 52분의 절반). 지금 08:40이면 08:40 출발 → 09:06 = 26분 뒤, 09:10 출발 → 56분 뒤
  assert.deepEqual(arrivals(e, 15, 520), [26, 56]);
  assert.equal(firstAt(e, 0), 410);
});

test('이상한 시간표는 버린다 (정류장당 10분)', () => {
  assert.equal(buildEntry([[[0, 600], [10, 700]]]), null);
});

test('자정 넘김: 23:50 출발 운행은 00:10에 20분 뒤가 아니라 이미 지남, 다음 날 첫차는 남음', () => {
  const e = { p: [0, 0, 10, 20], t: [350, 1430] };
  assert.deepEqual(arrivals(e, 10, 5), [5]); // 23:50 출발 → 00:10 도착, 지금 00:05
  assert.deepEqual(arrivals(e, 0, 1435, 600), [355]); // 23:55 → 다음 날 05:50
});

test('KST 분: UTC 15:10은 KST 00:10', () => {
  assert.equal(kstMinutes(new Date('2026-10-31T15:10:00Z')), 10);
});
