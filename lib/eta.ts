import { BOARD_MARGIN_MIN, TRANSFER_MARGIN_MIN } from './config.ts';

// 버스 한 번 타는 구간. 모든 분(min) 값은 "지금"으로부터가 아니라 구간 길이다. nextBusesMin만 "지금"부터의 분.
export type BusLeg = {
  walkBeforeMin: number; // 이 정류장까지 걷는 시간 (첫 구간은 출발지에서, 환승은 앞 정류장에서)
  nextBusesMin?: number[]; // ① 실시간: 지금부터 몇 분 뒤 도착하는지 (가까운 순)
  timetableMin?: number[]; // ② 시간표: 지금부터 몇 분 뒤 이 정류장에 오는지 (가까운 순)
  pendingMin?: number[]; // 시간표 버스 중 아직 기점을 떠나지 않아 실시간에 안 보이는 것
  intervalMin?: number; // ③ 배차 간격 (시간표가 없을 때)
  rideMin: number;
  src?: [number, string][]; // 위 분 값마다 어느 노선(routeId)의 버스인지: 화면에 실제로 탈 버스 번호 하나만 보여줌
};
export type Candidate = { legs: BusLeg[]; walkAfterMin: number };
export type WaitSource = 'realtime' | 'timetable' | 'unknown';

// 목적지 도착까지 지금부터 몇 분인지. 대기를 추정할 수 없으면 null (순위 맨 뒤).
// boards: 구간마다 버스에 타는 시각(지금부터 분), 정류장에 닿는 시각, 그 값을 어떻게 얻었는지 (화면에 환승 버스 도착을 보여줌)
export type Board = { at: number; atStop: number; how: 'realtime' | 'timetable' | 'interval' };
export function arrivalMin(c: Candidate): { min: number; source: WaitSource; boards: Board[] } | null {
  let t = 0;
  const boards: Board[] = [];
  let source: WaitSource = 'realtime';
  for (const [i, leg] of c.legs.entries()) {
    const atStop = t + leg.walkBeforeMin;
    // 환승 버스도 실시간 위치가 있으면 쓴다 (시간표가 낡았거나 빠진 노선: 292번 시간표는 하루 7회인데 실제로 더 다님, 2026-11-01)
    const buses = leg.nextBusesMin ?? [];
    // 환승 버스는 3분 이상 여유가 있어야 탈 수 있다고 본다 (빠듯한 환승은 다음 차로 계산)
    const canBoard = (b: number) => b >= atStop + (i === 0 ? BOARD_MARGIN_MIN : TRANSFER_MARGIN_MIN);
    const bus = buses.find(canBoard);
    // 실시간이 기준이다 (사용자 요청 2026-11-02). 시간표는 실시간에 안 보이는 버스, 곧 아직 기점을 떠나지 않은 버스(pending)에만 쓰고,
    // 실시간 위치를 못 받은 구간에서만 시간표 전체를 쓴다. 환승 구간도 같다.
    const pend = buses.length ? leg.pendingMin?.find(canBoard) : undefined;
    // 실시간 버스를 다 못 타면 그 뒤 시간표 버스 (시간표의 출발 순번 어림이 틀려 pending에서 빠진 버스 대비)
    const scheduled = leg.timetableMin?.find((b) => canBoard(b) && (!buses.length || b > buses[buses.length - 1]));
    let board: number;
    let how: Board['how'] = 'timetable';
    if (bus !== undefined && !(pend !== undefined && pend < bus)) (board = bus), (how = 'realtime');
    else if (pend !== undefined) {
      board = pend;
      source = 'timetable';
    } else if (scheduled !== undefined) {
      board = scheduled;
      if (i === 0) source = 'timetable';
    } else if (leg.intervalMin) {
      // 단순화: 시간표가 없는 노선은 배차 간격의 절반을 대기로 씀
      board = atStop + leg.intervalMin / 2;
      how = 'interval';
      if (i === 0) source = 'timetable';
    } else return null;
    if (i > 0 && source === 'realtime') source = 'timetable';
    boards.push({ at: board, atStop, how });
    t = board + leg.rideMin;
  }
  return { min: t + c.walkAfterMin, source, boards };
}

// "지금 + 분"을 KST 시:분으로. 서버(UTC)에서도 같은 값이 나온다.
export function kstClock(now: Date, plusMin = 0): string {
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .format(new Date(now.getTime() + plusMin * 60_000));
}

// 화면용 12시간 표기: "10:51 PM"
export function kstClock12(now: Date, plusMin = 0): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', hour: 'numeric', minute: '2-digit', hour12: true })
    .format(new Date(now.getTime() + plusMin * 60_000));
}
