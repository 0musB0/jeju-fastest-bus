import { arrivalMin } from './eta.ts';
import type { Followed } from './follow.ts';
import type { Route } from './odsay.ts';
import type { Trip } from './direct.ts';
import { applyRealtime, sameRide, tripsToRoutes, type Headways, type PlanResults, type Schedules } from './realtime.ts';

// 후보(ODsay 경로 + 우리 경로) → 실시간·시간표를 반영한 순위와 화면에 보일 경로. 외부 호출 없음 (app/page.tsx의 plan에서 분리, MUS2-152).
// ranked = 거르기 전 전체(대기를 아는 후보가 먼저, 도착 빠른 순), shown = 걸러서 남은 것, endedList = 오늘 운행이 끝난 경로
export function rankRoutes(odsay: Route[], trips: Trip[], results: PlanResults, headways: Headways, sched: Schedules, nowMin: number): { ranked: Followed[]; shown: Followed[]; endedList: Followed[] } {
  // 이동 시간만으로 거르지 않는다: 대기까지 더한 도착 시각으로만 비교한다
  // 같은 버스·정류장 조합이면 우리 후보를 쓴다: 탑승 시간이 시간표 기준이고 가지 노선이 모두 묶여 있다.
  // ODsay 쪽을 남겼더니 ODsay의 긴 탑승 시간 때문에 바로 가는 355번이 아라초 환승 경로보다 뒤로 밀렸다 (2026-11-02)
  const byTime = [...odsay.filter((o) => !trips.some((t) => sameRide(o, t))), ...tripsToRoutes(trips, [])];
  // 대기를 알 수 있는 후보가 먼저, 그 안에서 도착이 빠른 순. 모르면 이동 시간 순으로 맨 뒤.
  const ranked: Followed[] = byTime
    .map((r) => applyRealtime(r, results, headways, sched))
    .map((r) => ({ ...r, eta: arrivalMin(r.candidate) }))
    .sort((a, b) => (a.eta ? 0 : 1) - (b.eta ? 0 : 1) || (a.eta?.min ?? a.odsayMin) - (b.eta?.min ?? b.odsayMin));
  // 오늘 운행이 끝나 내일 첫차를 타야 하는 경로는 보여주지 않는다 (첫차 전 새벽은 오늘 안이라 그대로 둠)
  // 환승 버스도 시간표는 있는데 오늘 남은 차가 없으면(서버가 첫차 시각만 줌) 끝난 것으로 본다
  const transferEnded = (r: Route) => r.candidate.legs.some((l, i) => i > 0 && !l.timetableMin && !l.nextBusesMin?.length && !l.intervalMin
    && r.rides[i].routeIds.some((id) => sched.firstBus?.[`${id}:${r.rides[i].stationId}`] !== undefined));
  const ended = (r: Followed) => !r.eta && ((r.firstBus !== undefined && r.firstBus <= nowMin) || transferEnded(r));
  // 같은 정류장에서 같은 버스를 타고 갈아타지 않고 가는 후보가 더 빠르거나 같으면, 중간에 갈아타는 후보는 뺀다 (355번 그대로 vs 아라초 환승)
  // 같은 버스(노선)를 더 먼 정류장에서 타는 후보도, 가까운 쪽 후보가 더 빠르거나 같으면 뺀다 (제주시청에서 탈 수 있는 341·342를 법원까지 18분 걸어가서 타라고 함).
  // 버스가 가까운 정류장을 이미 지나쳤다면 먼 쪽 후보가 더 빨라서 남는다. 같으면 덜 걷는 쪽.
  const walkOf = (r: Route) => r.candidate.legs.reduce((s, l) => s + l.walkBeforeMin, r.candidate.walkAfterMin);
  const detour = (r: Followed) => ranked.some((q) => q !== r && q.eta && r.eta && q.rides.length <= r.rides.length
    && q.rides[0].routeIds.some((id) => r.rides[0].routeIds.includes(id))
    && (q.rides.length < r.rides.length ? q.eta.min <= r.eta.min : q.eta.min < r.eta.min || (q.eta.min === r.eta.min && walkOf(q) < walkOf(r))));
  // 도착 시각을 낼 수 없는 경로(갈아탈 버스가 지금 안 다님: 낮에 심야 3006번 등)는, 계산되는 경로가 하나라도 있으면 뺀다.
  // 남겨 두면 첫 버스 칸에 "운행 버스 없음"처럼 엉뚱한 이유가 보였다 (신화월드 → 함덕, 2026-11-02)
  const anyEta = ranked.some((r) => r.eta && !ended(r) && !detour(r));
  const shown = ranked.filter((r) => !ended(r) && !detour(r) && (r.eta || !anyEta));
  return { ranked, shown, endedList: ranked.filter(ended) };
}
