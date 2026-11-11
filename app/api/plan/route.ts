import { headwayMin, parseBusLocation, minsAway, stopsAway, fallbackLoc, batchTimeout } from '@/lib/realtime';
import { distM, findTrips, indexData, maskOffShape, legPath, roughRide, type Station, type BusRoute, type RideMin, type Shapes, type Trip } from '@/lib/direct';
import shapeData from '@/data/shapes.json';
import stationList from '@/data/stations.json';
import routeList from '@/data/routes.json';
import timetableData from '@/data/timetable.json';
import { arrivals, firstAt, kstDay, kstMinutes, offsetAt, rideFactor, type Timetable } from '@/lib/timetable';
import { MIN_PER_STOP, WALK_DETOUR, WALK_M_PER_MIN } from '@/lib/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { walkGraph, type Walker } from '@/lib/walk';

// 실시간: 노선별 버스 위치 → 우리 정류장까지 남은 정류장 수. 우리 데이터로 경로 후보(직행·환승 1번)도 여기서 찾는다.
// 그 노선의 정류장 목록에 있는 정류장만 받고, 고정된 BusLocation 주소만 부르므로 아무 데나 부르는 프록시가 되지 않는다.
const stations = stationList as Station[];
const stationName = new Map(stations.map((s) => [s.id, s.name])), stationById = new Map(stations.map((s) => [s.id, s]));
const routes = maskOffShape(routeList as BusRoute[], shapeData as Shapes, (id) => stationName.get(id), (id) => stationById.get(id));
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
// 실시간 조회 노선 수. 10개일 때 첫 구간 가지 노선만으로 다 차서 환승 구간은 늘 시간표였다 (공항→중문 39개 후보, 2026-11-03)
const MAX_ROUTES = 16;
const RT_END_MS = 8500; // 마지막 요청까지 합친 상한 (Vercel Hobby 10초 제한 안). 남은 시간이 4초보다 짧으면 새 배치를 보내지 않는다 (lib/realtime.ts batchTimeout)
const STALE_MS = 45000; // 조회가 실패하면 이 안에 받아 둔 위치를 쓴다 (화면에 'N초 전 위치')
const TOP_TRIPS = 6; // 실시간을 먼저 채울 상위 후보 수 (화면에는 3개, 갱신 때 순위가 바뀌는 것 대비)
const MAX_PAIRS = 60; // 시간표는 로컬 데이터라 더 많이 본다
const CONCURRENCY = 2;

const point = (v: string | null) => {
  const [lat, lng] = (v ?? '').split(',').map(Number);
  // 제주 범위 밖이면 직행 후보를 찾지 않는다
  return lat > 33.1 && lat < 33.6 && lng > 126.08 && lng < 127 ? { lat, lng } : null;
};

// 직전에 성공한 위치 (함수 인스턴스 메모리). 실패했을 때만 STALE_MS 안의 값을 대신 쓴다. 성공하면 늘 새 값이라 옛 위치가 먼저 나오지 않는다.
const lastOk = new Map<string, { t: number; loc: Awaited<ReturnType<typeof fetchLocation>> }>();
async function busLocation(r: string, timeoutMs: number) {
  const loc = await fetchLocation(r, timeoutMs);
  if (loc.ok) lastOk.set(r, { t: Date.now(), loc });
  return loc;
}
async function fetchLocation(r: string, timeoutMs: number) {
  try {
    const res = await fetch(`http://busopen.jeju.go.kr/OpenAPI/service/bis/BusLocation?route=${r}`, {
      signal: AbortSignal.timeout(timeoutMs),
      // 캐시하지 않는다. revalidate는 오래된 값을 한 번 먼저 주고 뒤에서 갱신해서, 한동안 아무도 안 썼다가 열면 첫 화면이 옛 버스 위치였다
      // (카카오맵 30분인데 앱은 8분, 2026-11-11). 갱신 주기가 20초라 호출 수가 늘지 않는다.
      cache: 'no-store',
    });
    return parseBusLocation(await res.text());
  } catch (e) {
    // 이유를 남긴다: TimeoutError(제한 시간 넘김)인지 연결 실패인지 (서귀포 520번이 계속 실패, 2026-11-02)
    return { ok: false as const, reason: `실시간 API 응답 없음 (${(e as Error)?.name ?? '?'}${(e as Error & { cause?: { code?: string } })?.cause?.code ? ` ${(e as Error & { cause: { code: string } }).cause.code}` : ''})` };
  }
}

export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  // q = ODsay 경로의 첫 버스, later = 환승 버스 (환승 버스는 시간표만 쓰므로 실시간 조회는 안 함)
  const parse = (v: string | null) => (v ?? '').split(',').map((x) => x.split(':'))
    .filter(([r, s]) => ID.test(r ?? '') && !!routeById.get(r)?.stops.includes(s)).slice(0, MAX_PAIRS);
  // pin = 화면에서 따라가는 경로의 구간들: 실시간 칸에 가장 먼저 넣는다 (타고 가는 중에도 환승 버스를 실시간으로)
  const pairs = parse(p.get('q')), laterPairs = parse(p.get('later')), pinPairs = parse(p.get('pin'));
  const from = point(p.get('from')), to = point(p.get('to'));
  // 평일 퇴근길엔 시간표 소요보다 오래 걸린다 (실측 배율, lib/config.ts RUSH_RIDE). 실시간 대기의 정류장당 소요도 여기서 나와 같이 늘어난다
  const rf = rideFactor(new Date());
  const trips = from && to ? findTrips(from, to, index, rf === 1 ? rideMin : (r, i, j) => Math.round(rideMin(r, i, j) * rf), 20, walker) : [];
  const tripFirst = trips.flatMap((t) => t.legs[0].routeIds.map((r) => [r, t.legs[0].fromId]));
  const tripLater = trips.flatMap((t) => t.legs.slice(1).flatMap((l) => l.routeIds.map((r) => [r, l.fromId])));

  // 실시간 칸(MAX_ROUTES): 따라가는 경로, ODsay 첫 버스, 상위 후보의 첫 구간·환승 구간, ODsay 환승 버스, 나머지 후보 순.
  // 한 정류장에 같은 번호의 가지 노선이 여럿 서면(201-12·201-14·201-20, 212-2·212-4) 버스 위치는 가지 노선마다 따로 온다.
  // 그래서 구간마다 60분 안에 올 가지 노선을 3개까지 차례로 넣는다. 같은 구간은 한 번만.
  // 한 구간의 노선은 시간표상 곧 오는 것부터 조회한다. 예전에는 목록 첫 노선만 봐서 밤에만 다니는 201-18을 아침에 조회하고,
  // 2정류장 앞에 와 있던 201-12 버스를 놓쳤다 (온평초, 2026-11-02). 시간표가 없는 노선은 중간 순서.
  const date = new Date(), now = kstMinutes(date), today = kstDay(date);
  const soon = (r: string, s: string) => {
    const route = routeById.get(r), e = tableOf(route), ord = route?.stops.indexOf(s) ?? -1;
    return e && ord >= 0 ? (arrivals(e, ord, now, 180, today)[0] ?? 9999) : 500;
  };
  const bySoon = (ids: string[], s: string) => [...ids].sort((a, b) => soon(a, s) - soon(b, s));
  // ODsay 경로도 같은 정류장의 가지 노선들이 따로 들어오므로 정류장·번호로 묶어 같은 규칙을 쓴다
  const legIds = (ids: string[], s: string) => bySoon(ids, s).filter((r, i) => i === 0 || soon(r, s) <= 60).slice(0, 3);
  const grouped = (ps: string[][]) => [...Map.groupBy(ps, ([r, st]) => `${st}:${routeById.get(r)?.no.split('-')[0]}`).values()]
    .flatMap((g) => legIds(g.map(([r]) => r), g[0][1]));
  const routeIds: string[] = [];
  // 상위 후보는 환승 구간까지 실시간으로 (첫 구간 전부를 먼저 넣으면 환승 구간이 칸에 못 들었다), 나머지 후보는 그다음
  const firstIds = (ts: Trip[]) => ts.flatMap((t) => legIds(t.legs[0].routeIds, t.legs[0].fromId));
  const laterIds = (ts: Trip[]) => ts.flatMap((t) => t.legs.slice(1).flatMap((l) => legIds(l.routeIds, l.fromId)));
  const top = trips.slice(0, TOP_TRIPS), rest = trips.slice(TOP_TRIPS);
  for (const r of [...grouped(pinPairs), ...grouped(pairs), ...firstIds(top), ...laterIds(top), ...grouped(laterPairs), ...firstIds(rest), ...laterIds(rest)]) {
    if (routeIds.length < MAX_ROUTES && !routeIds.includes(r)) routeIds.push(r);
  }
  // 제주 서버는 동시에 여러 개를 보내면 전부 3초를 넘긴다(실측). 2개씩 나눠 보낸다.
  const locs = new Map<string, Awaited<ReturnType<typeof busLocation>>>();
  const stale: Record<string, number> = {}; // 노선 → 몇 초 전 위치인지 (조회 실패를 직전 값으로 대신한 것)
  const t0 = Date.now();
  for (let i = 0; i < routeIds.length; i += CONCURRENCY) {
    // 요청 하나는 6초까지 기다리되 전체가 RT_END_MS를 넘지 않게 남은 시간만큼만 (Vercel에서 3초는 늘 부족했다, 2026-11-11)
    const timeout = batchTimeout(RT_END_MS - (Date.now() - t0));
    if (timeout === null) break;
    await Promise.all(routeIds.slice(i, i + CONCURRENCY).map(async (r) => {
      const got = fallbackLoc(await busLocation(r, timeout), lastOk.get(r), Date.now(), STALE_MS);
      if (got.ageSec !== undefined) stale[r] = got.ageSec;
      locs.set(r, got.loc);
    }));
  }

  const allPairs = [...pinPairs, ...pairs, ...tripFirst, ...laterPairs, ...tripLater].filter(([r]) => locs.has(r));
  const results: Record<string, number[] | { error: string }> = {};
  const rtMin: Record<string, number[]> = {}; // 같은 버스들이 정류장까지 걸리는 분 (시간표의 정류장별 소요로 잼, 시간표 있는 노선만)
  for (const [r, s] of allPairs) {
    const loc = locs.get(r)!;
    // 기점(첫 정류장)에 서 있는 버스는 출발 시각을 기다리는 중일 수 있다. 시간표가 있는 노선은 그 버스를 빼고,
    // 아직 출발하지 않은 버스는 시간표(pending)로 계산한다.
    const parked = !!tableOf(routeById.get(r));
    const away = loc.ok ? stopsAway(parked ? loc.stops.map((x, k) => (k === 0 ? { ...x, bus: false } : x)) : loc.stops, s) : null;
    results[`${r}:${s}`] = !loc.ok ? { error: loc.reason } : away ?? { error: '이 노선에 없는 정류장' };
    const e = tableOf(routeById.get(r));
    if (loc.ok && away && e) {
      const m = minsAway(parked ? loc.stops.map((x, k) => (k === 0 ? { ...x, bus: false } : x)) : loc.stops, s, (o) => offsetAt(e.p, o) * rf);
      if (m) rtMin[`${r}:${s}`] = m.map((x) => Math.round(x * 10) / 10);
    }
  }
  // 따라가는 경로(pin) 구간만: 남은 정류장 수 → 그 버스가 지금 있는 정류장 (화면에 탄 버스 위치)
  const pos: Record<string, Record<number, { name: string; lat: number; lng: number }>> = {};
  for (const [r, s] of pinPairs) {
    const loc = locs.get(r), mine = loc?.ok ? loc.stops.find((x) => x.stationId === s)?.ord : undefined;
    if (!loc?.ok || mine === undefined) continue;
    for (const b of loc.stops) {
      const st = b.bus && b.ord <= mine ? stationById.get(b.stationId) : undefined;
      if (st) (pos[`${r}:${s}`] ??= {})[mine - b.ord] = { name: st.name, lat: st.lat, lng: st.lng };
    }
  }
  const headways: Record<string, number> = {};
  for (const [r, loc] of locs) {
    const h = loc.ok ? headwayMin(loc.stops) : undefined;
    if (h) headways[r] = h;
  }
  // 시간표 (KST 기준): 오늘 남은 버스(가까운 12대, 자정 넘긴 막차 포함), 오늘 더 없으면 첫차 시각
  const nextDay = now >= 720 ? kstDay(date, 1) : today; // 막차 뒤 첫차는 오후면 내일 요일로
  const scheduled: Record<string, number[]> = {}, firstBus: Record<string, number> = {};
  const pending: Record<string, number[]> = {}; // 시간표 버스 중 아직 기점을 떠나지 않은 것 (실시간 위치에 안 보이는 버스)
  for (const [r, s] of [...pinPairs, ...pairs, ...laterPairs, ...tripFirst, ...tripLater]) {
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
  // lite = 20초 자동 갱신: 지도 선은 처음 받은 것을 화면이 그대로 쓴다
  // 한 구간에 묶인 노선마다 정류장 수가 다르다(급행 111은 8개, 같은 구간 212는 56개). 화면은 실제로 탈 버스의 수를 보여준다
  // 어디 방면: 카카오맵처럼 탈 정류장 다음 정류장 이름 (길 건너 같은 이름 정류장과 헷갈리지 않게)
  for (const t of trips) for (const l of t.legs) {
    const s = routeById.get(l.routeIds[0])?.stops ?? [], i = s.indexOf(l.fromId);
    const next = s.slice(i + 1).find((id) => stationName.get(id));
    if (i >= 0 && next) l.toward = stationName.get(next);
  }
  for (const t of trips) for (const l of t.legs) l.stopsBy = l.routeIds.map((id) => {
    const s = routeById.get(id)?.stops ?? [], i = s.indexOf(l.fromId), j = s.indexOf(l.toId, i + 1);
    return i >= 0 && j > i ? j - i : l.stops;
  });
  const out = p.get('lite') ? trips.map((t) => ({ ...t, legs: t.legs.map((l) => ({ ...l, path: [] })) })) : trips;
  // ODsay 구간 확인: 그 노선이 탈 정류장 다음에 내릴 정류장에 서는지 (우리 데이터만 봄)
  const stopsOk: Record<string, boolean> = {};
  for (const k of (p.get('stops') ?? '').split(',').slice(0, MAX_PAIRS)) {
    const [r, a, b] = k.split(':');
    const route = ID.test(r ?? '') ? routeById.get(r) : undefined;
    if (!route || !a || !b) continue;
    const i = route.stops.indexOf(a);
    stopsOk[k] = i >= 0 && route.stops.indexOf(b, i + 1) > i;
  }
  // ODsay 경로의 첫·마지막 걷기도 우리 걷는 길로 잰다 (ODsay 도보 시간이 실제보다 짧은 곳이 있음: 제주대학교입구 → 캠퍼스 안)
  const walkMins = (pt: { lat: number; lng: number } | null, ids: string | null) => {
    const res: Record<string, number> = {};
    const tree = pt ? walker?.tree(pt, 3000) : null;
    for (const id of tree ? (ids ?? '').split(',').slice(0, 20) : []) {
      const s = ID.test(id) ? index.byId.get(id) : undefined;
      const r = s && tree!.to(s);
      if (r) res[id] = isFinite(r.m) ? Math.round(r.m / WALK_M_PER_MIN) : 999;
    }
    return res;
  };
  const walkFrom = walkMins(from, p.get('wf')), walkTo = walkMins(to, p.get('wt'));
  // 버스 없이 바로 걸어가는 시간 (3km 안만). 버스보다 빠르면 화면이 "걸어가세요"를 먼저 보여준다
  let walkAll: number | undefined, walkAllPath: { lat: number; lng: number }[] | undefined;
  if (from && to && !p.get('lite') && distM(from, to) < 3000) {
    const r = walker?.tree(from, 3000)?.to(to);
    const ok = r && isFinite(r.m);
    walkAll = Math.round((ok ? r.m : distM(from, to) * WALK_DETOUR) / WALK_M_PER_MIN);
    walkAllPath = ok ? r.path : [from, to];
  }
  return Response.json({ results, stale, rtMin, pos, headways, scheduled, pending, firstBus, trips: out, paths, stopsOk, walkFrom, walkTo, walkAll, walkAllPath });
}
