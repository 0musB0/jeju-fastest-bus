import { GUIDES } from '@/lib/guides';

export const metadata = { title: '제주 버스 안내', description: '제주 버스 요금과 환승, 버스 종류, 타는 법, 제주공항에서 주요 관광지 가는 버스를 정리했어요.' };

export default function GuideList() {
  return (
    <main className="doc">
      <h1>제주 버스 안내</h1>
      <p>제주 버스를 처음 타는 분도 헤매지 않도록 요금, 타는 법, 공항에서 주요 관광지 가는 버스를 정리했어요. 공항 노선은 제주특별자치도 버스정보시스템의 노선·시간표로 매달 새로 계산해요.</p>
      {GUIDES.map((g) => (
        <a className="box card-link" href={`/guide/${g.slug}`} key={g.slug}>
          <b>{g.title}</b>
          <div className="muted">{g.desc}</div>
        </a>
      ))}
    </main>
  );
}
