import type { Candidate } from './eta.ts';
import { WALK_M_PER_MIN } from './config.ts';

// routeIds·stationId는 제주 BIS ID (ODsay의 busLocalBlID, startLocalStationID). 실시간 조회에 쓴다.
export type Pt = { lat: number; lng: number };
export type Ride = { busNos: string[]; routeIds: string[]; stationId: string; from: string; to: string; stops: number; fromPt?: Pt; toPt?: Pt };
// fare 0 = 요금 모름 (직행 후보). noBusNow = 실시간 조회는 됐는데 오는 버스가 없음.
export type Route = { candidate: Candidate; rides: Ride[]; fare: number; odsayMin: number; noBusNow?: boolean };
export type Parsed = { ok: true; routes: Route[] } | { ok: false; reason: string };

type Sub = { trafficType: number; sectionTime?: number; distance?: number; startName?: string; endName?: string; stationCount?: number; startLocalStationID?: string; startX?: number; startY?: number; endX?: number; endY?: number; lane?: { busNo?: string; busLocalBlID?: string }[] };

const pt = (x?: number, y?: number) => (x && y ? { lat: Number(y), lng: Number(x) } : undefined);
const walkMin = (s: Sub) => s.sectionTime || Math.round((s.distance ?? 0) / WALK_M_PER_MIN);

// ODsay 대중교통 길찾기 응답 → 후보. 응답 모양이 다르면 이유를 담아 돌려준다.
export function parseOdsay(body: unknown): Parsed {
  const b = body as { error?: unknown; result?: { path?: unknown } };
  if (b?.error) {
    const e = (Array.isArray(b.error) ? b.error[0] : b.error) as { code?: string | number; msg?: string; message?: string };
    // -98: 출발지·도착지가 너무 가깝거나 경로가 없음
    if (String(e?.code) === '-98' || String(e?.code) === '3') return { ok: false, reason: '경로 없음' };
    return { ok: false, reason: `경로 API 오류 (${e?.code ?? '?'} ${e?.msg ?? e?.message ?? ''})`.trim() };
  }
  if (!Array.isArray(b?.result?.path)) return { ok: false, reason: '경로 API 응답 형식이 다름' };

  const routes: Route[] = [];
  for (const p of b.result.path as { info?: { payment?: number; totalTime?: number }; subPath?: Sub[] }[]) {
    const subs = p.subPath ?? [];
    if (!subs.length || subs.some((s) => s.trafficType === 1)) continue; // 제주는 지하철 없음, 섞여 오면 버림
    const legs: Candidate['legs'] = [];
    const rides: Ride[] = [];
    let walk = 0;
    for (const s of subs) {
      if (s.trafficType === 3) walk += walkMin(s);
      else if (s.trafficType === 2) {
        legs.push({ walkBeforeMin: walk, rideMin: s.sectionTime ?? 0 });
        const lanes = s.lane ?? [];
        rides.push({ busNos: lanes.map((l) => l.busNo ?? '?'), routeIds: lanes.map((l) => String(l.busLocalBlID ?? '')), stationId: String(s.startLocalStationID ?? ''), from: s.startName ?? '', to: s.endName ?? '', stops: s.stationCount ?? 0, fromPt: pt(s.startX, s.startY), toPt: pt(s.endX, s.endY) });
        walk = 0;
      }
    }
    if (!legs.length) continue;
    routes.push({ candidate: { legs, walkAfterMin: walk }, rides, fare: p.info?.payment ?? 0, odsayMin: p.info?.totalTime ?? 0 });
  }
  return routes.length ? { ok: true, routes } : { ok: false, reason: '경로 없음' };
}
