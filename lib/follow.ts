import { BOARD_MARGIN_MIN } from './config.ts';
import { arrivalMin, type Board } from './eta.ts';
import type { Route } from './odsay.ts';
import { applyRealtime, type Headways, type PlanResults, type Schedules } from './realtime.ts';

// "이 경로로 갈게요"로 따라가는 경로 (순수 함수만, 화면 상태는 app/page.tsx)
// rode = 이미 탄 구간 수 (1 = 첫 버스 안, 2 = 첫 환승 버스 안 …)
// bus = 탄 버스의 실시간 위치 키("노선:내릴 정류장")와 내릴 곳까지 남은 정류장 수 (화면에 지금 위치 표시)
export type Followed = Route & { eta: ReturnType<typeof arrivalMin>; rode?: number; bus?: { key: string; left: number } };
// 탄 것으로 본 순간의 계산: r은 t(ms)에 계산한 경로, k는 그때까지 탄 구간 수
export type Frozen = { r: Followed; t: number; k: number };

// 계산 시각이 gone분 지났을 때 같은 경로를 "지금 기준"으로 (남은 분과 탈 시각을 당김)
export function shift<T extends Followed>(r: T, gone: number): T {
  if (!r.eta) return r;
  const boards = r.eta.boards.map((b) => ({ ...b, at: b.at - gone, atStop: b.atStop - gone }));
  return { ...r, eta: { ...r.eta, min: Math.max(0, r.eta.min - gone), boards } };
}

// 따라가기를 누른 뒤 walked분 동안 정류장으로 걸어갔다고 보고 첫 걷기를 줄여 다시 계산한다.
// 출발지는 누른 곳 그대로라, 줄이지 않으면 버스가 정류장에 다가와도 "아직 못 탐"으로 계산돼 지나감을 알아채지 못한다.
export function walking<T extends Followed>(r: T, walked: number): T {
  const legs = r.candidate.legs.map((l, j) => (j ? l : { ...l, walkBeforeMin: Math.max(0, l.walkBeforeMin - walked) }));
  const eta = arrivalMin({ ...r.candidate, legs });
  return eta ? { ...r, candidate: { ...r.candidate, legs }, eta } : r;
}

// 타려던 버스가 정류장을 지나갔는지 (모두 절대 시각, 분).
// 지난 계산에서 2분 안에 올 버스였는데 새 계산의 탈 시각이 3분 넘게 늦어지면 그 버스는 지나간 것(탔거나 놓침).
// 아직 멀리 있는 버스가 늦어진 건(지연·실시간 어림 변화) 지나간 게 아니다.
export function passed(prevBoard: number, nextBoard: number, now: number): boolean {
  return prevBoard - now <= 2 && nextBoard > prevBoard + 3;
}

// 탄 버스의 실제 위치로 내릴 때까지 남은 분. 실시간에 없으면 null (시간표대로 간다고 봄).
// 시간표대로만 두면 늦는 버스를 못 따라간다: 270번 제주대→상귀동카름, 시간표 54분인데 월요일 퇴근길에 약 75분 걸렸고
// 화면은 끝까지 7:14 도착이라고 했다 (실제 7:36, 2026-11-02 사용자 실측).
// 내릴 정류장까지 남은 정류장 수 중 탈 정류장을 지난 버스(구간 정류장 수보다 적게 남음), 그중 시간표상 지금 있을 곳에 가장 가까운 버스를 내 버스로 본다.
// 단순화: 남은 구간은 계획한 탑승 시간을 정류장 수로 나눠 씀, 뒤차가 내 버스보다 시간표 위치에 더 가까우면 잘못 고름
export function onBus(ride: Route['rides'][number] | undefined, id: string | undefined, rideMin: number, planned: number, results: PlanResults): { min: number; key: string; left: number } | null {
  const rid = id ?? ride?.routeIds.find(Boolean), key = ride?.endStationId && `${rid}:${ride.endStationId}`;
  // 가지 노선마다 정류장 수가 다르다 (급행 111은 8개, 같은 구간 212는 56개)
  const span = (rid && ride?.stopsBy?.[ride.routeIds.indexOf(rid)]) || ride?.stops || 0;
  const away = key ? results[key] : undefined;
  if (!Array.isArray(away) || !span || !rideMin) return null;
  const expect = (span * Math.min(Math.max(planned, 0), rideMin)) / rideMin;
  // 시간표 위치보다 구간 절반 넘게 뒤처진 버스는 뒤차로 본다 (내 버스는 이미 내릴 정류장을 지남)
  const mine = away.filter((a) => a < span && a <= expect + span / 2).sort((a, b) => Math.abs(a - expect) - Math.abs(b - expect))[0];
  return mine === undefined || !key ? null : { min: (rideMin * mine) / span, key, left: mine };
}

// 탄 버스 안: 탄 구간은 끝난 것으로, 지금 탄 버스는 남은 탑승 시간만, 그 뒤 환승 버스는 새 실시간·시간표로 다시 계산한다.
// 다시 계산할 수 없으면(환승 버스 정보 없음) 고정한 시각을 그대로 쓴다.
// 탄 버스의 남은 시간은 onBus(실제 위치), 없으면 시간표 탑승 시간대로
export function riding(f: Frozen, nowMs: number, results: PlanResults, headways: Headways, sched: Schedules): Followed {
  const { k } = f, now = nowMs / 60000, base = f.t / 60000;
  const fixed = { ...shift(f.r, now - base), rode: k };
  if (!f.r.eta) return fixed;
  const B = f.r.eta.boards, L = f.r.candidate.legs;
  const bare = { ...f.r, candidate: { ...f.r.candidate, legs: L.map((l) => ({ walkBeforeMin: l.walkBeforeMin, rideMin: l.rideMin })) } };
  const re = applyRealtime(bare, results, headways, sched);
  // 어느 노선 버스를 탔는지는 그대로 (화면에 번호 하나만 보여줌)
  const src = (j: number) => {
    const id = L[j].src?.find(([m]) => Math.abs(m - B[j].at) < 1e-6)?.[1];
    return id ? { src: [[0, id]] as [number, string][] } : {};
  };
  const done = L.slice(0, k - 1).map((_, j) => ({ walkBeforeMin: 0, rideMin: 0, nextBusesMin: [0], ...src(j) }));
  const planned = base + B[k - 1].at + L[k - 1].rideMin - now; // 시간표대로 가면 내릴 때까지 남은 분 (음수 = 이미 내림)
  const live = onBus(f.r.rides[k - 1], L[k - 1].src?.find(([m]) => Math.abs(m - B[k - 1].at) < 1e-6)?.[1], L[k - 1].rideMin, planned, results);
  const off = live?.min ?? planned, bus = live ? { bus: { key: live.key, left: live.left } } : {};
  const tail = re.candidate.legs.slice(k), zero: Board = { at: 0, atStop: 0, how: 'realtime' };
  if (off <= 0) {
    // 이미 내렸으면 다음 정류장(또는 목적지)으로 그만큼 걸어갔다고 보고, 다음 버스는 첫 버스처럼(1분 여유) 계산한다.
    // 환승 3분 여유를 그대로 두면 정류장에 서 있는데 곧 오는 버스를 못 탄다고 계산했다.
    const walked = tail.map((l, j) => (j ? l : { ...l, walkBeforeMin: Math.max(0, l.walkBeforeMin + off) }));
    const walkAfterMin = tail.length ? re.candidate.walkAfterMin : Math.max(0, re.candidate.walkAfterMin + off);
    const eta = arrivalMin({ legs: walked, walkAfterMin });
    if (!eta) return fixed;
    const doneAll = [...done, { walkBeforeMin: 0, rideMin: 0, nextBusesMin: [0], ...src(k - 1) }];
    return { ...re, rode: k, candidate: { legs: [...doneAll, ...walked], walkAfterMin }, eta: { ...eta, boards: [...doneAll.map(() => zero), ...eta.boards] } };
  }
  // walkBeforeMin을 -여유로 둬서 "지금(0분) 타는 버스"가 되게 함
  const on = { walkBeforeMin: -BOARD_MARGIN_MIN, nextBusesMin: [0], rideMin: off, ...src(k - 1) };
  const eta = arrivalMin({ legs: [on, ...tail], walkAfterMin: re.candidate.walkAfterMin });
  if (!eta) return fixed;
  return { ...re, rode: k, ...bus, candidate: { ...re.candidate, legs: [...done, on, ...tail] }, eta: { ...eta, boards: [...done.map(() => zero), ...eta.boards] } };
}
