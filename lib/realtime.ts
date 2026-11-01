import { legFare, routeFare, type Route } from './odsay.ts';
import { MIN_PER_STOP } from './config.ts';
import type { Trip } from './direct.ts';
// 제주 버스정보(busopen) BusLocation 응답(XML) 해석. 외부 호출 없음.
// 응답은 노선의 모든 정류장을 순서대로 주고, 버스가 있는 정류장에만 plateNo가 붙는다.

export type BusLocation = { ok: true; stops: { stationId: string; ord: number; bus: boolean }[] } | { ok: false; reason: string };

const field = (xml: string, name: string) => xml.match(new RegExp(`<${name}>([^<]*)</${name}>`))?.[1];

export function parseBusLocation(xml: string): BusLocation {
  const code = field(xml, 'resultCode');
  if (code !== '00') return { ok: false, reason: `실시간 API 오류 (${code ?? '응답 형식 다름'})` };
  const stops = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, it]) => {
    const plate = field(it, 'plateNo');
    return { stationId: field(it, 'stationId') ?? '', ord: Number(field(it, 'stationOrd')), bus: !!plate && plate !== 'null' };
  });
  return { ok: true, stops };
}

// 우리 정류장까지 남은 정류장 수 (가까운 버스부터). 정류장이 노선에 없으면 null.
export function stopsAway(loc: { stationId: string; ord: number; bus: boolean }[], stationId: string): number[] | null {
  const mine = loc.filter((s) => s.stationId === stationId).map((s) => s.ord);
  if (!mine.length) return null;
  // 같은 정류장이 노선에 여러 번 나오면(회차·가상정류소) 버스마다 가장 가까운 것만 센다.
  const away = loc.filter((s) => s.bus).flatMap((b) => {
    const ahead = mine.filter((m) => m >= b.ord).map((m) => m - b.ord);
    return ahead.length ? [Math.min(...ahead)] : [];
  });
  return away.sort((a, b) => a - b);
}

// 배차 간격 추정: 노선 한 방향을 다 도는 시간 ÷ 지금 그 노선에 있는 버스 수. 버스가 없으면 undefined.
// 단순화: 시간표가 없어 운행 중인 버스 수로 간격을 추정함, 시간표를 구하면 교체
export function headwayMin(loc: { bus: boolean }[]): number | undefined {
  const buses = loc.filter((s) => s.bus).length;
  return buses ? (loc.length * MIN_PER_STOP) / buses : undefined;
}

export type PlanResults = Record<string, number[] | { error: string }>;
export type Headways = Record<string, number>;
// 시간표: "노선:정류장" → 지금부터 몇 분 뒤 오는지 / 오늘 운행이 끝났으면 첫차 시각(자정부터 분)
export type Schedules = { scheduled?: Record<string, number[]>; pending?: Record<string, number[]>; firstBus?: Record<string, number> };

// 서버에 보낼 "노선:정류장" 쌍. first = 첫 버스(실시간 대상), 아니면 환승 버스(시간표만 씀).
export function rideKeys(routes: Route[], first: boolean): string[] {
  const keyOf = (ride: Route['rides'][number]) => ride.routeIds.filter(Boolean).map((id) => `${id}:${ride.stationId}`);
  return [...new Set(routes.flatMap((r) => (first ? [r.rides[0]] : r.rides.slice(1)).flatMap(keyOf)))];
}

// 남은 정류장 수 → 첫 구간의 "몇 분 뒤 버스", 모든 구간의 배차 간격. 같은 구간을 달리는 노선(lane)이 여럿이면 합친다.
export function applyRealtime(route: Route, results: PlanResults, headways: Headways = {}, sched: Schedules = {}): Route {
  let noBusNow = false;
  const keys = (ride: Route['rides'][number]) => ride.routeIds.map((id) => `${id}:${ride.stationId}`);
  const legs = route.candidate.legs.map((leg, i) => {
    const ride = route.rides[i];
    // 여러 노선이 같은 구간을 다니면 합친 간격 = 1 / Σ(1/간격), 시간표는 합쳐서 가까운 순
    const freq = ride.routeIds.reduce((s, id) => s + (headways[id] ? 1 / headways[id] : 0), 0);
    const times = keys(ride).flatMap((k) => sched.scheduled?.[k] ?? []).sort((a, b) => a - b);
    const next = { ...leg, ...(freq ? { intervalMin: 1 / freq } : {}), ...(times.length ? { timetableMin: times } : {}) };
    if (i > 0) return next;
    const pend = keys(ride).flatMap((k) => sched.pending?.[k] ?? []).sort((a, b) => a - b);
    if (pend.length) Object.assign(next, { pendingMin: pend });
    // 단순화: 이 구간의 정류장당 평균 소요(탑승 시간 ÷ 정류장 수)를 버스가 오는 길에도 씀, 신호·정차 편차는 무시
    const perStop = ride.stops > 0 && leg.rideMin > 0 ? leg.rideMin / ride.stops : MIN_PER_STOP;
    const found = ride.routeIds.map((id) => results[`${id}:${ride.stationId}`]).filter(Array.isArray);
    const mins = found.flat().map((n) => n * perStop).sort((a, b) => a - b);
    if (!mins.length && found.length) noBusNow = true;
    return mins.length ? { ...next, nextBusesMin: mins } : next;
  });
  const firsts = keys(route.rides[0]).map((k) => sched.firstBus?.[k]).filter((v) => v !== undefined);
  const firstBus = !legs[0].nextBusesMin && !legs[0].timetableMin && firsts.length ? Math.min(...firsts) : undefined;
  return { ...route, candidate: { ...route.candidate, legs }, ...(noBusNow ? { noBusNow } : {}), ...(firstBus !== undefined ? { firstBus } : {}) };
}

// 서버가 우리 데이터로 찾은 후보 → 화면 후보. ODsay에 같은 버스·같은 정류장 조합이 이미 있으면 뺀다.
export function tripsToRoutes(trips: Trip[], existing: Route[]): Route[] {
  const covered = (t: Trip) => existing.some((r) => r.rides.length === t.legs.length && t.legs.every((l, n) => r.rides[n].stationId === l.fromId && l.routeIds.some((id) => r.rides[n].routeIds.includes(id))));
  return trips.filter((t) => !covered(t)).map((t) => {
    const legs = t.legs.map((l) => ({ walkBeforeMin: Math.round(l.walkBeforeMin), rideMin: l.rideMin }));
    const walkAfterMin = Math.round(t.walkAfterMin);
    return {
      candidate: { legs, walkAfterMin },
      rides: t.legs.map((l) => ({ busNos: l.nos, routeIds: l.routeIds, stationId: l.fromId, from: l.fromName, to: l.toName, stops: l.stops, fromPt: l.fromPt, toPt: l.toPt, path: l.path })),
      fare: routeFare(t.legs.map((l) => { const f = l.nos.flatMap((n) => legFare(n, l.distM) ?? []); return f.length ? Math.max(...f) : null; }), 0),
      odsayMin: legs.reduce((s, l) => s + l.walkBeforeMin + l.rideMin, 0) + walkAfterMin,
    };
  });
}
