import { indexData, roughRide, type BusRoute, type Station } from './direct.ts';
import { offsetAt, WEEKDAY, type Timetable } from './timetable.ts';

// 버스 안내 글 목록. 본문은 app/guide/[slug]/page.tsx. airport가 있는 글은 노선 표를 data/*.json으로 빌드할 때 만든다.
export type Guide = { slug: string; title: string; desc: string; airport?: { place: string; re: RegExp } };
export const GUIDES: Guide[] = [
  { slug: 'fare', title: '제주 버스 요금과 무료 환승', desc: '간선·지선·급행 요금, 40분 안에 두 번까지 무료인 환승 규칙을 정리했어요.' },
  { slug: 'bus-types', title: '제주 버스 종류와 번호 읽는 법', desc: '급행·간선·지선 버스의 색과 번호, "-1", "-2"가 붙는 이유를 알려드려요.' },
  { slug: 'how-to-ride', title: '처음 타는 제주 버스, 이것만 알면 돼요', desc: '길 건너편 같은 이름 정류장, 카드 찍기, 배차 간격이 긴 노선까지 실수하기 쉬운 것들.' },
  { slug: 'airport-seongsan', title: '제주공항에서 성산일출봉 가는 버스', desc: '공항에서 성산일출봉·성산항으로 갈아타지 않고 가는 버스와 걸리는 시간.', airport: { place: '성산일출봉', re: /성산일출봉|성산항/ } },
  { slug: 'airport-seogwipo', title: '제주공항에서 서귀포 시내 가는 버스', desc: '공항에서 서귀포 중앙로터리·버스터미널까지 한 번에 가는 버스와 첫차·막차.', airport: { place: '서귀포 시내', re: /중앙로터리|서귀포버스터미널|서귀포등기소/ } },
  { slug: 'airport-jungmun', title: '제주공항에서 중문관광단지 가는 버스', desc: '공항에서 중문까지 한 번에 가는 버스, 걸리는 시간과 운행 횟수.', airport: { place: '중문', re: /중문/ } },
  { slug: 'airport-hyeopjae', title: '제주공항에서 협재·한림 가는 버스', desc: '공항에서 서쪽 바다 협재해수욕장·한림까지 가는 버스.', airport: { place: '협재·한림', re: /협재|한림/ } },
  { slug: 'airport-hamdeok', title: '제주공항에서 함덕해수욕장 가는 버스', desc: '공항에서 동쪽 함덕해수욕장까지 가는 버스와 걸리는 시간.', airport: { place: '함덕', re: /함덕/ } },
];

// 공항 정류장. "하차전용"은 탈 수 없어서 뺀다.
const AIRPORT = /^제주국제공항(?!.*하차전용)/;

// no = 버스에 붙은 번호(가지 번호 뺌), first·last = 평일 공항 출발 시각(자정부터 분), perDay = 평일 운행 수
export type Ride = { no: string; variant: string; to: string; stops: number; min: number; first?: number; last?: number; perDay?: number };

// 공항 → 목적지를 갈아타지 않고 가는 노선. 같은 번호는 가장 빠른 가지 하나만, 빠른 순으로 max개.
// 가장 빠른 버스보다 1.6배 넘게 걸리는 노선(빙 돌아가는 순환 등)은 뺀다.
// 단순화: 시간표가 없는 노선은 정류장 수로 어림한 시간만 보여준다.
export function airportRides(stations: Station[], routes: BusRoute[], tt: Timetable, dest: RegExp, max = 6): Ride[] {
  const ix = indexData(stations, routes);
  const name = (id: string) => ix.byId.get(id)?.name ?? '';
  const best = new Map<string, Ride>();
  for (const r of routes) {
    const i = r.stops.findIndex((id) => AIRPORT.test(name(id)));
    const j = i < 0 ? -1 : r.stops.findIndex((id, k) => k > i && dest.test(name(id)));
    if (j < 0) continue;
    const e = tt[r.id]?.n === r.stops.length ? tt[r.id] : undefined;
    const min = Math.round(e ? offsetAt(e.p, j) - offsetAt(e.p, i) : roughRide(ix, r, i, j));
    const ride: Ride = { no: r.no.split('-')[0], variant: r.no, to: r.to, stops: j - i, min };
    if (e) {
      const ts = e.t.filter((_, k) => ((e.m?.[k] ?? WEEKDAY) & WEEKDAY) !== 0).map((t) => (Math.round(t + offsetAt(e.p, i)) + 1440) % 1440);
      if (ts.length) Object.assign(ride, { first: Math.min(...ts), last: Math.max(...ts), perDay: ts.length });
    }
    const had = best.get(ride.no);
    if (!had || ride.min < had.min) best.set(ride.no, ride);
  }
  const out = [...best.values()].sort((a, b) => a.min - b.min);
  return out.filter((r) => r.min <= out[0].min * 1.6).slice(0, max);
}
