import { revalidateTag } from 'next/cache';
import { parseBusLocation, stopsAway } from '@/lib/realtime';
import { directCandidates, type Station, type BusRoute } from '@/lib/direct';
import stationList from '@/data/stations.json';
import routeList from '@/data/routes.json';

// 실시간: 노선별 버스 위치 → 우리 정류장까지 남은 정류장 수. 직행 후보도 여기서 찾는다.
// 정류장 JSON에 있는 정류장만 받고, 고정된 BusLocation 주소만 부르므로 아무 데나 부르는 프록시가 되지 않는다.
const stations = stationList as Station[];
const routes = routeList as BusRoute[];
const stationIds = new Set(stations.map((s) => s.id));
const ID = /^\d{9}$/;
const MAX_ROUTES = 10;

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
    .filter(([r, s]) => ID.test(r ?? '') && stationIds.has(s));
  const from = point(p.get('from')), to = point(p.get('to'));
  const direct = from && to ? directCandidates(from, to, stations, routes) : [];

  // 노선은 ODsay 후보 먼저, 그다음 직행 후보, 합쳐서 최대 10개
  const routeIds = [...new Set([...pairs.map(([r]) => r), ...direct.map((d) => d.routeId)])].slice(0, MAX_ROUTES);
  const allPairs = [...pairs, ...direct.map((d) => [d.routeId, d.fromId])].filter(([r]) => routeIds.includes(r));
  const locs = new Map(await Promise.all(routeIds.map(async (r) => [r, await busLocation(r)] as const)));

  const results: Record<string, number[] | { error: string }> = {};
  for (const [r, s] of allPairs) {
    const loc = locs.get(r)!;
    const away = loc.ok ? stopsAway(loc.stops, s) : null;
    results[`${r}:${s}`] = !loc.ok ? { error: loc.reason } : away ?? { error: '이 노선에 없는 정류장' };
  }
  return Response.json({ results, direct: direct.filter((d) => routeIds.includes(d.routeId)) });
}
