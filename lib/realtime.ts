import type { Route } from './odsay.ts';
import { MIN_PER_STOP } from './config.ts';
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
  const away = loc.filter((s) => s.bus).flatMap((b) => mine.filter((m) => m >= b.ord).map((m) => m - b.ord));
  return away.sort((a, b) => a - b);
}


export type PlanResults = Record<string, number[] | { error: string }>;

// 첫 버스 구간에서 실시간으로 조회할 "노선:정류장" 쌍. 빠른 경로부터 노선 max개까지.
export function realtimeKeys(routes: Route[], max = 10): string[] {
  const keys = routes.flatMap((r) => r.rides[0].routeIds.filter(Boolean).map((id) => `${id}:${r.rides[0].stationId}`));
  const routeIds = [...new Set(keys.map((k) => k.split(':')[0]))].slice(0, max);
  return [...new Set(keys)].filter((k) => routeIds.includes(k.split(':')[0]));
}

// 남은 정류장 수 → 첫 구간의 "몇 분 뒤 버스". 같은 구간을 달리는 노선(lane)이 여럿이면 합친다.
export function applyRealtime(route: Route, results: PlanResults): Route {
  const ride = route.rides[0];
  const leg = route.candidate.legs[0];
  // 단순화: 이 구간의 정류장당 평균 소요(탑승 시간 ÷ 정류장 수)를 버스가 오는 길에도 씀, 신호·정차 편차는 무시
  const perStop = ride.stops > 0 && leg.rideMin > 0 ? leg.rideMin / ride.stops : MIN_PER_STOP;
  const mins = ride.routeIds.flatMap((id) => {
    const r = results[`${id}:${ride.stationId}`];
    return Array.isArray(r) ? r.map((n) => n * perStop) : [];
  });
  if (!mins.length) return route;
  const legs = [{ ...leg, nextBusesMin: mins.sort((a, b) => a - b) }, ...route.candidate.legs.slice(1)];
  return { ...route, candidate: { ...route.candidate, legs } };
}
