import type { Candidate } from './eta.ts';
import { WALK_M_PER_MIN } from './config.ts';

// routeIds·stationId는 제주 BIS ID (ODsay의 busLocalBlID, startLocalStationID). 실시간 조회에 쓴다.
export type Pt = { lat: number; lng: number };
export type Ride = { busNos: string[]; routeIds: string[]; stationId: string; from: string; to: string; stops: number; stopsBy?: number[]; toward?: string; fromPt?: Pt; toPt?: Pt; path?: Pt[]; walkPath?: Pt[]; walkAfterPath?: Pt[]; endStationId?: string }; // path = 지나는 정류장 좌표 (지도에 노선을 그림)
// fare 0 = 요금 모름 (직행 후보). noBusNow = 실시간 조회는 됐는데 오는 버스가 없음. firstBus = 오늘 운행이 끝났을 때 첫차 시각(자정부터 분).
export type Route = { candidate: Candidate; rides: Ride[]; fare: number; odsayMin: number; noBusNow?: boolean; firstBus?: number };
export type Parsed = { ok: true; routes: Route[] } | { ok: false; reason: string };

type Sub = { trafficType: number; sectionTime?: number; distance?: number; startName?: string; endName?: string; stationCount?: number; startLocalStationID?: string; endLocalStationID?: string; startX?: number; startY?: number; endX?: number; endY?: number; lane?: { busNo?: string; busLocalBlID?: string }[]; passStopList?: { stations?: { x?: string | number; y?: string | number }[] } };

// 제주 버스 요금 (카드·일반, bus.jeju.go.kr 확인 2026-10-31): 간선·지선 1,150원, 급행(1xx)은 20km까지 2,000원 + 5km마다 200원, 최대 3,000원.
// 모르는 요금 노선(리무진 600, 8xx 등)은 null.
export function legFare(busNo: string, distM: number): number | null {
  if (/^1\d\d(?!\d)/.test(busNo)) return Math.min(3000, 2000 + Math.ceil(Math.max(0, distM - 20000) / 5000) * 200);
  if (/^600(?!\d)/.test(busNo)) return null; // 공항리무진은 요금 체계가 다름
  return /^[2-7]\d\d(?!\d)/.test(busNo) ? 1150 : null;
}
// 환승은 내린 뒤 40분 안에 2번까지 무료(더 비싼 버스로 갈아타면 차액만) → 3대마다 가장 비싼 한 대 요금.
// ODsay 요금은 구간 요금을 그냥 더한 값이라(301+101 = 4,150원) 직접 계산하고, 모르는 노선이 섞이면 ODsay 값을 쓴다.
// 단순화: 환승까지 40분을 넘기지 않는다고 봄.
export function routeFare(legs: (number | null)[], odsayFare: number): number {
  if (!legs.length || legs.some((f) => f === null)) return odsayFare;
  let total = 0;
  for (let i = 0; i < legs.length; i += 3) total += Math.max(...(legs.slice(i, i + 3) as number[]));
  return total;
}

// ODsay가 2026-10-31부터 제주 ID 앞에 "JEB"를 붙여 준다 (JEB405579101). 숫자만 남긴다.
const bisId = (v?: string | number) => String(v ?? '').replace(/^\D+/, '');
const pt = (x?: number | string, y?: number | string) => (x && y ? { lat: Number(y), lng: Number(x) } : undefined);
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
    const fares: (number | null)[] = [];
    let walk = 0;
    for (const s of subs) {
      if (s.trafficType === 3) walk += walkMin(s);
      else if (s.trafficType === 2) {
        legs.push({ walkBeforeMin: walk, rideMin: s.sectionTime ?? 0 });
        const lanes = s.lane ?? [];
        rides.push({ busNos: lanes.map((l) => l.busNo ?? '?'), routeIds: lanes.map((l) => bisId(l.busLocalBlID)), stationId: bisId(s.startLocalStationID), endStationId: bisId(s.endLocalStationID), from: s.startName ?? '', to: s.endName ?? '', stops: s.stationCount ?? 0, fromPt: pt(s.startX, s.startY), toPt: pt(s.endX, s.endY), path: s.passStopList?.stations?.flatMap((st) => pt(st.x, st.y) ?? []) });
        // 같은 구간을 여러 노선이 다니면 요금을 아는 노선 중 비싼 쪽 (모르는 노선만 있으면 null)
        const known = lanes.flatMap((l) => legFare(l.busNo ?? '', s.distance ?? 0) ?? []);
        fares.push(known.length ? Math.max(...known) : null);
        walk = 0;
      }
    }
    if (!legs.length) continue;
    routes.push({ candidate: { legs, walkAfterMin: walk }, rides, fare: routeFare(fares, p.info?.payment ?? 0), odsayMin: p.info?.totalTime ?? 0 });
  }
  return routes.length ? { ok: true, routes } : { ok: false, reason: '경로 없음' };
}
