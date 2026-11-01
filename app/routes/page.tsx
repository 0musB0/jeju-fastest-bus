import routes from '@/data/routes.json';

export const metadata = { title: '제주 버스 노선', description: '제주 버스 모든 노선의 정류장과 시간표를 번호별로 볼 수 있어요.' };

// 번호(201-11의 201)별로 묶어 첫 자리로 나눈다. 정류장이 1개뿐인 가상 노선(수요응답형·차고지)은 뺀다.
const bases = [...new Set(routes.filter((r) => r.stops.length > 1).map((r) => r.no.split('-')[0]))].sort((a, b) => Number(a) - Number(b));
const band = (b: string) => (Number(b) >= 1000 ? Math.floor(Number(b) / 1000) * 1000 : Math.floor(Number(b) / 100) * 100);
const groups = Object.entries(Object.groupBy(bases, band)).sort(([a], [b]) => Number(a) - Number(b))
  .map(([g, nos]) => [Number(g) ? `${g}번대` : '100번 아래', nos] as const);

export default function RouteList() {
  return (
    <main className="doc">
      <h1>제주 버스 노선</h1>
      <p>번호를 누르면 그 노선이 서는 정류장과 시간표를 볼 수 있어요. 노선·시간표는 제주특별자치도 버스정보시스템 자료로 매달 새로 받아요.</p>
      {groups.map(([g, nos]) => (
        <section key={g}>
          <h2>{g}</h2>
          <div className="chips">{nos!.map((b) => <a className="chip" href={`/routes/${b}`} key={b}>{b}</a>)}</div>
        </section>
      ))}
    </main>
  );
}
