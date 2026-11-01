import { notFound } from 'next/navigation';
import stations from '@/data/stations.json';
import routes from '@/data/routes.json';
import timetable from '@/data/timetable.json';
import { GUIDES, airportRides, type Guide } from '@/lib/guides';
import type { Timetable } from '@/lib/timetable';

// 버스 안내 글. 빌드할 때 정적 페이지로 만든다(공항 노선 표는 매달 갱신되는 data/*.json에서).
export const dynamicParams = false;
export const generateStaticParams = () => GUIDES.map((g) => ({ slug: g.slug }));

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const g = GUIDES.find((x) => x.slug === slug);
  return g ? { title: g.title, description: g.desc } : {};
}

const hm = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;

function AirportTable({ g }: { g: Guide }) {
  const rides = airportRides(stations, routes, timetable as Timetable, g.airport!.re);
  if (!rides.length) return <p>지금 데이터로는 공항에서 {g.airport!.place}까지 갈아타지 않고 가는 버스를 찾지 못했어요. <a href="/">길찾기</a>에서 환승 경로를 확인해 주세요.</p>;
  return (
    <>
      <p>제주국제공항 버스 정류장에서 {g.airport!.place}까지 <b>갈아타지 않고</b> 가는 버스예요. 빨리 도착하는 순서로 정리했어요.</p>
      {rides.map((r) => (
        <div className="box" key={r.no}>
          <div className="row"><span className="chip">{r.no}</span><span className="muted">{r.to} 방면 · {r.variant}</span></div>
          <div>약 <b>{r.min}분</b> · {r.stops}정류장{r.first === undefined && <span className="muted"> (정류장 수로 어림)</span>}</div>
          {r.first !== undefined && <div className="muted">평일 공항 출발 {hm(r.first)} ~ {hm(r.last!)} · 하루 {r.perDay}번</div>}
        </div>
      ))}
      <p className="muted">같은 번호라도 가지 번호(-1, -2)에 따라 경유지가 달라서 시간이 다를 수 있어요. 600번대·800번대 공항버스는 일반 버스와 요금이 달라요(<a href="/guide/fare">요금 안내</a>). 시각은 버스정보시스템 시간표를 바탕으로 계산한 값이라 실제와 몇 분 차이가 날 수 있고, 주말·공휴일에는 달라져요.</p>
      <h2>더 빨리 가는 방법이 있을 수 있어요</h2>
      <p>직행 버스가 꼭 가장 빠른 건 아니에요. 다음 직행이 40분 뒤라면, 지금 오는 다른 버스를 타고 한 번 갈아타는 쪽이 먼저 도착하기도 해요. <a href="/">혼저 탑서 길찾기</a>에 출발지와 도착지를 넣으면 지금 버스 위치와 시간표를 함께 보고 도착이 가장 빠른 경로를 알려드려요.</p>
      <p>공항에서 내려 바로 찾기 어렵다면 공항 버스 승차장에서 <b>번호와 방면</b>을 같이 확인하세요. 같은 번호라도 반대 방향으로 가는 버스가 있어요.</p>
    </>
  );
}

const BODIES: Record<string, React.ReactNode> = {
  fare: (
    <>
      <p>제주 버스 요금은 버스 종류에 따라 다르고, 내린 뒤 40분 안에 갈아타면 두 번까지 무료예요. 교통카드 기준 일반(어른) 요금이에요.</p>
      <h2>버스 종류별 요금</h2>
      <ul>
        <li><b>간선·지선 버스:</b> 1,150원. 제주시·서귀포 시내와 마을을 다니는 대부분의 버스예요.</li>
        <li><b>급행 버스(100번대):</b> 20km까지 2,000원, 그 뒤로 5km마다 200원씩 더해 최대 3,000원이에요. 정류장을 적게 서서 먼 거리를 빨리 가요.</li>
        <li><b>공항버스(600번대·800번대 등):</b> 요금 체계가 따로 있어요. 타기 전에 버스 앞 요금표를 확인하세요.</li>
      </ul>
      <h2>환승은 두 번까지 무료</h2>
      <p>버스에서 내린 뒤 <b>40분 안에</b> 다른 버스로 갈아타면 요금을 다시 내지 않아요. 두 번까지 무료라서 버스 세 대를 타도 한 번 요금만 내요.</p>
      <ul>
        <li>더 비싼 버스로 갈아타면 <b>차액만</b> 내요. 예를 들어 간선(1,150원)을 타고 급행(2,000원)으로 갈아타면 850원을 더 내요.</li>
        <li>환승을 인정받으려면 <b>내릴 때도 카드를 찍어야</b> 해요. 하차 태그를 빠뜨리면 다음 버스에서 요금을 다시 내요.</li>
        <li>현금으로 내면 환승 할인이 없어요.</li>
      </ul>
      <h2>얼마나 드는지 미리 보기</h2>
      <p><a href="/">혼저 탑서 길찾기</a> 결과에는 환승 무료를 반영한 요금이 함께 나와요. 다만 공항버스처럼 요금 체계가 다른 노선이 섞이면 실제 요금과 다를 수 있어요.</p>
      <p className="muted">요금은 2026년 10월 제주특별자치도 버스정보시스템 기준이에요. 요금이 바뀌면 이 글도 고칠게요.</p>
    </>
  ),
  'bus-types': (
    <>
      <p>제주 버스는 크게 급행·간선·지선으로 나뉘고, 버스 색과 번호로 구분할 수 있어요.</p>
      <h2>색으로 구분하기</h2>
      <ul>
        <li><b>빨간 버스, 급행:</b> 제주시와 서귀포, 공항과 동·서쪽 끝을 큰 정류장만 서며 빠르게 이어요. 번호가 100번대예요.</li>
        <li><b>파란 버스, 간선:</b> 큰길을 따라 여러 마을을 잇는 기본 노선이에요.</li>
        <li><b>초록 버스, 지선:</b> 간선이 닿지 않는 마을 안쪽까지 들어가요. 배차 간격이 긴 편이에요.</li>
      </ul>
      <h2>"-1", "-2"는 무슨 뜻인가요?</h2>
      <p>같은 번호 뒤에 붙는 가지 번호는 <b>방향이나 경유지가 다른 운행</b>이에요. 예를 들어 182-1과 182-2는 같은 182번이지만 도는 방향이나 들르는 곳이 달라요. 버스 앞 전광판에는 보통 큰 번호(182)와 방면이 함께 나오니, <b>번호와 방면을 같이</b> 확인하세요.</p>
      <h2>어떤 버스가 가장 빠를까?</h2>
      <p>급행이 빠르긴 하지만 배차 간격이 길면 기다리는 시간 때문에 오히려 늦게 도착할 수 있어요. 혼저 탑서는 걷는 시간, 기다리는 시간, 타는 시간을 모두 더해 <b>목적지에 가장 먼저 닿는 버스</b>를 골라드려요. <a href="/about">계산 방법 보기</a></p>
    </>
  ),
  'how-to-ride': (
    <>
      <p>제주 버스는 육지 시내버스와 크게 다르지 않지만, 처음 타면 실수하기 쉬운 것들이 있어요.</p>
      <h2>1. 길 건너편에 같은 이름 정류장이 있어요</h2>
      <p>대부분의 정류장은 길 양쪽에 같은 이름으로 있어요. 반대쪽에서 타면 반대 방향으로 가요. 정류장 표지판의 <b>다음 정류장</b> 이름을 보고 내가 가려는 방향이 맞는지 확인하세요. 혼저 탑서는 노선 방향에 맞는 쪽 정류장을 골라서 알려드려요.</p>
      <h2>2. 탈 때도, 내릴 때도 카드를 찍어요</h2>
      <p>앞문으로 타면서 카드를 찍고, 뒷문으로 내리면서 한 번 더 찍어요. 내릴 때 찍어야 40분 안 무료 환승이 적용돼요. 티머니·캐시비 같은 교통카드와 교통카드 기능이 있는 신용·체크카드를 쓸 수 있어요. <a href="/guide/fare">요금과 환승 자세히 보기</a></p>
      <h2>3. 시골 노선은 한 시간에 한 대일 수 있어요</h2>
      <p>시내는 버스가 자주 오지만, 마을과 해안 쪽 노선은 배차 간격이 30분에서 한 시간이 넘기도 해요. 막차도 이른 편이라 저녁에는 꼭 시간을 확인하세요. 혼저 탑서는 실시간 위치가 없을 때 시간표로 다음 버스를 알려드리고, 첫차 전이나 막차 뒤에는 따로 안내해요.</p>
      <h2>4. 가까운 정류장이 늘 정답은 아니에요</h2>
      <p>걸어서 2분 거리 정류장의 버스가 25분 뒤에 오고, 6분 거리 정류장의 버스가 8분 뒤에 온다면 멀리 걸어가는 쪽이 17분 먼저 도착해요. 혼저 탑서는 이런 경우까지 비교해서 알려드려요.</p>
      <h2>5. 내릴 정류장이 다가오면 벨을 눌러요</h2>
      <p>버스 안 전광판과 안내 방송으로 다음 정류장을 알려줘요. 내릴 정류장 전에 벨을 누르지 않으면 서지 않고 지나갈 수 있어요.</p>
    </>
  ),
};

export default async function GuidePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const g = GUIDES.find((x) => x.slug === slug);
  if (!g) notFound();
  return (
    <main className="doc">
      <p className="muted"><a href="/guide">버스 안내</a></p>
      <h1>{g.title}</h1>
      {g.airport ? <AirportTable g={g} /> : BODIES[g.slug]}
      <h2>다른 안내</h2>
      <ul>{GUIDES.filter((x) => x.slug !== g.slug).map((x) => <li key={x.slug}><a href={`/guide/${x.slug}`}>{x.title}</a></li>)}</ul>
    </main>
  );
}
