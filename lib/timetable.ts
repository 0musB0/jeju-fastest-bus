import { MIN_PER_STOP, SLOW_M } from './config.ts';
// 시간표: bus.jeju.go.kr의 표(주요 정류장 몇 곳의 시각)를 BIS 노선(ID)별로 바꾸고, 정류장 도착 시각을 계산한다. 외부 호출 없음.
// 요일: 표 제목("평일", "토·공휴일")과 행 비고("토,공휴일 운행 안함", "…(평일)")로 운행마다 요일을 붙인다. 나머지는 매일 운행으로 봄. 동절기 대체 행은 무시함.

// 노선별: p = [정류장 순번, 기준 정류장부터 걸리는 분, ...], t = 운행마다 기준 정류장 출발 시각(자정부터 분, 24시 넘으면 1440+)
// m = 운행마다 요일 (1 평일, 2 토요일, 4 일요일·공휴일 비트, 없으면 매일)
// s = 운행마다 출발 순번 (중간 정류장에서 출발하는 운행만 0보다 큼, 없으면 모두 기점 출발). 그 앞 정류장에는 서지 않는다
export type Entry = { p: number[]; t: number[]; m?: number[]; s?: number[]; n?: number }; // n = 시간표를 만들 때 노선의 정류장 수
export type Timetable = Record<string, Entry>;
// label = 사이트 탭 이름("(평일)삼화지구-…-하귀"). 요일은 경유 문구(way)가 아니라 여기에 적혀 있는 경우가 많다
export type Tab = { cols: string[]; rows: string[][]; way?: string; label?: string }; // "노선번호" 열이 있는 표도 있고 없는 표도 있다
export type Trip = [number, number][] & { m?: number }; // [순번, 시각] 기준점들, m = 요일
export const EVERY_DAY = 7, WEEKDAY = 1;

// 표 제목·행 글자 → 요일 비트
function dayMask(way: string, row: string[]): number {
  const w = way.replace(/<[^>]*>/g, '');
  let m = /평일/.test(w) ? WEEKDAY : /\(토요일\)/.test(w) ? 2 : /토|공휴|휴일|주말/.test(w) ? 6 : EVERY_DAY; // "(토요일)" 탭은 토요일만 (741번)
  const notes = row.join(' ').replace(/<[^>]*>/g, ' ');
  if (/(토|휴일|주말)[^\d]*(운행\s*안\s*함|미운행)/.test(notes) || /\(평일\)/.test(notes)) m &= WEEKDAY;
  return m || EVERY_DAY;
}

export function parseTime(cell: string): number | null {
  const m = cell.match(/^(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

const norm = (s: string) =>
  s.replace(/<[^>]*>/g, '').replace(/\(경유\)/g, '').replace(/[\s·.]/g, '').replace(/방향|방면/g, '').replace('로타리', '로터리').replace(/^(제주)?터미널/, '제주버스터미널')
    .replace(/초교/g, '초등학교').replace(/종점$/, '');
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
  if (!cHint && cCore.length >= 3 && sHint.includes(cCore)) return true; // "조천리사무소" ↔ "조천환승정류장(조천리사무소)"
  if (cHint.length >= 3 && (!sHint || sHint === '종점') && sCore.startsWith(cHint)) return true; // "도두동(도리초등학교)" ↔ "도리초등학교(종점)"
  const short = cCore.length < sCore.length ? cCore : sCore;
  if (short.length < 2 || !(sCore.includes(cCore) || cCore.includes(sCore))) return false;
  return !cHint || !sHint || cHint.includes('(') || sHint.includes(cHint) || cHint.includes(sHint);
}

// 표의 각 행 중 이 노선(정류장 이름 순서)의 운행인 것만 골라 [순번, 시각] 기준점 목록으로.
// 노선에 없는 이름의 시각은 건너뛴다: BIS 노선이 표의 노선을 토막 낸 것이 많고, 표의 이름이 줄임말("제주여중고")이라 못 맞추는 곳도 있다.
// 기준점이 노선 길이의 절반 이상을 덮고, 노선에 있는 정류장을 X(안 감)로 표시하지 않아야 한다.
// no = BIS 노선 번호("292-2"). 표에 노선번호 열이 있으면(한 표에 291·292·293이 섞임) 같은 번호의 행만 쓴다.
export function tripsFor(tab: Tab, stops: string[], no = '', loose = false): Trip[] {
  const noCol = tab.cols.findIndex((c) => /노선번호/.test(c));
  const base = no.split('-')[0];
  // 한 열에 맞는 정류장 이름이 여럿이면 다른 이름에 말을 덧붙인 이름은 뺀다(숫자 붙은 "공항3"·"동광환승정류장1"은 그대로) ("제주대" 열 → 제주대학교, 제주대학교병원 아님)
  const cand: (number[] | null)[] = tab.cols.map((c) => {
    if (/노선번호|구분|비\s*고/.test(c) || !c) return null;
    const hit = stops.flatMap((s, o) => (sameStop(c, s) ? [o] : []));
    const core = (o: number) => split(norm(stops[o]))[0];
    return hit.filter((o) => norm(c).includes(core(o)) || !hit.some((q) => core(q) !== core(o) && core(o).startsWith(core(q)) && !/^\d/.test(core(o).slice(core(q).length))));
  });
  const trips: Trip[] = [];
  for (const row of tab.rows) {
    const rowNo = noCol >= 0 ? (row[noCol] ?? '').match(/^(\d+)/)?.[1] : undefined;
    if (base && rowNo && rowNo !== base) continue;
    const anchors: Trip = [];
    let prevOrd = -1, prevMin = -1;
    for (let j = 0; j < row.length; j++) {
      if (!cand[j]) continue;
      let min = parseTime(row[j] ?? '');
      if (min === null) continue;
      if (min < prevMin - 600) min += 1440; // 자정 넘김
      prevMin = min;
      const ord = cand[j]!.find((o) => o > prevOrd);
      if (ord !== undefined) anchors.push([ord, min]), (prevOrd = ord);
    }
    if (anchors.length < 2) continue;
    const lo = anchors[0][0], hi = anchors[anchors.length - 1][0];
    if (hi - lo < stops.length / 2) continue;
    // X(안 감)인 정류장이 노선에 있으면 다른 변형(일찍 끝나거나 늦게 시작)의 운행이다
    // 단, 같은 정류장이 다른 열(예: "봉성"과 "봉성(경유)")에서 시각으로 나오면 그 X는 다른 경로 표시라 무시한다.
    // 행의 노선 번호가 이 노선과 같으면 X는 보지 않는다: 이미 번호로 골랐고, 표의 X와 BIS 정류장 이름이 자주 어긋난다
    // ("하가" X인데 노선에 "하가 입구", 652번 "월평마을" X인데 BIS 652에도 "월평마을"). 단순화: 같은 번호의 변형끼리는 운행이 섞일 수 있음
    const timed = new Set(row.flatMap((v, j) => (parseTime(v ?? '') !== null ? cand[j] ?? [] : [])));
    // "(경유)" 열에 시각이 있는데 그 경유지가 하나도 이 노선에 없으면 경유하는 다른 변형의 운행이다
    // ("봉성(경유)"처럼 다른 열과 같은 정류장에만 맞는 건 경유지로 치지 않음)
    // 경유 열의 ○도 그 경유지로 간다는 표시다
    const isVia = (j: number) => /경유/.test(tab.cols[j]) && (parseTime(row[j] ?? '') !== null || /^[○◯]$/.test((row[j] ?? '').trim()));
    const plain = new Set(row.flatMap((v, j) => (!/경유/.test(tab.cols[j]) && parseTime(v ?? '') !== null ? cand[j] ?? [] : [])));
    const viaCols = row.map((_, j) => j).filter(isVia);
    const exact = (j: number, o: number) => { const core = split(norm(stops[o]))[0], v = norm(tab.cols[j]).replace(/고$/, '고등학교'); return core === v || core.endsWith(v); };
    const viaOther = viaCols.length > 0 && !viaCols.some((j) => cand[j]?.some((o) => !plain.has(o) || (loose && exact(j, o))));
    // 표에서 첫 시각보다 뒤 열의 X가 노선의 출발점 앞 정류장에만 맞으면 순환 노선의 앞쪽이라 무시 (346번: 끝 열 "영주고" X ↔ 노선 0번 영주고)
    const firstCol = row.findIndex((v, j) => cand[j] && parseTime(v ?? '') !== null);
    const xHits = (j: number, o: number) => !timed.has(o) && (o > lo || j < firstCol);
    // 노선 종점 열이 X면 이 운행은 종점까지 안 간다. 번호가 같아도 거른다 (356번: 대부분 제주대까지, 등교 시간 2회만 영주고까지)
    const endX = row.some((v, j) => v === 'X' && cand[j]?.some((o) => o > hi && o >= stops.length - 2));
    // loose: 경유 열의 X는 이름이 그대로 맞는 정류장("한라수목원", "세화고"=세화고등학교)에만 적용한다.
    // "오조(경유)"는 오조리 마을 안쪽인데 201번 모든 변형의 "오조리 입구"에도 글자가 맞아서 X 때문에 운행이 거의 다 빠진다. 단순화: 경유 변형의 운행이 몇 분 차이로 섞일 수 있음
    // (이름이 그대로 맞으면 "세화" 열이 글자로 세화고등학교에 맞아 시각이 있어도 X를 따른다)
    const xStops = (j: number, o: number) => (loose && /경유/.test(tab.cols[j]) ? exact(j, o) && (o > lo || j < firstCol) : xHits(j, o));
    const skipped = endX || viaOther || (!(base && rowNo) && row.some((v, j) => v === 'X' && cand[j]?.some((o) => xStops(j, o))));
    const m = dayMask(`${tab.label ?? ''} ${tab.way ?? ''}`, row);
    if (m !== EVERY_DAY) anchors.m = m;
    if (!skipped) trips.push(anchors);
  }
  return trips;
}

// 순번 → 기준 정류장부터 걸리는 분. 기준점 밖은 기준점 전체의 평균 속도(정류장당 분)로 늘린다.
// 끝 구간 기울기로 늘리면 이름을 잘못 맞춘 짧은 구간 하나 때문에 정류장당 5분씩 붙었다 (212번 성산항 +148분, 실제 83분).
// 단순화: 기준점 밖 정류장 간격이 고르다고 봄
export function offsetAt(p: number[], ord: number): number {
  const n = p.length / 2;
  if (n === 1) return p[1] + (ord - p[0]) * MIN_PER_STOP;
  const rate = (p[2 * n - 1] - p[1]) / (p[2 * n - 2] - p[0] || 1);
  if (ord < p[0]) return p[1] - (p[0] - ord) * rate;
  if (ord > p[2 * n - 2]) return p[2 * n - 1] + (ord - p[2 * n - 2]) * rate;
  let i = 0;
  while (i < n - 2 && ord > p[2 * (i + 1)]) i++;
  const [o1, m1, o2, m2] = p.slice(2 * i, 2 * i + 4);
  return m1 + ((ord - o1) * (m2 - m1)) / (o2 - o1 || 1);
}

const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

// 운행 목록 → 노선 하나의 시간표. 가장 흔한 출발 순번을 기준으로 정류장별 소요의 중앙값을 쓴다.
// cum = 노선 정류장별 누적 거리(m, 정류장 사이 직선 합). 주면 기준 정류장 사이가 분당 1km(시속 60km)보다 빠른 곳을 거른다.
export function buildEntry(trips: Trip[], cum?: number[]): Entry | null {
  if (!trips.length) return null;
  const firsts = trips.map((t) => t[0][0]);
  const count = (f: number) => firsts.filter((g) => g === f).length;
  const ref = firsts.reduce((a, b) => (count(b) > count(a) ? b : a));
  const offs = new Map<number, number[]>();
  for (const t of trips.filter((t) => t[0][0] === ref)) for (const [o, m] of t) offs.set(o, [...(offs.get(o) ?? []), m - t[0][1]]);
  let p = [...offs].sort((a, b) => a[0] - b[0]).flatMap(([o, ms]) => [o, median(ms)]);
  // 이름이 같은 다른 정류장(예: 공항 → 서귀포 중앙로터리 40분)에 맞춘 기준점은 뒤쪽 점을 뺀다.
  // 단순화: 앞쪽 점이 틀린 경우는 못 가린다 (뒤가 줄줄이 빠져 노선 전체가 버려짐)
  for (let k = 2; cum && k < p.length; ) {
    if (cum[p[k]] - cum[p[k - 2]] > 1000 * Math.max(p[k + 1] - p[k - 1], 0.5)) p.splice(k, 2);
    else k += 2;
  }
  // 양 끝 기준점이 너무 느리면(분당 SLOW_M 미만, 4분 이상) 이름이 같은 다른 곳에 맞춘 것으로 보고 뺀다
  // (201번 "세화" 열 → 표선 세화2리사무소, 212번 "고성" 열 → 고성리 장만이동산). 빠진 쪽은 offsetAt이 평균 속도로 채운다
  const slow = (a: number, b: number) => cum && p[b + 1] - p[a + 1] >= 4 && cum[p[b]] - cum[p[a]] < SLOW_M * (p[b + 1] - p[a + 1]);
  while (p.length > 4 && slow(0, 2)) p.splice(0, 2), (p = p.map((v, i) => (i % 2 ? v - p[1] : v)));
  while (p.length > 4 && slow(p.length - 4, p.length - 2)) p.splice(-2, 2);
  // 이름을 잘못 맞춘 노선 거르기: 소요가 거꾸로 가거나 정류장당 0.5~6분(도심급행은 정류장이 드물어 4분을 넘음)을 벗어나면 버린다
  const n = p.length / 2, mins = p[2 * n - 1] - p[1], rate = mins / (p[2 * n - 2] - p[0] || 1);
  // 거리를 알면 평균 속도로(분당 100m~1km), 모르면 정류장당 0.5~6분. 정류장이 드문 급행(102번: 15정류장 55km 2시간)은 정류장당 8분이 넘는다
  const fit = cum ? (cum[p[2 * n - 2]] - cum[p[0]]) / (mins || 1) : 0;
  const ok = cum ? fit >= 100 && fit <= 1000 && rate >= 0.5 : rate >= 0.5 && rate <= 6;
  if (n < 2 || !ok || p.some((v, i) => i % 2 === 1 && i > 1 && v < p[i - 2])) return null;
  // 같은 시각 운행은 요일을 합친다
  // 기준 순번보다 뒤에서 시작하는 운행(표의 "노형성당 출발")은 출발 순번을 남긴다. 같은 시각이면 더 앞에서 출발하는 쪽
  const byTime = new Map<number, number>(), from = new Map<number, number>();
  for (const tr of trips) {
    const k = Math.round(tr[0][1] - offsetAt(p, tr[0][0]));
    byTime.set(k, (byTime.get(k) ?? 0) | (tr.m ?? EVERY_DAY));
    from.set(k, Math.min(from.get(k) ?? Infinity, tr[0][0] > ref ? tr[0][0] : 0));
  }
  const t = [...byTime.keys()].sort((a, b) => a - b), m = t.map((k) => byTime.get(k)!), s = t.map((k) => from.get(k)!);
  return { p, t, ...(m.some((x) => x !== EVERY_DAY) && { m }), ...(s.some((x) => x > 0) && { s }) };
}

// 이 정류장(ord)을 지나는 운행의 기점 시각들 (요일 day). 중간에서 출발하는 운행은 그 앞 정류장에서 빼다
export function departures(e: Entry, ord: number, day = EVERY_DAY): number[] {
  return e.t.filter((_, i) => ((e.m?.[i] ?? EVERY_DAY) & day) !== 0 && (e.s?.[i] ?? 0) <= ord);
}

// 지금(자정부터 분, KST)부터 horizon분 안에 이 정류장에 오는 버스들: 지금부터 몇 분 뒤인지
// day = 오늘 요일 비트. 단순화: 어제 출발해 자정을 넘긴 운행과 내일 운행도 오늘 요일로 거름.
export function arrivals(e: Entry, ord: number, nowMin: number, horizon = 180, day = EVERY_DAY): number[] {
  const off = offsetAt(e.p, ord);
  return departures(e, ord, day)
    .flatMap((t) => [t - 1440, t, t + 1440].map((d) => d + off - nowMin))
    .filter((m) => m >= 0 && m <= horizon)
    .sort((a, b) => a - b);
}

// 이 정류장 첫차 시각 (자정부터 분)
export function firstAt(e: Entry, ord: number, day = EVERY_DAY): number | undefined {
  const ts = departures(e, ord, day);
  return ts.length ? ((Math.round(Math.min(...ts) + offsetAt(e.p, ord)) % 1440) + 1440) % 1440 : undefined;
}

// 공휴일 (대체공휴일 포함). 매년 말에 다음 해를 더한다. 제헌절은 2026년부터 다시 공휴일(2027-07-17 토 → 19일 대체).
// ponytail: 손으로 적은 목록, 해가 바뀌면 갱신 필요 (공공 API는 data.go.kr 가입이 필요해 못 씀)
const HOLIDAYS = new Set([
  '2026-01-01', '2026-02-16', '2026-02-17', '2026-02-18', '2026-03-02', '2026-05-05', '2026-05-25', '2026-06-03', '2026-08-17',
  '2026-09-24', '2026-09-25', '2026-09-28', '2026-10-05', '2026-10-09', '2026-12-25',
  '2027-01-01', '2027-02-08', '2027-02-09', '2027-03-01', '2027-05-05', '2027-05-13', '2027-08-16', '2027-09-14', '2027-09-15',
  '2027-07-19', '2027-09-16', '2027-10-04', '2027-10-11', '2027-12-27',
]);
// KST 기준 요일 비트 (plusDays = 내일이면 1)
export function kstDay(now: Date, plusDays = 0): number {
  const d = new Date(now.getTime() + plusDays * 86_400_000);
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', weekday: 'short' }).format(d);
  return HOLIDAYS.has(ymd) || wd === 'Sun' ? 4 : wd === 'Sat' ? 2 : WEEKDAY;
}

// KST 지금 = 자정부터 몇 분
export function kstMinutes(now: Date): number {
  const [h, m] = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .format(now)
    .split(':')
    .map(Number);
  return h * 60 + m;
}
