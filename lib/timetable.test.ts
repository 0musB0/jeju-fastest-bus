import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arrivals, buildEntry, firstAt, kstDay, kstMinutes, offsetAt, parseTime, sameStop, tripsFor } from './timetable.ts';

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

test('요일: "토,공휴일 운행 안함" 행은 평일만, 평일 표는 평일만', () => {
  const t2 = { cols: ['제주버스터미널(노형로 방향)', '절물', '비고'], rows: [['06:00', '06:40', ''], ['07:00', '07:40', '토,공휴일<br>운행 안함']] };
  const s2 = ['제주버스터미널(노형로 방향)', ...Array.from({ length: 19 }, (_, i) => `x${i}`), '절물'];
  const e = buildEntry(tripsFor(t2, s2))!;
  assert.deepEqual(e.m, [7, 1]);
  assert.deepEqual(arrivals(e, 0, 300, 180, 1), [60, 120]); // 평일
  assert.deepEqual(arrivals(e, 0, 300, 180, 2), [60]); // 토요일
  assert.equal(buildEntry(tripsFor({ ...t2, way: '785 한림 → 한경<br>(토·공휴일)' }, s2))!.m?.[0], 6);
});

test('요일이 탭 이름에만 있으면(320 "(평일)…"/"(휴일)…") 탭 이름으로', () => {
  const t2 = { cols: ['제주버스터미널(노형로 방향)', '절물'], rows: [['06:00', '06:40']], way: '삼화지구→연북로→수산(하귀)' };
  const s2 = ['제주버스터미널(노형로 방향)', ...Array.from({ length: 19 }, (_, i) => `x${i}`), '절물'];
  assert.equal(buildEntry(tripsFor({ ...t2, label: '320 (평일)삼화지구-하귀' }, s2))!.m?.[0], 1);
  assert.equal(buildEntry(tripsFor({ ...t2, label: '320 (휴일)삼화지구-하귀' }, s2))!.m?.[0], 6);
  assert.equal(buildEntry(tripsFor({ ...t2, label: '741-1 (토요일)남원' }, s2))!.m?.[0], 2);
});

test('기준점 밖은 평균 속도로 늘리고, 너무 느린 끝 기준점은 뺀다 (212번 "고성" → 고성리 장만이동산)', () => {
  assert.equal(offsetAt([10, 0, 20, 20], 0), -20); // 평균 정류장당 2분
  assert.equal(Math.round(offsetAt([0, 0, 10, 10, 11, 15], 21)), 29); // 15 + 10정류장 × 15/11분 // 끝 구간(5분/정류장) 대신 평균
  const cum = Array.from({ length: 13 }, (_, k) => k * 400); cum[12] = cum[11] + 200; // 마지막 정류장은 200m인데 6분
  const e = buildEntry([[[0, 600], [11, 618], [12, 624]]], cum)!;
  assert.deepEqual(e.p, [0, 0, 11, 18]);
});

test('중간 정류장에서 출발하는 운행은 그 앞 정류장에 오지 않는다 (320 "노형성당 출발")', () => {
  const e = buildEntry([[[0, 600], [20, 640]], [[0, 660], [20, 700]], [[10, 734], [20, 754]]])!;
  assert.deepEqual(e.s, [0, 0, 10]);
  assert.deepEqual(arrivals(e, 0, 590, 300), [10, 70]); // 기점에는 2대
  assert.deepEqual(arrivals(e, 15, 590, 300), [40, 100, 154]); // 정류장당 2분, 3번째도 옴
});

test('KST 요일: 토요일 2, 일요일·공휴일 4, 평일 1', () => {
  assert.equal(kstDay(new Date('2026-10-31T03:00:00Z')), 2);
  assert.equal(kstDay(new Date('2026-10-31T16:00:00Z')), 4); // KST 11/1 일요일 01시
  assert.equal(kstDay(new Date('2026-12-25T03:00:00Z')), 4);
  assert.equal(kstDay(new Date('2026-10-31T03:00:00Z'), 2), 1); // 월요일
});

test('한 표에 여러 번호(291·292)가 섞이면 같은 번호의 행만, 경유 열의 X는 다른 경로 표시', () => {
  const t = {
    cols: ['노선번호', '제주버스터미널(노형로 방향)', '봉개동', '봉개동(경유)', '절물', '비고'],
    rows: [
      ['43-1번', '06:50', '07:42', 'X', '07:55', ''],
      ['44번', '07:00', '07:52', 'X', '08:05', ''],
    ],
  };
  assert.deepEqual(tripsFor(t, stops, '43-2').map((x) => x[0][1]), [410]);
  assert.deepEqual(tripsFor(t, stops, '44-1').map((x) => x[0][1]), [420]);
});

test('기준 정류장 사이가 시속 60km보다 빠르면(이름이 같은 먼 정류장에 맞춤) 그 점을 뺀다', () => {
  const cum = [0, 3000, 6000, 70000]; // 3번째 정류장은 70km 떨어짐
  const e = buildEntry([[[0, 600], [1, 606], [2, 612], [3, 640]]], cum)!;
  assert.deepEqual(e.p, [0, 0, 1, 6, 2, 12]);
});

test('노선 종점 열이 X인 운행은 번호가 같아도 그 노선에 붙이지 않는다 (356번 영주고는 등교 시간만)', () => {
  const t = { cols: ['노선번호', '수산', '보건소', '제주대', '영주고', '비고'], rows: [['356번', '06:23', '07:23', '07:46', '07:53', ''], ['356번', '07:00', '08:00', '08:23', 'X', '']] };
  const toYeongju = ['수산', 'a', '보건소', 'b', '제주대', '영주고'], toUniv = toYeongju.slice(0, 5);
  assert.equal(tripsFor(t, toYeongju, '356-3').length, 1);
  assert.equal(tripsFor(t, toUniv, '356-1').length, 2);
});

test('"제주대" 열은 제주대학교에 맞추고 제주대학교병원에는 맞추지 않는다 (302번 여중고 → 제주대 35분으로 나오던 문제)', () => {
  const t = { cols: ['공항', '제주시청', '제주대'], rows: [['07:00', '07:19', '07:38']] };
  const stops = ['공항', 'a', '제주시청', 'b', '제주대학교병원', '제주대학교'];
  assert.deepEqual(tripsFor(t, stops), [[[0, 420], [2, 439], [5, 458]]]);
});

test('loose: 글자만 겹치는 경유 열의 X는 무시하고, 이름이 그대로 맞는 경유 열의 X는 따른다 (201번 "오조(경유)")', () => {
  const t = { cols: ['터미널', '세화', '세화고(경유)', '오조(경유)', '성산'], rows: [['06:00', '06:30', 'X', 'X', '07:00'], ['06:20', '06:50', '○', 'X', '07:20']] };
  const plain = ['터미널', 'a', '세화리', '오조리 입구', '성산항'], viaSchool = ['터미널', 'a', '세화리', '세화고등학교', '오조리 입구', '성산항'];
  assert.equal(tripsFor(t, plain).length, 0); // 엄격: 오조 X 때문에 다 빠짐
  assert.deepEqual(tripsFor(t, plain, '', true).map((r) => r[0][1]), [360]);
  assert.deepEqual(tripsFor(t, viaSchool, '', true).map((r) => r[0][1]), [380]);
});
