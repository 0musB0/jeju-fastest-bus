import { notFound } from 'next/navigation';
import stationList from '@/data/stations.json';
import routeList from '@/data/routes.json';
import shapes from '@/data/shapes.json';
import timetable from '@/data/timetable.json';
import { maskOffShape, type BusRoute, type Shapes } from '@/lib/direct';
import { offsetAt, type Timetable } from '@/lib/timetable';

// 노선 번호 하나의 모든 가지 노선: 정류장 순서와 시간표. 빌드할 때 정적 페이지로 만든다.
const routes = maskOffShape((routeList as BusRoute[]).filter((r) => r.stops.length > 1), shapes as Shapes);
const nameOf = new Map(stationList.map((s) => [s.id, s.name.replace('(가상정류소)', '')]));
const tt = timetable as Timetable;
const sub = (no: string) => Number(no.split('-')[1] ?? 0);

export const dynamicParams = false;
export const generateStaticParams = () => [...new Set(routes.map((r) => r.no.split('-')[0]))].map((base) => ({ base }));

export async function generateMetadata({ params }: { params: Promise<{ base: string }> }) {
  const { base } = await params;
  return { title: `${base}번 버스 노선·시간표`, description: `제주 ${base}번 버스가 서는 정류장과 출발 시각이에요.` };
}

const hm = (m: number) => { const x = ((Math.round(m) % 1440) + 1440) % 1440; return `${Math.floor(x / 60)}:${String(x % 60).padStart(2, '0')}`; };
const DAYS = [[1, '평일'], [2, '토요일'], [4, '일요일·공휴일']] as const;

function Variant({ r }: { r: BusRoute }) {
  const e = tt[r.id] && tt[r.id].n === r.stops.length ? tt[r.id] : undefined;
  const stops = r.stops.map((id, k) => [id, k] as const).filter(([id]) => id);
  const first = nameOf.get(stops[0][0]), last = nameOf.get(stops.at(-1)![0]);
  // 요일별 출발 시각. 요일 구분이 없는 표면 한 줄로.
  const byDay = e && (e.m ? DAYS.map(([bit, label]) => [label, e.t.filter((_, i) => (e.m![i] & bit) !== 0)] as const).filter(([, ts]) => ts.length) : [['매일', e.t] as const]);
  return (
    <details className="box">
      <summary><b>{r.no}</b> <span className="muted">{first} → {last} · {stops.length}정류장</span></summary>
      {byDay ? byDay.map(([label, ts]) => (
        <p key={label}><b>{label} {first} 출발</b> ({ts.length}번)<br /><span className="times">{[...ts].sort((a, b) => a - b).map(hm).join('  ')}</span></p>
      )) : <p className="muted">이 노선은 시간표를 찾지 못했어요. 길찾기에서는 실시간 버스 위치로 계산해요.</p>}
      <ol className="stops">
        {stops.map(([id, k]) => <li key={k}>{nameOf.get(id)}{e && k > stops[0][1] && <span className="muted"> +{Math.round(offsetAt(e.p, k) - offsetAt(e.p, stops[0][1]))}분</span>}</li>)}
      </ol>
    </details>
  );
}

export default async function RoutePage({ params }: { params: Promise<{ base: string }> }) {
  const { base } = await params;
  const vs = routes.filter((r) => r.no.split('-')[0] === base).sort((a, b) => sub(a.no) - sub(b.no));
  if (!vs.length) notFound();
  return (
    <main className="doc">
      <p><a href="/routes">← 모든 노선</a></p>
      <h1>{base}번 버스</h1>
      <p>같은 번호라도 가지 번호(-1, -2)마다 방향과 경유지가 달라요. 눌러서 정류장과 시간표를 보세요. 정류장 옆 분은 첫 정류장에서 걸리는 시간이에요.</p>
      {vs.map((r) => <Variant r={r} key={r.id} />)}
      <p className="muted">시간표는 버스정보시스템의 주요 정류장 시각을 바탕으로 계산해서 실제와 몇 분 차이가 날 수 있어요. 지금 버스가 어디 있는지는 <a href="/">길찾기</a>에서 볼 수 있어요.</p>
    </main>
  );
}
