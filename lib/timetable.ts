import { MIN_PER_STOP } from './config.ts';
// 시간표: bus.jeju.go.kr의 표(주요 정류장 몇 곳의 시각)를 BIS 노선(ID)별로 바꾸고, 정류장 도착 시각을 계산한다. 외부 호출 없음.
// 단순화: 평일·주말 구분 없이 하나의 시간표를 씀 (사이트 표가 대부분 요일 구분이 없음). 동절기 대체 행은 무시함.

// 노선별: p = [정류장 순번, 기준 정류장부터 걸리는 분, ...], t = 운행마다 기준 정류장 출발 시각(자정부터 분, 24시 넘으면 1440+)
export type Entry = { p: number[]; t: number[] };
export type Timetable = Record<string, Entry>;
export type Tab = { cols: string[]; rows: string[][] }; // cols[0]·rows[i][0]은 노선번호 열

export function parseTime(cell: string): number | null {
  const m = cell.match(/^(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

const norm = (s: string) =>
  s.replace(/[\s·.]/g, '').replace(/방향|방면/g, '').replace('로타리', '로터리').replace(/^제주터미널/, '제주버스터미널');
const split = (s: string) => {
  const m = s.match(/^([^(]*)\((.*)\)$/);
  return m ? [m[1], m[2]] : [s, ''];
};

// 표의 주요 정류장 이름(예: "제주터미널(노형로방향)", "공항(제주국제공항3(용담,시청))")이 BIS 정류장 이름과 같은 곳인지
// 단순화: 이름 포함 관계로 맞춤. 괄호 속 방향이 둘 다 있으면 그것도 맞아야 함
export function sameStop(col: string, stop: string): boolean {
  const c = norm(col), s = norm(stop);
  if (c === s) return true;
  const [cCore, cHint] = split(c), [sCore, sHint] = split(s);
  if (cHint.includes('(') && norm(cHint) === s) return true; // "공항(제주국제공항3(용담,시청))"
  const short = cCore.length < sCore.length ? cCore : sCore;
  if (short.length < 2 || !(sCore.includes(cCore) || cCore.includes(sCore))) return false;
  return !cHint || !sHint || cHint.includes('(') || sHint.includes(cHint) || cHint.includes(sHint);
}

// 표의 각 행 중 이 노선(정류장 이름 순서)의 운행인 것만 골라 [순번, 시각] 기준점 목록으로.
// 행의 시각이 있는 정류장이 모두 노선에 순서대로 있고, 노선 길이의 절반 이상을 덮고, 노선에 있는 정류장을 X(안 감)로 건너뛰지 않아야 함.
export function tripsFor(tab: Tab, stops: string[]): [number, number][][] {
  const cand = tab.cols.map((c, j) => (j === 0 ? [] : stops.flatMap((s, o) => (sameStop(c, s) ? [o] : []))));
  const trips: [number, number][][] = [];
  for (const row of tab.rows) {
    const anchors: [number, number][] = [];
    let ok = true, prevOrd = -1, prevMin = -1;
    for (let j = 1; j < row.length && ok; j++) {
      let min = parseTime(row[j] ?? '');
      if (min === null) continue;
      if (min < prevMin - 600) min += 1440; // 자정 넘김
      const ord = cand[j]?.find((o) => o > prevOrd);
      if (ord === undefined) ok = false;
      else anchors.push([ord, min]), (prevOrd = ord), (prevMin = min);
    }
    if (!ok || anchors.length < 2) continue;
    const lo = anchors[0][0], hi = anchors[anchors.length - 1][0];
    if (hi - lo < stops.length / 2) continue;
    // X(안 감)인 정류장이 노선에 있으면 다른 변형(일찍 끝나거나 늦게 시작)의 운행이다
    const skipped = row.some((v, j) => v === 'X' && cand[j]?.length);
    if (!skipped) trips.push(anchors);
  }
  return trips;
}

// 순번 → 기준 정류장부터 걸리는 분. 기준점 밖은 양 끝 기울기로 늘린다.
export function offsetAt(p: number[], ord: number): number {
  const n = p.length / 2;
  if (n === 1) return p[1] + (ord - p[0]) * MIN_PER_STOP;
  let i = 0;
  while (i < n - 2 && ord > p[2 * (i + 1)]) i++;
  const [o1, m1, o2, m2] = p.slice(2 * i, 2 * i + 4);
  return m1 + ((ord - o1) * (m2 - m1)) / (o2 - o1 || 1);
}

const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

// 운행 목록 → 노선 하나의 시간표. 가장 흔한 출발 순번을 기준으로 정류장별 소요의 중앙값을 쓴다.
export function buildEntry(trips: [number, number][][]): Entry | null {
  if (!trips.length) return null;
  const firsts = trips.map((t) => t[0][0]);
  const count = (f: number) => firsts.filter((g) => g === f).length;
  const ref = firsts.reduce((a, b) => (count(b) > count(a) ? b : a));
  const offs = new Map<number, number[]>();
  for (const t of trips.filter((t) => t[0][0] === ref)) for (const [o, m] of t) offs.set(o, [...(offs.get(o) ?? []), m - t[0][1]]);
  const p = [...offs].sort((a, b) => a[0] - b[0]).flatMap(([o, ms]) => [o, median(ms)]);
  const t = [...new Set(trips.map((tr) => Math.round(tr[0][1] - offsetAt(p, tr[0][0]))))].sort((a, b) => a - b);
  return { p, t };
}

// 지금(자정부터 분, KST)부터 horizon분 안에 이 정류장에 오는 버스들: 지금부터 몇 분 뒤인지
export function arrivals(e: Entry, ord: number, nowMin: number, horizon = 180): number[] {
  const off = offsetAt(e.p, ord);
  return e.t
    .flatMap((t) => [t - 1440, t, t + 1440].map((d) => d + off - nowMin))
    .filter((m) => m >= 0 && m <= horizon)
    .sort((a, b) => a - b);
}

// 이 정류장 첫차 시각 (자정부터 분)
export const firstAt = (e: Entry, ord: number) => (((Math.min(...e.t) + offsetAt(e.p, ord)) % 1440) + 1440) % 1440;

// KST 지금 = 자정부터 몇 분
export function kstMinutes(now: Date): number {
  const [h, m] = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .format(now)
    .split(':')
    .map(Number);
  return h * 60 + m;
}
