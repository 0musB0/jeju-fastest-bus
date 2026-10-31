import { NEAR_STOP_M, WALK_DETOUR, WALK_M_PER_MIN, MIN_PER_STOP, TRANSFER_M, TRANSFER_PENALTY_MIN } from './config.ts';

// 우리 데이터(정류장·노선 JSON)만으로 경로 후보를 찾는다: 직행 + 한 번 환승. ODsay 일일 한도와 상관없이 항상 돈다.
export type Station = { id: string; name: string; lat: number; lng: number };
export type BusRoute = { id: string; no: string; to: string; stops: string[] };
export type Pt = { lat: number; lng: number };
export type TripLeg = { routeIds: string[]; nos: string[]; fromId: string; fromName: string; toName: string; stops: number; walkBeforeMin: number; rideMin: number; distM: number; fromPt: Pt; toPt: Pt; path: Pt[] };
export type Trip = { legs: TripLeg[]; walkAfterMin: number; cost: number };
// 노선의 i번째 → j번째 정류장 탑승 시간(분). 서버가 시간표로 채워 넘긴다.
export type RideMin = (route: BusRoute, i: number, j: number) => number;

export function distM(a: Pt, b: Pt): number {
  const R = 6371000, rad = Math.PI / 180;
  const x = (b.lng - a.lng) * rad * Math.cos(((a.lat + b.lat) / 2) * rad);
  const y = (b.lat - a.lat) * rad;
  return Math.hypot(x, y) * R; // 제주 범위에서는 평면 근사로 충분
}
export const walkMin = (a: Pt, b: Pt) => (distM(a, b) * WALK_DETOUR) / WALK_M_PER_MIN;
const base = (no: string) => no.split('-')[0];

// 정류장·노선 색인. 서버에서 한 번만 만든다.
export function indexData(stations: Station[], routes: BusRoute[]) {
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
  return { byId, onStation, near };
}
export type Index = ReturnType<typeof indexData>;

const defaultRide: RideMin = (_r, i, j) => (j - i) * MIN_PER_STOP;

function leg(ix: Index, r: BusRoute, i: number, j: number, walkBeforeMin: number, ride: RideMin): TripLeg {
  const s = ix.byId.get(r.stops[i])!, e = ix.byId.get(r.stops[j])!;
  const path = r.stops.slice(i, j + 1).flatMap((id) => { const p = ix.byId.get(id); return p ? [{ lat: p.lat, lng: p.lng }] : []; });
  const d = path.reduce((sum, p, k) => (k ? sum + distM(path[k - 1], p) : 0), 0);
  return { routeIds: [r.id], nos: [r.no], fromId: s.id, fromName: s.name, toName: e.name, stops: j - i, walkBeforeMin, rideMin: ride(r, i, j), distM: d, fromPt: { lat: s.lat, lng: s.lng }, toPt: { lat: e.lat, lng: e.lng }, path };
}

// 출발지 600m 안 정류장 → (환승 정류장 200m 안 갈아타기 1번까지) → 목적지 600m 안 정류장.
// 순위용 비용 = 걷기 + 탑승 + 환승 걷기 + 환승 대기 어림값. 실제 대기는 화면에서 실시간·시간표로 다시 계산한다.
// ponytail: 요청마다 전체를 훑어 0.3~0.7초 걸림. 느려지면 노선 쌍 환승표를 미리 만들어 둔다.
// 단순화: 환승은 1번까지만 (제주는 대부분 1번이면 닿음). 2번 환승이 필요한 곳은 ODsay 결과에 기댄다.
export function findTrips(from: Pt, to: Pt, ix: Index, ride: RideMin = defaultRide, max = 8): Trip[] {
  const starts = ix.near(from, NEAR_STOP_M), ends = new Set(ix.near(to, NEAR_STOP_M).map((s) => s.id));
  if (!starts.length || !ends.size) return [];
  const startIds = new Set(starts.map((s) => s.id));
  const firstEnd = (r: BusRoute, after: number) => { for (let j = after + 1; j < r.stops.length; j++) if (ends.has(r.stops[j])) return j; return -1; };
  const after = (j: number, r: BusRoute) => walkMin(ix.byId.get(r.stops[j])!, to);
  const best = new Map<string, Trip>(); // 같은 버스 번호 조합은 가장 빠른 것 하나
  const keep = (key: string, t: Trip) => { const o = best.get(key); if (!o || t.cost < o.cost) best.set(key, t); };

  for (const s of starts) {
    const w0 = walkMin(from, s);
    if (s.name.includes('하차전용')) continue;
    for (const [a, i] of ix.onStation.get(s.id) ?? []) {
      const j0 = firstEnd(a, i);
      if (j0 > 0) {
        const l = leg(ix, a, i, j0, w0, ride), wa = after(j0, a);
        keep(base(a.no), { legs: [l], walkAfterMin: wa, cost: w0 + l.rideMin + wa });
      }
      // 목적지 근처에 닿기 전의 정류장에서만 갈아탄다
      const last = j0 > 0 ? j0 : a.stops.length;
      for (let k = i + 1; k < last; k++) {
        const ks = ix.byId.get(a.stops[k]);
        if (!ks) continue;
        for (const t of ix.near(ks, TRANSFER_M)) {
          if (distM(from, t) <= NEAR_STOP_M || t.name.includes('하차전용')) continue; // 출발지에서 걸어갈 수 있는 정류장이면 처음부터 거기서 타는 게 낫다
          for (const [b, m] of ix.onStation.get(t.id) ?? []) {
            if (base(b.no) === base(a.no) || b.stops.slice(0, m).some((id) => startIds.has(id))) continue; // b를 출발지 근처에서 바로 탈 수 있으면 환승할 이유가 없다
            const j = firstEnd(b, m);
            if (j < 0) continue;
            const key = `${base(a.no)}>${base(b.no)}`;
            const rideA = ride(a, i, k), wt = walkMin(ks, t), rideB = ride(b, m, j), wa = after(j, b);
            const cost = w0 + rideA + wt + TRANSFER_PENALTY_MIN + rideB + wa;
            if ((best.get(key)?.cost ?? Infinity) <= cost) continue;
            keep(key, { legs: [leg(ix, a, i, k, w0, ride), leg(ix, b, m, j, wt, ride)], walkAfterMin: wa, cost });
          }
        }
      }
    }
  }
  // 같은 정류장에서 타고 내리는 후보(예: 300·301)는 하나로 합친다. ODsay의 lane처럼 "아무거나 먼저 오는 버스".
  const merged = new Map<string, Trip>();
  for (const t of [...best.values()].sort((x, y) => x.cost - y.cost)) {
    const key = t.legs.map((l) => `${l.fromId}>${l.toName}`).join('|');
    const o = merged.get(key);
    if (!o) merged.set(key, t);
    else t.legs.forEach((l, n) => l.routeIds.forEach((id, q) => { if (!o.legs[n].routeIds.includes(id)) o.legs[n].routeIds.push(id), o.legs[n].nos.push(l.nos[q]); }));
  }
  return [...merged.values()].slice(0, max);
}
