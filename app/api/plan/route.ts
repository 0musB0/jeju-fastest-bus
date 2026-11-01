import { revalidateTag } from 'next/cache';
import { headwayMin, parseBusLocation, stopsAway } from '@/lib/realtime';
import { findTrips, indexData, legPath, roughRide, type Station, type BusRoute, type RideMin, type Shapes } from '@/lib/direct';
import shapeData from '@/data/shapes.json';
import stationList from '@/data/stations.json';
import routeList from '@/data/routes.json';
import timetableData from '@/data/timetable.json';
import { arrivals, firstAt, kstDay, kstMinutes, offsetAt, type Timetable } from '@/lib/timetable';
import { MIN_PER_STOP } from '@/lib/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { walkGraph, type Walker } from '@/lib/walk';

// 실시간: 노선별 버스 위치 → 우리 정류장까지 남은 정류장 수. 우리 데이터로 경로 후보(직행·환승 1번)도 여기서 찾는다.
// 그 노선의 정류장 목록에 있는 정류장만 받고, 고정된 BusLocation 주소만 부르므로 아무 데나 부르는 프록시가 되지 않는다.
const stations = stationList as Station[];
const routes = routeList as BusRoute[];
const routeById = new Map(routes.map((r) => [r.id, r]));
const timetable = timetableData as Timetable;
const index = indexData(stations, routes, shapeData as Shapes);
// 시간표는 노선 ID + 정류장 순번으로 저장돼 있다. 만들 때와 정류장 수가 다르면(노선만 갱신되고 시간표 갱신 실패) 순번이 어긋나므로 쓰지 않는다.
const tableOf = (r: BusRoute | undefined) => { const e = r && timetable[r.id]; return e && e.n === r.stops.length ? e : undefined; };
// 탑승 시간: 시간표의 정류장 간 소요, 없으면 정류장 수 × 평균 소요(정류장이 드문 노선은 거리로)
const rideMin: RideMin = (r, i, j) => {
  const e = tableOf(r);
  const m = e ? offsetAt(e.p, j) - offsetAt(e.p, i) : 0;
  return Math.round(m >= 1 ? m : roughRide(index, r, i, j)); // 1분 미만은 시간표 보간 오차로 보고 어림값
};
// 걷는 길(OpenStreetMap). 없으면 직선 × 배율로 계산한다.
let walker: Walker | undefined;
try { walker = walkGraph(JSON.parse(readFileSync(join(process.cwd(), 'data', 'walk.json'), 'utf8'))); } catch { walker = undefined; }
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
  // q = ODsay 경로의 첫 버스, later = 환승 버스 (환승 버스는 시간표만 쓰므로 실시간 조회는 안 함)
  const parse = (v: string | null) => (v ?? '').split(',').map((x) => x.split(':'))
    .filter(([r, s]) => ID.test(r ?? '') && !!routeById.get(r)?.stops.includes(s)).slice(0, MAX_PAIRS);
  const pairs = parse(p.get('q')), laterPairs = parse(p.get('later'));
  const from = point(p.get('from')), to = point(p.get('to'));
  const trips = from && to ? findTrips(from, to, index, rideMin, 20, walker) : [];
  const tripFirst = trips.flatMap((t) => t.legs[0].routeIds.map((r) => [r, t.legs[0].fromId]));
  const tripLater = trips.flatMap((t) => t.legs.slice(1).flatMap((l) => l.routeIds.map((r) => [r, l.fromId])));

  // 실시간 10칸은 모든 후보의 첫 버스로만 채운다. 한 구간에 노선이 여럿 붙어 있으므로 후보마다 하나씩 돌아가며 고른다.
  const lists = [...pairs.map(([r]) => [r]), ...trips.map((t) => t.legs[0].routeIds)];
  const routeIds: string[] = [];
  for (let k = 0; routeIds.length < MAX_ROUTES && lists.some((l) => l.length > k); k++) {
    for (const l of lists) if (l[k] && !routeIds.includes(l[k]) && routeIds.length < MAX_ROUTES) routeIds.push(l[k]);
  }
  const allPairs = [...pairs, ...tripFirst].filter(([r]) => routeIds.includes(r));
  // 제주 서버는 동시에 여러 개를 보내면 전부 3초를 넘긴다(실측). 2개씩 나눠 보낸다.
  const locs = new Map<string, Awaited<ReturnType<typeof busLocation>>>();
  for (let i = 0; i < routeIds.length; i += CONCURRENCY) {
    await Promise.all(routeIds.slice(i, i + CONCURRENCY).map(async (r) => locs.set(r, await busLocation(r))));
  }

  const results: Record<string, number[] | { error: string }> = {};
  for (const [r, s] of allPairs) {
    const loc = locs.get(r)!;
    // 기점(첫 정류장)에 서 있는 버스는 출발 시각을 기다리는 중일 수 있다. 시간표가 있는 노선은 그 버스를 빼고,
    // 아직 출발하지 않은 버스는 시간표(pending)로 계산한다.
    const parked = !!tableOf(routeById.get(r));
    const away = loc.ok ? stopsAway(parked ? loc.stops.map((x, k) => (k === 0 ? { ...x, bus: false } : x)) : loc.stops, s) : null;
    results[`${r}:${s}`] = !loc.ok ? { error: loc.reason } : away ?? { error: '이 노선에 없는 정류장' };
  }
  const headways: Record<string, number> = {};
  for (const [r, loc] of locs) {
    const h = loc.ok ? headwayMin(loc.stops) : undefined;
    if (h) headways[r] = h;
  }
  // 시간표 (KST 기준): 오늘 남은 버스(가까운 12대, 자정 넘긴 막차 포함), 오늘 더 없으면 첫차 시각
  const date = new Date(), now = kstMinutes(date), today = kstDay(date);
  const nextDay = now >= 720 ? kstDay(date, 1) : today; // 막차 뒤 첫차는 오후면 내일 요일로
  const scheduled: Record<string, number[]> = {}, firstBus: Record<string, number> = {};
  const pending: Record<string, number[]> = {}; // 시간표 버스 중 아직 기점을 떠나지 않은 것 (실시간 위치에 안 보이는 버스)
  for (const [r, s] of [...pairs, ...laterPairs, ...tripFirst, ...tripLater]) {
    const e = tableOf(routeById.get(r)), ord = routeById.get(r)?.stops.indexOf(s) ?? -1;
    if (!e || ord < 0) continue;
    // 낮에 3시간 넘게 비는 노선도 많다(시골·관광지). 3시간 안에 없다고 "운행 끝"으로 보지 않는다.
    const a = arrivals(e, ord, now, Math.max(180, 1560 - now), today).slice(0, 12);
    if (a.length) scheduled[`${r}:${s}`] = a;
    const lead = offsetAt(e.p, ord) - offsetAt(e.p, 0); // 기점에서 이 정류장까지 걸리는 분
    const notYet = a.filter((m) => m > lead);
    if (notYet.length) pending[`${r}:${s}`] = notYet;
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
  // lite = 30초 자동 갱신: 지도 선은 처음 받은 것을 화면이 그대로 쓴다
  const out = p.get('lite') ? trips.map((t) => ({ ...t, legs: t.legs.map((l) => ({ ...l, path: [] })) })) : trips;
  return Response.json({ results, headways, scheduled, pending, firstBus, trips: out, paths });
}
