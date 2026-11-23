import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { indexData, maskOffShape, roughRide, type BusRoute, type RideMin, type Shapes, type Station } from './direct.ts';
import { offsetAt, type Timetable } from './timetable.ts';
import { walkGraph, type Walker } from './walk.ts';

// /api/plan이 쓰는 data/*.json(약 12MB)을 처음 필요할 때 읽고 한 번만 만든다.
// 예전에는 라우트 모듈이 뜰 때 전부 읽어서, 막힌 요청(403·414·429)이나 지도 선만 받는 요청도 12MB를 올렸다 (MUS2-152).
// import가 아니라 파일로 읽어 node 테스트에서도 돈다. 배포에는 next.config.ts의 outputFileTracingIncludes로 data/*.json을 함께 넣는다.
const read = <T>(name: string): T => JSON.parse(readFileSync(join(process.cwd(), 'data', name), 'utf8')) as T;

let planData: ReturnType<typeof build> | undefined;
export const getPlanData = () => (planData ??= build());

function build() {
  const stations = read<Station[]>('stations.json'), shapes = read<Shapes>('shapes.json'), timetable = read<Timetable>('timetable.json');
  const stationName = new Map(stations.map((s) => [s.id, s.name])), stationById = new Map(stations.map((s) => [s.id, s]));
  const routes = maskOffShape(read<BusRoute[]>('routes.json'), shapes, (id) => stationName.get(id), (id) => stationById.get(id));
  const routeById = new Map(routes.map((r) => [r.id, r]));
  const index = indexData(stations, routes, shapes);
  // 시간표는 노선 ID + 정류장 순번으로 저장돼 있다. 만들 때와 정류장 수가 다르면(노선만 갱신되고 시간표 갱신 실패) 순번이 어긋나므로 쓰지 않는다.
  const tableOf = (r: BusRoute | undefined) => { const e = r && timetable[r.id]; return e && e.n === r.stops.length ? e : undefined; };
  // 탑승 시간: 시간표의 정류장 간 소요, 없으면 정류장 수 × 평균 소요(정류장이 드문 노선은 거리로)
  const rideMin: RideMin = (r, i, j) => {
    const e = tableOf(r);
    const m = e ? offsetAt(e.p, j) - offsetAt(e.p, i) : 0;
    return Math.round(m >= 1 ? m : roughRide(index, r, i, j)); // 1분 미만은 시간표 보간 오차로 보고 어림값
  };
  return { stationName, stationById, routes, routeById, index, tableOf, rideMin };
}

// 걷는 길(OpenStreetMap, 7.7MB). 길이 필요한 요청에서만 읽고, 없으면 직선 × 배율로 계산한다 (한 번 실패하면 다시 읽지 않음).
let walker: Walker | undefined | null = null;
export const getWalker = (): Walker | undefined => (walker === null ? (walker = (() => { try { return walkGraph(read('walk.json')); } catch { return undefined; } })()) : walker);
