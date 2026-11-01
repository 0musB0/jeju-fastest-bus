import { notFound } from 'next/navigation';
import stationList from '@/data/stations.json';
import routeList from '@/data/routes.json';
import shapes from '@/data/shapes.json';
import timetable from '@/data/timetable.json';
import { maskOffShape, type BusRoute, type Pt, type Shapes } from '@/lib/direct';
import { departures, offsetAt, type Timetable } from '@/lib/timetable';
import { RouteLine } from '@/app/RouteMap';

// 노선 번호 하나의 모든 가지 노선: 정류장 순서와 시간표. 빌드할 때 정적 페이지로 만든다.
const nameOf = new Map(stationList.map((s) => [s.id, s.name.replace('(가상정류소)', '')]));
const rawName = new Map(stationList.map((s) => [s.id, s.name]));
const ptOf = new Map(stationList.map((s) => [s.id, { lat: s.lat, lng: s.lng }]));
const routes = maskOffShape((routeList as BusRoute[]).filter((r) => r.stops.length > 1), shapes as Shapes, (id) => rawName.get(id));
const shp = shapes as Shapes;
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

// 지도 선: 사이트 노선 모양(없으면 정류장을 이은 선). 페이지가 무거워지지 않게 점을 250개 안쪽으로 솎는다
function linePath(r: BusRoute, stops: (readonly [string, number])[]): Pt[] {
  const p = shp[r.id]?.p;
  const pts = p && p.length >= 4 ? Array.from({ length: p.length / 2 }, (_, i) => ({ lat: p[2 * i], lng: p[2 * i + 1] })) : stops.map(([id]) => ptOf.get(id)!).filter(Boolean);
  const step = Math.ceil(pts.length / 250);
  return pts.filter((_, i) => i % step === 0 || i === pts.length - 1);
}

function Variant({ r, shared }: { r: BusRoute; shared: boolean }) {
  const e = tt[r.id] && tt[r.id].n === r.stops.length ? tt[r.id] : undefined;
  const stops = r.stops.map((id, k) => [id, k] as const).filter(([id]) => nameOf.has(id)); // 정류장 목록에 없는 ID(종점 뒤 꼬리)는 뺀다
  const first = nameOf.get(stops[0][0]), last = nameOf.get(stops.at(-1)![0]), o0 = stops[0][1];
  // 요일별로 첫 정류장을 떠나는 시각. 중간 정류장에서 출발하는 운행은 첫 정류장에 오지 않으니 뺀다.
  const at = (bit: number) => departures(e!, o0, bit).map((t) => t + offsetAt(e!.p, o0)).sort((a, b) => a - b);
  const byDay = e && (e.m ? DAYS.map(([bit, label]) => [label, at(bit)] as const).filter(([, ts]) => ts.length) : [['매일', at(7)] as const]);
  const mid = e?.s?.filter((x) => x > o0).length ?? 0;
  return (
    <details className="box">
      <summary><b>{r.no}</b> <span className="muted">{first} → {last} · {stops.length}정류장</span></summary>
      <RouteLine path={linePath(r, stops)} />
      {byDay ? byDay.map(([label, ts]) => (
        <p key={label}><b>{label} {first} 출발</b> ({ts.length}번)<br /><span className="times">{ts.map(hm).join('  ')}</span></p>
      )) : <p className="muted">이 노선은 시간표를 찾지 못했어요. 길찾기에서는 실시간 버스 위치로 계산해요.</p>}
      {mid > 0 && <p className="muted">중간 정류장에서 출발하는 {mid}번은 위 목록에서 뺐어요.</p>}
      {shared && <p className="muted">같은 방향의 다른 가지와 시간표가 같아요. 버스정보시스템 시간표가 가지별로 나뉘어 있지 않아서, 이 중 일부만 이 가지로 다닐 수 있어요.</p>}
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
      {/^[35]\d{3}$/.test(base) && <p className="warn">심야버스예요. 밤 10시 넘어서만 다니고, 낮에는 운행하지 않아요.</p>}
      <p>같은 번호라도 가지 번호(-1, -2)마다 방향과 경유지가 달라요. 눌러서 정류장과 시간표를 보세요. 정류장 옆 분은 첫 정류장에서 걸리는 시간이에요.</p>
      {vs.map((r) => {
        const key = tt[r.id]?.n === r.stops.length ? tt[r.id].t.join() : '';
        return <Variant r={r} key={r.id} shared={!!key && vs.some((o) => o !== r && tt[o.id]?.n === o.stops.length && tt[o.id].t.join() === key)} />;
      })}
      <p className="muted">시간표는 버스정보시스템의 주요 정류장 시각을 바탕으로 계산해서 실제와 몇 분 차이가 날 수 있어요. 지금 버스가 어디 있는지는 <a href="/">길찾기</a>에서 볼 수 있어요.</p>
    </main>
  );
}
