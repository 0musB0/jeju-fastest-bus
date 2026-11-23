'use client';
import { Fragment } from 'react';
import { kstClock12 as kstClock } from '@/lib/eta';
import { kstMinutes } from '@/lib/timetable';
import { busNumbers, clock12, dur, routeKey, splitStop } from '@/lib/format';
import type { Followed } from '@/lib/follow';
import type { Pt } from '@/lib/odsay';

type Ranked = Followed;

// 도착 시각 계산에 실제로 쓴 버스의 노선 번호 (배차 간격 어림처럼 특정 버스가 없으면 null → 후보 번호 전부)
function boardIdx(r: Ranked, j: number): number {
  const b = r.eta?.boards[j];
  const id = b && b.how !== 'interval' ? r.candidate.legs[j].src?.find(([m]) => Math.abs(m - b.at) < 1e-6)?.[1] : undefined;
  return id ? r.rides[j].routeIds.indexOf(id) : -1;
}
function boardNo(r: Ranked, j: number): string | null {
  const k = boardIdx(r, j);
  return k >= 0 ? busNumbers([r.rides[j].busNos[k]])[0] : null;
}
// 한눈에 보는 막대: 걷기(회색) · 기다림(옅은색) · 버스(귤색, 번호) 길이를 시간에 비례해서
function Bar({ r }: { r: Ranked }) {
  if (!r.eta) return null;
  const segs: { k: 'walk' | 'wait' | 'bus'; m: number; t?: string }[] = [];
  let t = 0;
  r.candidate.legs.forEach((l, j) => {
    const b = r.eta!.boards[j];
    segs.push({ k: 'walk', m: Math.max(0, b.atStop - t) }, { k: 'wait', m: Math.max(0, b.at - b.atStop) }, { k: 'bus', m: l.rideMin, t: boardNo(r, j) ?? busNumbers(r.rides[j].busNos)[0] });
    t = b.at + l.rideMin;
  });
  segs.push({ k: 'walk', m: r.candidate.walkAfterMin });
  return (
    <div className="bar" aria-hidden="true">
      {segs.filter((x) => x.m >= 1).map((x, n) => <span key={n} className={`b-${x.k}`} style={{ flexGrow: x.m, ...(x.k === 'bus' ? { minWidth: `${(x.t?.length ?? 0) * 9 + 12}px` } : {}) }}>{x.k === 'bus' ? x.t : x.m >= 4 ? Math.round(x.m) : ''}</span>)}
    </div>
  );
}
// 버스 번호는 4개까지, 나머지는 "+N" (누르면 다 펼침)
const chips = (nos: string[], open: boolean, onOpen: () => void) => [
  ...(open ? nos : nos.slice(0, 4)).map((n) => <span key={n} className="chip">{n}</span>),
  ...(!open && nos.length > 4 ? [<button key="+" type="button" className="chip more" aria-label={`버스 ${nos.length - 4}개 더 보기`} onClick={(e) => { e.stopPropagation(); onOpen(); }}>+{nos.length - 4}</button>] : []),
];

// 경로 카드 하나: 시간 막대 + 세로 줄(고른 카드만 전부) + "이 경로로 갈게요". 상태는 모두 위(page·usePlanner)에 있고 여기는 그리기만 한다.
export default function RouteCard({ r, i, at, best, selected, held, pinned, opened, busAt, onSelect, onOpen, onFollow }: {
  r: Ranked; i: number; at: Date; best: boolean; selected: boolean; held: boolean; pinned: boolean; opened: string[];
  busAt: (r: Ranked) => (Pt & { name: string }) | undefined; onSelect: () => void; onOpen: (k: string) => void; onFollow: () => void;
}) {
  const key = routeKey(r);
  const walk = r.candidate.legs.reduce((s, l) => s + l.walkBeforeMin, r.candidate.walkAfterMin);
  return (
    <article className={`box result${best ? ' best' : ''}${selected ? ' sel' : ''}`} style={{ '--i': i } as React.CSSProperties}
      role="button" tabIndex={0} aria-pressed={selected} onClick={onSelect}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); } }}>
      <div className="head">
        {r.eta ? <><span className="eta">{dur(r.eta.min)}</span><span className="muted">{kstClock(at, r.eta.min)} 도착</span></>
          : <><span className="eta">{dur(r.odsayMin)}</span><span className="muted">+ 대기</span></>}
      </div>
      <div className="muted sub">걷기 {Math.round(walk)}분{r.fare ? ` · ${r.fare.toLocaleString()}원` : ''}{r.rides.length > 1 ? ` · 환승 ${r.rides.length - 1}번` : ''}</div>
      <Bar r={r} />
      {/* 카카오맵처럼 세로 줄: 걷기(점선) → 타는 정류장 → 버스(실선) → 내리는 정류장 … → 도착. 고른 카드만 전부, 나머지는 첫 정류장만 */}
      <ol className={`tl${selected ? '' : ' short'}`}>
        {r.rides.map((x, j) => {
          const l = r.candidate.legs[j], b = r.eta?.boards[j];
          const [on, side] = splitStop(x.from);
          const prevOff = j ? splitStop(r.rides[j - 1].to)[0] : '';
          const rode = held ? (r.rode ?? 0) : 0, onBus = j === rode - 1, past = j < rode - 1;
          const ended = j > 0 && !r.eta && !l.timetableMin && !l.intervalMin;
          const time = onBus ? <span className="when live">탄 버스</span> : past ? <span className="when off">지나옴</span>
            // 모두 "지금부터" 몇 분 뒤 (사용자 요청 2026-11-02: 시각 대신 "N시간 M분 뒤 도착")
            : b ? (b.how === 'realtime' ? <span className="when live">{dur(Math.max(0, b.at))} 뒤 도착<small>실시간</small></span>
              : b.how === 'interval' ? <span className="when">약 {dur(b.at)} 뒤 도착<small>배차 어림</small></span>
                    : b.how === 'estimate' ? <span className="when">약 {dur(b.at)} 뒤 도착<small>추정</small></span>
              : <span className="when">{dur(b.at)} 뒤 도착<small>시간표</small></span>)
            : j === 0 && r.firstBus !== undefined ? <span className="when off">{r.firstBus > kstMinutes(at) ? '첫차 전' : '운행 끝'}<small>첫차 {clock12(r.firstBus)}</small></span>
            : <span className="when off">{ended ? '막차 지났을 수 있음' : j === 0 && r.noBusNow ? '운행 버스 없음' : '정보 없음'}</span>;
          return (
            <Fragment key={j}>
              {l.walkBeforeMin > 0 && (j === 0 || on !== prevOff) && <li className={`walk${j ? ' later' : ''}`}>걸어서 {Math.round(l.walkBeforeMin)}분</li>}
              <li className={`stop${j ? ' later' : ''}`}>
                <b>{on}</b>{side && <span className="muted side"> {side} 쪽</span>}<span className="muted">{j ? ' 환승' : ' 승차'}</span>
                {x.toward && <div className="muted toward">{splitStop(x.toward)[0]} 방면</div>}
                <div className="busbox">
                  <div className="chips">{chips(boardNo(r, j) ? [boardNo(r, j)!] : busNumbers(x.busNos), opened.includes(`${key}:${j}`), () => onOpen(`${key}:${j}`))}</div>
                  {time}
                </div>
                {j > 0 && j >= rode && b && b.how !== 'interval' && <div className="muted note">환승 여유 {Math.round(b.at - b.atStop)}분</div>}
              </li>
              <li className={`ride${j ? ' later' : ''}`}>{onBus && busAt(r) ? `지금 ${busAt(r)!.name} · 내릴 곳까지 ${r.bus!.left}정류장 · ` : `${x.stopsBy?.[boardIdx(r, j)] ?? x.stops}개 정류장 · `}{past ? '지나옴' : onBus ? (l.rideMin >= 1 ? `내릴 때까지 약 ${Math.round(l.rideMin)}분` : '내렸어요') : `${Math.round(l.rideMin)}분 타요`}</li>
              {j === r.rides.length - 1 && <li className="stop off later"><b>{splitStop(x.to)[0]}</b><span className="muted"> 하차</span></li>}
            </Fragment>
          );
        })}
        {r.candidate.walkAfterMin > 0 && <li className="walk later">걸어서 {Math.round(r.candidate.walkAfterMin)}분</li>}
        <li className="stop end later"><b>도착</b></li>
      </ol>
      <div className="foot row" style={{ justifyContent: 'flex-end' }}>
        {r.eta && <button type="button" className={pinned ? 'follow on' : 'follow'} onClick={(e) => { e.stopPropagation(); onFollow(); }}>{pinned ? '따라가기 그만' : '이 경로로 갈게요'}</button>}
      </div>
    </article>
  );
}
