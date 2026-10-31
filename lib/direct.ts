import { NEAR_STOP_M, WALK_DETOUR, WALK_M_PER_MIN, MIN_PER_STOP } from './config.ts';

export type Station = { id: string; name: string; lat: number; lng: number };
export type BusRoute = { id: string; no: string; to: string; stops: string[] };
export type Pt = { lat: number; lng: number };
export type Direct = { routeId: string; no: string; heading: string; fromId: string; fromName: string; toName: string; stops: number; walkBeforeMin: number; walkAfterMin: number; fromPt: Pt; toPt: Pt };

export function distM(a: Pt, b: Pt): number {
  const R = 6371000, rad = Math.PI / 180;
  const x = (b.lng - a.lng) * rad * Math.cos(((a.lat + b.lat) / 2) * rad);
  const y = (b.lat - a.lat) * rad;
  return Math.hypot(x, y) * R; // 제주 범위에서는 평면 근사로 충분
}
export const walkMin = (a: Pt, b: Pt) => (distM(a, b) * WALK_DETOUR) / WALK_M_PER_MIN;

// 출발지 600m 안 정류장에서 목적지 600m 안 정류장으로 갈아타지 않고 가는 노선. 노선마다 가장 빠른 조합 하나.
export function directCandidates(from: Pt, to: Pt, stations: Station[], routes: BusRoute[], max = 5): Direct[] {
  const near = (p: Pt) => new Map(stations.filter((s) => distM(p, s) <= NEAR_STOP_M).map((s) => [s.id, s]));
  const starts = near(from), ends = near(to);
  if (!starts.size || !ends.size) return [];
  const out: (Direct & { cost: number })[] = [];
  for (const r of routes) {
    let best: (Direct & { cost: number }) | null = null;
    r.stops.forEach((sid, i) => {
      const s = starts.get(sid);
      if (!s) return;
      for (let j = i + 1; j < r.stops.length; j++) {
        const e = ends.get(r.stops[j]);
        if (!e) continue;
        const d: Direct = { routeId: r.id, no: r.no, heading: r.to, fromId: s.id, fromName: s.name, toName: e.name, stops: j - i, walkBeforeMin: walkMin(from, s), walkAfterMin: walkMin(e, to), fromPt: { lat: s.lat, lng: s.lng }, toPt: { lat: e.lat, lng: e.lng } };
        // 단순화: 시간표가 없어 탑승 시간을 정류장 수 × 평균 소요로 잡음
        const cost = d.walkBeforeMin + d.stops * MIN_PER_STOP + d.walkAfterMin;
        if (!best || cost < best.cost) best = { ...d, cost };
        break; // 이 출발 정류장에서는 가장 먼저 닿는 도착 정류장만
      }
    });
    if (best) out.push(best);
  }
  return out.sort((a, b) => a.cost - b.cost).slice(0, max).map(({ cost: _, ...d }) => d);
}
