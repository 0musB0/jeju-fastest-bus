import { BOARD_MARGIN_MIN } from './config.ts';

// 버스 한 번 타는 구간. 모든 분(min) 값은 "지금"으로부터가 아니라 구간 길이다. nextBusesMin만 "지금"부터의 분.
export type BusLeg = {
  walkBeforeMin: number; // 이 정류장까지 걷는 시간 (첫 구간은 출발지에서, 환승은 앞 정류장에서)
  nextBusesMin?: number[]; // ① 실시간: 지금부터 몇 분 뒤 도착하는지 (가까운 순)
  intervalMin?: number; // ② 배차 간격
  rideMin: number;
};
export type Candidate = { legs: BusLeg[]; walkAfterMin: number };
export type WaitSource = 'realtime' | 'timetable' | 'unknown';

// 목적지 도착까지 지금부터 몇 분인지. 대기를 추정할 수 없으면 null (순위 맨 뒤).
export function arrivalMin(c: Candidate): { min: number; source: WaitSource } | null {
  let t = 0;
  let source: WaitSource = 'realtime';
  for (const [i, leg] of c.legs.entries()) {
    const atStop = t + leg.walkBeforeMin;
    // 환승 후 두 번째 버스부터는 항상 시간표 기준으로 계산한다.
    const buses = i === 0 ? (leg.nextBusesMin ?? []) : [];
    const bus = buses.find((b) => b >= atStop + BOARD_MARGIN_MIN);
    let board: number;
    if (bus !== undefined) board = bus;
    else if (leg.intervalMin) {
      // 단순화: 시간표 대신 배차 간격의 절반을 대기로 씀, 정류장 시간표가 생기면 교체
      board = atStop + leg.intervalMin / 2;
      if (i === 0) source = 'timetable';
    } else return null;
    if (i > 0 && source === 'realtime') source = 'timetable';
    t = board + leg.rideMin;
  }
  return { min: t + c.walkAfterMin, source };
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
