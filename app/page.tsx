'use client';
import { useEffect, useState } from 'react';
import { kstClock12 as kstClock } from '@/lib/eta';
import { dur, routeKey } from '@/lib/format';
import PlacePicker from './PlacePicker';
import RouteCard from './RouteCard';
import RouteMap from './RouteMap';
import { useMyLocation } from './useMyLocation';
import { usePlanner } from './usePlanner';
import type { Place } from '@/lib/storage';

// 구글 애드센스 광고 1자리(결과 아래). 게시자 ID와 광고 단위 ID가 둘 다 있을 때만 나온다.
const AD_CLIENT = process.env.NEXT_PUBLIC_ADSENSE_CLIENT, AD_SLOT = process.env.NEXT_PUBLIC_ADSENSE_SLOT;
function Ad() {
  useEffect(() => { try { ((window as any).adsbygoogle ||= []).push({}); } catch {} }, []);
  return <ins className="adsbygoogle ad" data-ad-client={AD_CLIENT} data-ad-slot={AD_SLOT} data-ad-format="auto" data-full-width-responsive="true" />;
}

export default function Home() {
  const [from, setFrom] = useState<Place | null>(null);
  const [to, setTo] = useState<Place | null>(null);
  const { me, meRef, heading } = useMyLocation(!!(from && to)); // 경로 지도가 떠 있는 동안만 GPS
  const { routes, at, msg, rtWhy, held, pin, setSelKey, sel, walkMin, walkPath, walkFirst, walkSel, busAt, toggleFollow } = usePlanner({ from, to, setFrom, setTo, meRef });
  const rtDown = !!rtWhy; // 실시간 서버가 응답하지 않아 시간표로만 계산했는지
  const [opened, setOpened] = useState<string[]>([]); // 버스 번호를 다 펼친 경로 구간
  return (
    <main>
      <h1>
        <svg width="34" height="34" viewBox="0 0 32 32" aria-hidden="true">
          <circle cx="16" cy="18" r="12" fill="#f28a1e" />
          <circle cx="12" cy="14" r="3" fill="#fff" opacity=".25" />
          <path d="M16 7c0-2 1-3 2.5-3.5" stroke="#5a7d2a" strokeWidth="2" fill="none" strokeLinecap="round" />
          <path d="M17 6c3-3 8-2 9 0-3 2-7 2-9 0z" fill="#6c9a2e" />
        </svg>
        <span>혼저</span> 탑서
      </h1>
      <p className="lead">제주 버스, 가까운 정류장이 아니라 목적지에 가장 먼저 닿는 버스를 찾아요.</p>
      <PlacePicker label="출발지" value={from} onPick={setFrom} allowHere />
      <PlacePicker label="도착지" value={to} onPick={setTo} favorites />
      {msg && <p className="muted">{msg}</p>}
      {at && routes.length > 0 && (
        <div className="meta">
          <span><span className="num">{kstClock(at)}</span> 기준 · {pin ? '따라가는 경로 먼저' : '도착이 빠른 순'}</span>
          <span className="muted">{held ? '고른 경로 유지 중' : '20초마다 갱신'}</span>
        </div>
      )}
      {at && held && !pin && <p className="muted">타려던 버스가 정류장을 지나서 탄 것으로 봐요. 탄 버스 위치와 갈아탈 버스를 20초마다 실시간으로 다시 계산해요. 아래 다른 경로는 지금 내 위치에서 찾아요. 처음 출발지로 새로 찾으려면 출발지를 다시 고르세요.</p>}
      {at && pin && <p className="muted">{held ? '타려던 버스가 정류장을 지나서 탄 것으로 봐요. 탄 버스 위치와 갈아탈 버스를 계속 실시간으로 다시 계산해요.' : '맨 위 경로를 따라가요. 타려던 버스가 지나가면 그때 계산으로 고정해요.'} 아래는 20초마다 새로 찾은 경로예요.</p>}
      {at && routes.length > 0 && rtDown && <p className="warn">{rtWhy}</p>}
      {walkFirst && (
        <article className={`box result best${walkSel ? ' sel' : ''}`} role="button" tabIndex={0} aria-pressed={walkSel} onClick={() => setSelKey('walk')}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelKey('walk'); } }}>
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}><div className="board"><b>걸어가요</b></div></div>
            <div className="arrive"><span className="eta">{dur(walkMin!)}</span><div className="muted">{kstClock(at!, walkMin!)} 도착</div></div>
          </div>
        </article>
      )}
      {from && to && walkSel && <RouteMap from={from} to={to} rides={[]} walkPath={walkPath} me={me} heading={heading} />}
      {from && to && !walkSel && routes[sel] && <RouteMap from={from} to={to} rides={routes[sel].rides} bus={busAt(routes[sel])} me={me} heading={heading} />}
      {routes.map((r, i) => {
        const key = routeKey(r);
        return <RouteCard key={key} r={r} i={i} at={at!} best={i === 0 && !!r.eta && !walkFirst} selected={i === sel && !walkSel} held={held} pinned={pin === key} opened={opened}
          busAt={busAt} onSelect={() => setSelKey(key)} onOpen={(k) => setOpened([...opened, k])} onFollow={() => toggleFollow(key, r)} />;
      })}
      <section className="intro">
        <h2>이렇게 골라요</h2>
        <p>가까운 정류장이 늘 빠른 건 아니에요. 걸어서 2분 거리 버스가 25분 뒤에 오고 6분 거리 버스가 8분 뒤에 온다면, 멀리 걸어가는 쪽이 17분 먼저 도착해요.
          혼저 탑서는 걷는 시간, 지금 버스 위치로 계산한 대기 시간, 타는 시간, 갈아타는 시간을 모두 더해 <b>도착 시각이 가장 이른 순서</b>로 보여드려요. <a href="/about">자세히 보기</a></p>
        <p className="muted">처음 타신다면: <a href="/guide/how-to-ride">제주 버스 타는 법</a> · <a href="/guide/fare">요금과 무료 환승</a> · <a href="/guide">공항에서 관광지 가는 버스</a></p>
      </section>
      {AD_CLIENT && AD_SLOT && <Ad />}
    </main>
  );
}
