import { revalidateTag } from 'next/cache';
import { headwayMin, parseBusLocation, stopsAway } from '@/lib/realtime';
import { findTrips, indexData, legPath, roughRide, type Station, type BusRoute, type RideMin, type Shapes } from '@/lib/direct';
import shapeData from '@/data/shapes.json';
import stationList from '@/data/stations.json';
import routeList from '@/data/routes.json';
import timetableData from '@/data/timetable.json';
import { arrivals, firstAt, kstDay, kstMinutes, offsetAt, type Timetable } from '@/lib/timetable';
import { MIN_PER_STOP } from '@/lib/config';

// 실시간: 노선별 버스 위치 → 우리 정류장까지 남은 정류장 수. 우리 데이터로 경로 후보(직행·환승 1번)도 여기서 찾는다.
// 정류장 JSON에 있는 정류장만 받고, 고정된 BusLocation 주소만 부르므로 아무 데나 부르는 프록시가 되지 않는다.
const stations = stationList as Station[];
const routes = routeList as BusRoute[];
const stationIds = new Set(stations.map((s) => s.id));
const routeById = new Map(routes.map((r) => [r.id, r]));
const timetable = timetableData as Timetable;
const index = indexData(stations, routes, shapeData as Shapes);
// 탑승 시간: 시간표의 정류장 간 소요, 없으면 정류장 수 × 평균 소요(정류장이 드문 노선은 거리로)
const rideMin: RideMin = (r, i, j) => {
  const e = timetable[r.id];
  const m = e ? offsetAt(e.p, j) - offsetAt(e.p, i) : 0;
  return Math.round(m > 0 ? m : roughRide(index, r, i, j));
};
const ID = /^\d{9}$/;
const MAX_ROUTES = 10; // 실시간 조회 노선 수
const MAX_PAIRS = 60; // 시간표는 로컬 데이터라 더 많이 본다
const CONCURRENCY = 2;

const point = (v: string | null) => {
  const [lat, lng] = (v ?? '').split(',').map(Number);
  // 제주 범위 밖이면 직행 후보를 찾지 않는다
  return lat > 33.1 && lat < 33.6 && lng > 126.08 && lng < 127 ? { lat, lng } : null;
};

async function busLocation(r: string) {
  try {
    const res = await fetch(`http://busopen.jeju.go.kr/OpenAPI/service/bis/BusLocation?route=${r}`, {
      signal: AbortSignal.timeout(3000),
      next: { revalidate: 20, tags: [`loc-${r}`] }, // 인스턴스 간 공유 캐시
    });
    const parsed = parseBusLocation(await res.text());
    if (!parsed.ok) revalidateTag(`loc-${r}`, { expire: 0 }); // 오류 응답은 캐시에 남기지 않는다
    return parsed;
  } catch {
    return { ok: false as const, reason: '실시간 API 응답 없음' };
  }
}

export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const pairs = (p.get('q') ?? '')
    .split(',')
    .map((x) => x.split(':'))
    .filter(([r, s]) => ID.test(r ?? '') && stationIds.has(s))
    .slice(0, MAX_PAIRS);
  const from = point(p.get('from')), to = point(p.get('to'));
  const trips = from && to ? findTrips(from, to, index, rideMin) : [];
  const tripFirst = trips.flatMap((t) => t.legs[0].routeIds.map((r) => [r, t.legs[0].fromId]));
  const tripLater = trips.flatMap((t) => t.legs.slice(1).flatMap((l) => l.routeIds.map((r) => [r, l.fromId])));

  // 실시간 노선은 ODsay 후보의 첫 버스 먼저, 그다음 우리 후보의 첫 버스, 합쳐서 최대 10개
  const routeIds = [...new Set([...pairs.map(([r]) => r), ...tripFirst.map(([r]) => r)])].slice(0, MAX_ROUTES);
  const allPairs = [...pairs, ...tripFirst].filter(([r]) => routeIds.includes(r));
  // 제주 서버는 동시에 여러 개를 보내면 전부 3초를 넘긴다(실측). 2개씩 나눠 보낸다.
  const locs = new Map<string, Awaited<ReturnType<typeof busLocation>>>();
  for (let i = 0; i < routeIds.length; i += CONCURRENCY) {
    await Promise.all(routeIds.slice(i, i + CONCURRENCY).map(async (r) => locs.set(r, await busLocation(r))));
  }

  const results: Record<string, number[] | { error: string }> = {};
  for (const [r, s] of allPairs) {
    const loc = locs.get(r)!;
    const away = loc.ok ? stopsAway(loc.stops, s) : null;
    results[`${r}:${s}`] = !loc.ok ? { error: loc.reason } : away ?? { error: '이 노선에 없는 정류장' };
  }
  const headways: Record<string, number> = {};
  for (const [r, loc] of locs) {
    const h = loc.ok ? headwayMin(loc.stops) : undefined;
    if (h) headways[r] = h;
  }
  // 시간표 (KST 기준): 앞으로 3시간 안에 오는 버스, 없으면 첫차 시각
  const date = new Date(), now = kstMinutes(date), today = kstDay(date);
  const nextDay = now >= 720 ? kstDay(date, 1) : today; // 막차 뒤 첫차는 오후면 내일 요일로
  const scheduled: Record<string, number[]> = {}, firstBus: Record<string, number> = {};
  for (const [r, s] of [...pairs, ...tripFirst, ...tripLater]) {
    const e = timetable[r], ord = routeById.get(r)?.stops.indexOf(s) ?? -1;
    if (!e || ord < 0) continue;
    const a = arrivals(e, ord, now, 180, today);
    if (a.length) scheduled[`${r}:${s}`] = a;
    else {
      const f = firstAt(e, ord, nextDay);
      if (f !== undefined) firstBus[`${r}:${s}`] = f;
    }
  }
  // ODsay 경로의 지도 선: "노선:탈 정류장:정류장 수" → 노선 모양 조각 (최대 30개)
  const paths: Record<string, { lat: number; lng: number }[]> = {};
  for (const k of (p.get('paths') ?? '').split(',').slice(0, 30)) {
    const [r, s, n] = k.split(':'), route = routeById.get(r), i = route?.stops.indexOf(s) ?? -1, j = i + Number(n);
    if (route && i >= 0 && Number.isInteger(Number(n)) && Number(n) > 0 && j < route.stops.length) paths[k] = legPath(index, route, i, j);
  }
  return Response.json({ results, headways, scheduled, firstBus, trips, paths });
}
