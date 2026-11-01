import { NEAR_STOP_M, WALK_DETOUR, WALK_M_PER_MIN, MIN_PER_STOP, TRANSFER_M, TRANSFER_PENALTY_MIN, SHORT_HOP_M, WALK_NET_MAX_M } from './config.ts';
import type { Walker } from './walk.ts';

// 우리 데이터(정류장·노선 JSON)만으로 경로 후보를 찾는다: 직행 + 한 번 환승. ODsay 일일 한도와 상관없이 항상 돈다.
export type Station = { id: string; name: string; lat: number; lng: number };
export type BusRoute = { id: string; no: string; to: string; stops: string[] };
export type Pt = { lat: number; lng: number };
// walkPath = 이 정류장까지 걷는 길(첫 구간은 출발지에서), walkAfterPath = 내려서 목적지까지
export type TripLeg = { routeIds: string[]; nos: string[]; fromId: string; fromName: string; toId: string; toName: string; stops: number; walkBeforeMin: number; rideMin: number; distM: number; fromPt: Pt; toPt: Pt; path: Pt[]; walkPath?: Pt[] };
export type Trip = { legs: TripLeg[]; walkAfterMin: number; cost: number; walkAfterPath?: Pt[] };
// 노선의 i번째 → j번째 정류장 탑승 시간(분). 서버가 시간표로 채워 넘긴다.
// 노선 모양: p = [위도, 경도, ...], s = 정류장마다 p의 선분 번호(k → k+1), 못 맞추면 -1 (scripts/fetch-shapes.mjs)
export type Shapes = Record<string, { p: number[]; s: number[] }>;
export type RideMin = (route: BusRoute, i: number, j: number) => number;

// 버스 정보 시스템 노선 목록에는 종점 뒤에 다른 운행 계통의 정류장이 덧붙은 것이 있다
// (212-52: 제주버스터미널 종점 뒤에 제주대학교·제대아파트… 를 돌아 다시 터미널). 사이트의 노선 모양(shapes)이 지나지 않는
// 정류장이 5개 이상 이어지고 그 뒤에 모양이 다시 이어지면, 그 정류장들을 빈칸('')으로 바꾼다. 순번(시간표·모양의 기준)은 그대로 둔다.
// 종점: 모양을 벗어나기 직전 정류장 이름이 노선의 종점(to)과 같으면 2개 이상 벗어날 때 그 뒤를 끝까지 지운다 (900-1: 조천리 종점 뒤 국제여객선터미널까지).
// 단순화: 모양이 없는 노선과 종점 이름이 안 맞는 끝부분(모양이 덜 그려졌을 수 있음)은 그대로 둔다.
export function maskOffShape(routes: BusRoute[], shapes: Shapes, nameOf?: (id: string) => string | undefined, posOf?: (id: string) => Pt | undefined): BusRoute[] {
  return routes.map((r) => {
    const s = shapes[r.id]?.s;
    if (!s || s.length !== r.stops.length) return r;
    let stops = r.stops;
    for (let k = 1; k < s.length; ) {
      if (s[k] !== -1) { k++; continue; }
      let e = k;
      while (e < s.length && s[e] === -1) e++;
      // 끝에서 모양을 벗어나며 5km 넘게 건너뛰는 꼬리 (900-2: 김녕해수욕장 → 제주고등학교 → 한라수목원, 김녕에서 3분으로 계산됨)
      const a = posOf?.(r.stops[k - 1]), b = posOf?.(r.stops[k]);
      const jump = e === s.length && !!a && !!b && distM(a, b) > 5000;
      const tail = jump || (e - k >= 2 && nameOf?.(r.stops[k - 1]) === r.to); // 종점 다음부터 끝까지 (520-6: 등기소 종점 뒤 법환…중앙로터리)
      // 가운데를 지운 뒤 남은 끝 정류장들이 모두 앞에서 이미 지난 곳이면 같이 지운다 (212-51: 성산항(종점) … 꼬리 … 성산항입구, 성산항)
      const loopBack = e < s.length && r.stops.slice(e).every((id) => r.stops.slice(0, k).includes(id));
      if (tail || (e - k >= 5 && e < s.length && s[e] >= s[k - 1])) stops = stops.map((id, n) => (n >= k && (n < e || loopBack || tail) ? '' : id));
      k = e;
    }
    return stops === r.stops ? r : { ...r, stops };
  });
}

export function distM(a: Pt, b: Pt): number {
  const R = 6371000, rad = Math.PI / 180;
  const x = (b.lng - a.lng) * rad * Math.cos(((a.lat + b.lat) / 2) * rad);
  const y = (b.lat - a.lat) * rad;
  return Math.hypot(x, y) * R; // 제주 범위에서는 평면 근사로 충분
}
export const walkMin = (a: Pt, b: Pt) => (distM(a, b) * WALK_DETOUR) / WALK_M_PER_MIN;
const base = (no: string) => no.split('-')[0];
// 한 구간에 묶어도 되는 탑승 시간: 가장 빠른 노선의 1.2배 + 2분 이내
const similar = (m: number, best: number) => m <= best * 1.2 + 2;

// 정류장·노선 색인. 서버에서 한 번만 만든다.
export function indexData(stations: Station[], routes: BusRoute[], shapes: Shapes = {}) {
  const byId = new Map(stations.map((s) => [s.id, s]));
  const onStation = new Map<string, [BusRoute, number][]>();
  routes.forEach((r) => r.stops.forEach((sid, i) => onStation.set(sid, [...(onStation.get(sid) ?? []), [r, i]])));
  // 약 220m 격자: 근처 정류장 찾기
  const cell = (p: Pt) => `${Math.floor(p.lat / 0.002)}:${Math.floor(p.lng / 0.0024)}`;
  const grid = new Map<string, Station[]>();
  for (const s of stations) grid.set(cell(s), [...(grid.get(cell(s)) ?? []), s]);
  const memo = new Map<string, Station[]>();
  const near = (p: Pt, m: number) => {
    const id = (p as Station).id, mk = id && `${id}:${m}`;
    if (mk && memo.has(mk)) return memo.get(mk)!;
    const out: Station[] = [];
    const r = Math.ceil(m / 220), la = Math.floor(p.lat / 0.002), ln = Math.floor(p.lng / 0.0024);
    for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) for (const s of grid.get(`${la + a}:${ln + b}`) ?? []) if (distM(p, s) <= m) out.push(s);
    if (mk) memo.set(mk, out);
    return out;
  };
  // 노선별 누적 거리 (정류장 사이 직선 합)
  const cum = new Map(routes.map((r) => {
    const c = [0];
    for (let k = 1; k < r.stops.length; k++) { const a = byId.get(r.stops[k - 1]), b = byId.get(r.stops[k]); c.push(c[k - 1] + (a && b ? distM(a, b) : 0)); }
    return [r.id, c];
  }));
  return { byId, onStation, near, cum, shapes };
}
export type Index = ReturnType<typeof indexData>;

// 노선 i → j 정류장 사이 거리(m, 정류장을 이은 직선 합)
export const routeDist = (ix: Index, r: BusRoute, i: number, j: number) => { const c = ix.cum.get(r.id)!; return c[j] - c[i]; };
// 시간표가 없을 때: 정류장 수 × 평균 소요, 단 정류장이 드문 급행은 거리로 (시속 약 27km)
export const roughRide = (ix: Index, r: BusRoute, i: number, j: number) => Math.max((j - i) * MIN_PER_STOP, routeDist(ix, r, i, j) / 450);
const defaultRide: RideMin = (_r, i, j) => (j - i) * MIN_PER_STOP;

// 지도에 그릴 i → j 구간: 노선 모양(도로)이 있으면 그 조각, 없으면 정류장을 이은 선
export function legPath(ix: Index, r: BusRoute, i: number, j: number): Pt[] {
  const sh = ix.shapes[r.id], a = sh?.s[i] ?? -1, b = sh?.s[j] ?? -1;
  const s = ix.byId.get(r.stops[i]), e = ix.byId.get(r.stops[j]);
  // 노선 모양을 만든 뒤 노선 정류장이 바뀌었으면(갱신 일부 실패) 선분 번호가 어긋나므로 쓰지 않는다
  if (sh && sh.s.length === r.stops.length && s && e && a >= 0 && b >= a) {
    // 탈 정류장 → 그 뒤 도로 꺾이는 점들 → 내릴 정류장
    const out: Pt[] = [{ lat: s.lat, lng: s.lng }];
    for (let k = a + 1; k <= b; k++) out.push({ lat: sh.p[2 * k], lng: sh.p[2 * k + 1] });
    out.push({ lat: e.lat, lng: e.lng });
    return out;
  }
  return r.stops.slice(i, j + 1).flatMap((id) => { const p = ix.byId.get(id); return p ? [{ lat: p.lat, lng: p.lng }] : []; });
}

function leg(ix: Index, r: BusRoute, i: number, j: number, walkBeforeMin: number, ride: RideMin): TripLeg {
  const s = ix.byId.get(r.stops[i])!, e = ix.byId.get(r.stops[j])!;
  const path = legPath(ix, r, i, j);
  const d = routeDist(ix, r, i, j);
  return { routeIds: [r.id], nos: [r.no], fromId: s.id, fromName: s.name, toId: e.id, toName: e.name, stops: j - i, walkBeforeMin, rideMin: ride(r, i, j), distM: d, fromPt: { lat: s.lat, lng: s.lng }, toPt: { lat: e.lat, lng: e.lng }, path };
}

type Seg = { r: BusRoute; m: number; j: number }; // 노선 r의 m번째에서 타서 j번째에서 내림
type Tail = { cost: number; segs: Seg[] }; // 어떤 정류장에서 목적지까지: 탈 구간들과 비용(탑승·환승 걷기·대기 어림·마지막 걷기)

// 출발지 600m 안 정류장 → (환승 정류장 200m 안 갈아타기 2번까지) → 목적지 600m 안 정류장.
// 목적지 쪽에서 거꾸로 "이 정류장에서 몇 번 타면 닿는지"(tails)를 만든 뒤, 출발지에서 첫 버스를 타고 내릴 곳마다 이어 본다.
// 순위용 비용 = 걷기 + 탑승 + 환승 걷기 + 환승 대기 어림값. 실제 대기는 화면에서 실시간·시간표로 다시 계산한다.
// ponytail: 요청마다 전체를 훑어 0.2~0.7초. 느려지면 노선 쌍 환승표를 미리 만들어 둔다.
export function findTrips(from: Pt, to: Pt, ix: Index, ride: RideMin = defaultRide, max = 8, walker?: Walker): Trip[] {
  // 출발·도착 걷기: 걷는 길 데이터가 있으면 길 따라, 없거나 그 점이 길 데이터 밖이면 직선 × 배율
  const walkVia = (tree: ReturnType<Walker['tree']> | undefined, p: Pt, rev: boolean) => {
    const memo = new Map<string, { min: number; path: Pt[] }>();
    return (s: Station) => {
      if (memo.has(s.id)) return memo.get(s.id)!;
      const r = tree?.to(s);
      const w = r ? { min: r.m / WALK_M_PER_MIN, path: rev ? [...r.path].reverse() : r.path } : { min: walkMin(p, s), path: rev ? [s, p] : [p, s] };
      memo.set(s.id, w);
      return w;
    };
  };
  const walkFrom = walkVia(walker?.tree(from, WALK_NET_MAX_M), from, false);
  const walkTo = walkVia(walker?.tree(to, WALK_NET_MAX_M), to, true);
  const starts = ix.near(from, NEAR_STOP_M).filter((s) => !s.name.includes('하차전용') && isFinite(walkFrom(s).min));
  const endList = ix.near(to, NEAR_STOP_M).filter((s) => isFinite(walkTo(s).min)), ends = new Set(endList.map((s) => s.id));
  if (!starts.length || !ends.size) return [];
  const startIds = new Set(starts.map((s) => s.id));
  const pt = (id: string) => ix.byId.get(id)!;
  const bMemo = new Map<string, boolean>();
  const boardable = (id: string) => bMemo.get(id) ?? bMemo.set(id, boardable0(id)).get(id)!;
  const boardable0 = (id: string) => { const p = ix.byId.get(id); return !!p && !p.name.includes('하차전용') && distM(from, p) > NEAR_STOP_M; }; // 출발지에서 걸어갈 수 있으면 처음부터 거기서 탄다
  const firstStart = new Map<string, number>(); // 노선에서 출발지 근처 정류장이 처음 나오는 순번
  const passesStart = (r: BusRoute, m: number) => {
    if (!firstStart.has(r.id)) firstStart.set(r.id, r.stops.findIndex((id) => startIds.has(id)));
    const f = firstStart.get(r.id)!;
    return f >= 0 && f < m;
  }; // 출발지 근처에서 바로 탈 수 있는 노선
  // 정류장마다 노선 번호별 가장 좋은 tail
  // 비교 먼저, 더 좋을 때만 객체를 만든다 (여기가 가장 많이 도는 곳)
  const put = (map: Map<string, Map<string, Tail>>, id: string, r: BusRoute, cost: number, segs: () => Seg[]) => {
    let byBase = map.get(id);
    if (!byBase) map.set(id, (byBase = new Map()));
    const k = base(r.no);
    if ((byBase.get(k)?.cost ?? Infinity) > cost) byBase.set(k, { cost, segs: segs() });
  };

  // 버스 한 번으로 목적지까지
  const t1 = new Map<string, Map<string, Tail>>();
  for (const e of endList) for (const [r, j] of ix.onStation.get(e.id) ?? []) {
    const wa = walkTo(e).min;
    for (let m = 0; m < j; m++) if (!ends.has(r.stops[m]) && boardable(r.stops[m]) && !passesStart(r, m)) put(t1, r.stops[m], r, ride(r, m, j) + wa, () => [{ r, m, j }]);
  }
  // 버스 두 번으로 목적지까지: 노선 b의 n번째에서 내려 근처 정류장의 t1로 갈아탄다
  const t2 = new Map<string, Map<string, Tail>>();
  const via = new Map<string, { cost: number; tail: Tail; walk: number }[]>(); // 내릴 정류장 → 이어 탈 수 있는 t1들
  for (const [x, byBase] of t1) for (const y of ix.near(pt(x), TRANSFER_M)) {
    const w = walkMin(y, pt(x));
    for (const tail of byBase.values()) via.set(y.id, [...(via.get(y.id) ?? []), { cost: w + TRANSFER_PENALTY_MIN + tail.cost, tail, walk: w }]);
  }
  for (const [y, opts] of via) {
    opts.sort((p, q) => p.cost - q.cost);
    for (const [b, n] of ix.onStation.get(y) ?? []) {
      const opt = opts.find((o) => base(o.tail.segs[0].r.no) !== base(b.no));
      if (!opt) continue;
      for (let m = 0; m < n; m++) if (boardable(b.stops[m]) && !passesStart(b, m)) put(t2, b.stops[m], b, ride(b, m, n) + opt.cost, () => [{ r: b, m, j: n }, ...opt.tail.segs]);
    }
  }

  const best = new Map<string, Trip>(); // 같은 버스 번호 조합은 가장 빠른 것 하나
  const build = (segs: Seg[], w0: number, cost: number): Trip => {
    const legs = segs.map((g, n) => leg(ix, g.r, g.m, g.j, n ? walkMin(pt(segs[n - 1].r.stops[segs[n - 1].j]), pt(g.r.stops[g.m])) : w0, ride));
    legs[0].walkPath = walkFrom(pt(legs[0].fromId)).path; // 환승 걷기(200m 안)는 직선으로 둔다
    const end = walkTo(pt(legs.at(-1)!.toId));
    return { legs, walkAfterMin: end.min, walkAfterPath: end.path, cost };
  };
  // 버스 세 대 중 가운데를 한두 정류장만 타는 경로(예: 181 → 하례에서 531 1분 → 611)는 사람이 타지 않으니 뺀다.
  // 마지막 구간은 짧아도 남긴다: 목적지까지 그 버스밖에 없을 수 있다.
  const shortHop = (g: Seg) => routeDist(ix, g.r, g.m, g.j) < SHORT_HOP_M;
  const keep = (segs: Seg[], w0: number, cost: number) => {
    if (segs.slice(1, -1).some(shortHop)) return;
    const key = segs.map((g) => base(g.r.no)).join('>');
    if ((best.get(key)?.cost ?? Infinity) > cost) best.set(key, build(segs, w0, cost));
  };
  for (const s of starts) {
    const w0 = walkFrom(s).min;
    for (const [a, i] of ix.onStation.get(s.id) ?? []) {
      let last = a.stops.length;
      // 목적지 근처 정류장 중 타는 시간 + 걷는 시간이 가장 짧은 곳에서 내린다 (첫 정류장보다 한 정류장 더 가서 덜 걷는 게 빠를 때가 많음)
      let bestJ = -1, bestCost = Infinity;
      for (let j = i + 1; j < a.stops.length; j++) if (ends.has(a.stops[j])) {
        if (last === a.stops.length) last = j; // 목적지 근처에 닿기 전의 정류장에서만 갈아탄다
        const c = ride(a, i, j) + walkTo(pt(a.stops[j])).min;
        if (c < bestCost) (bestCost = c), (bestJ = j);
      }
      if (bestJ > 0) keep([{ r: a, m: i, j: bestJ }], w0, w0 + bestCost);
      for (let k = i + 1; k < last; k++) {
        const ks = ix.byId.get(a.stops[k]);
        if (!ks) continue;
        const rideA = ride(a, i, k);
        for (const t of ix.near(ks, TRANSFER_M)) {
          const wt = walkMin(ks, t);
          // 출발지에서 그 정류장까지 그냥 걷는 게 더 빠르면 짧게 타고 갈아타는 건 의미가 없다
          if (walkMin(from, t) <= w0 + rideA + wt + TRANSFER_PENALTY_MIN) continue;
          for (const tails of [t1.get(t.id), t2.get(t.id)]) for (const tail of tails?.values() ?? []) {
            if (tail.segs.some((g) => base(g.r.no) === base(a.no))) continue;
            keep([{ r: a, m: i, j: k }, ...tail.segs], w0, w0 + rideA + wt + TRANSFER_PENALTY_MIN + tail.cost);
          }
        }
      }
    }
  }
  // 같은 정류장에서 타고 내리는 후보(예: 300·301)는 하나로 합친다. ODsay의 lane처럼 "아무거나 먼저 오는 버스".
  const merged = new Map<string, Trip>();
  for (const t of [...best.values()].sort((x, y) => x.cost - y.cost)) {
    const key = t.legs.map((l) => `${l.fromId}>${l.toId}`).join('|');
    const o = merged.get(key);
    if (!o) merged.set(key, t);
    else t.legs.forEach((l, n) => { if (similar(l.rideMin, o.legs[n].rideMin)) l.routeIds.forEach((id, q) => { if (!o.legs[n].routeIds.includes(id)) o.legs[n].routeIds.push(id), o.legs[n].nos.push(l.nos[q]); }); });
  }
  // 같은 마지막 버스로 끝나는 후보는 3개까지만: 순위용 비용은 배차를 모르니 드문 버스(473번 하루 몇 회) 하나로 끝나는 변형이
  // 20칸을 다 채워 자주 다니는 302번 경로가 빠지는 일이 있었다
  const all = [...merged.values()], out: Trip[] = [], lastCount = new Map<string, number>();
  for (const t of all) {
    if (out.length >= max) break;
    const k = base(t.legs.at(-1)!.nos[0]), c = lastCount.get(k) ?? 0;
    if (c >= 3) continue;
    lastCount.set(k, c + 1);
    out.push(t);
  }
  // 직행은 순위용 비용(환승 대기를 10분으로 어림)에 밀려 빠지기 쉽다. 실제 대기를 넣으면 직행이 더 빠른 때가 많아 5개까지는 늘 넣는다
  for (const t of all) if (!out.includes(t) && t.legs.length === 1 && out.filter((x) => x.legs.length === 1).length < 5) out.push(t);
  // 같은 두 정류장을 잇는 다른 노선도 모두 붙인다. 번호별로 하나만 남겨서 202-5·202-54처럼 같은 번호의 다른 운행 계통이 빠지면,
  // 남은 하나가 지금 안 다닐 때 경로 전체가 "추정 불가"나 몇 시간 대기가 된다.
  // 탑승 시간은 처음 찾은 노선 값을 함께 쓰므로, 많이 돌아가는 노선(예: 직행 15분 vs 우회 45분)은 붙이지 않는다.
  // 환승 뒤 구간에는 출발지 근처를 이미 지나온 노선(처음부터 타면 되는 버스)은 붙이지 않는다.
  for (const t of out) t.legs.forEach((l, n) => {
    for (const [r, i] of ix.onStation.get(l.fromId) ?? []) {
      const j = r.stops.indexOf(l.toId, i + 1);
      if (!l.routeIds.includes(r.id) && j > i && !(n && passesStart(r, i)) && similar(ride(r, i, j), l.rideMin)) l.routeIds.push(r.id), l.nos.push(r.no);
    }
  });
  return out;
}
