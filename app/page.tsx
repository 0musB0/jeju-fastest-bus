'use client';
import { useEffect, useRef, useState } from 'react';
import { arrivalMin, kstClock12 as kstClock } from '@/lib/eta';
import { BOARD_MARGIN_MIN } from '@/lib/config';
import { parseOdsay, type Route } from '@/lib/odsay';
import { applyRealtime, directToRoutes, realtimeKeys, type Headways, type PlanResults, type Schedules } from '@/lib/realtime';
import type { Direct } from '@/lib/direct';
import RouteMap from './RouteMap';

type Place = { name: string; address?: string; lat: number; lng: number };
type Ranked = Route & { eta: ReturnType<typeof arrivalMin> };

const ODSAY_KEY = process.env.NEXT_PUBLIC_ODSAY_KEY ?? '';
// 도착 칸 안내 문구: 제주말, 페이지를 열 때마다 바뀐다
const ASKS = ['어디 감수꽈?', '어드레 가카마씸?', '오늘은 어드레 감서?'];
// 버스 번호만: "300(신사동)", "365-21" → "300", "365" (같은 번호는 하나로)
// 자정부터 분 → "5:50 AM"
const clock12 = (m: number) => `${Math.floor(m / 60) % 12 || 12}:${String(m % 60).padStart(2, '0')} ${m % 1440 < 720 ? 'AM' : 'PM'}`;
const busNumbers = (nos: string[]) => [...new Set(nos.map((n) => n.replace(/\(.*\)/, '').replace(/-\d+$/, '').trim()))];
// "하귀환승정류장(하귀하나로마트)" → ["하귀환승정류장", "하귀하나로마트"]. 괄호는 길 건너 같은 이름 정류장을 가리는 힌트라 작게 남긴다.
const splitStop = (name: string) => {
  const m = name.match(/^(.*?)\s*\((.*)\)$/);
  return m ? [m[1], m[2]] : [name, ''];
};

function PlacePicker({ label, value, onPick, allowHere }: { label: string; value: Place | null; onPick: (p: Place | null) => void; allowHere?: boolean }) {
  const [q, setQ] = useState('');
  const [list, setList] = useState<Place[]>([]);
  const [msg, setMsg] = useState('');

  async function search(e: React.FormEvent) {
    e.preventDefault();
    setMsg('찾는 중...');
    try {
      const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`).then((r) => r.json());
      if (r.error) return setMsg(r.error);
      setList(r.places);
      setMsg(r.places.length ? '' : '제주에서 찾은 장소가 없어요');
    } catch {
      setMsg('장소 검색에 실패했어요');
    }
  }

  const [ask, setAsk] = useState(0);
  // 페이지를 열 때마다 하나를 고른다 (서버 렌더와 어긋나지 않게 화면에 붙은 뒤에)
  useEffect(() => { setAsk(Math.floor(Math.random() * ASKS.length)); }, []);

  // 출발지 기본값은 현재 위치: 처음 한 번 자동으로 묻는다.
  const asked = useRef(false);
  useEffect(() => {
    if (allowHere && !asked.current) { asked.current = true; here(); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function here() {
    setMsg('현재 위치 확인 중...');
    navigator.geolocation.getCurrentPosition(
      (p) => { onPick({ name: '현재 위치', lat: p.coords.latitude, lng: p.coords.longitude }); setMsg(''); },
      (e) => setMsg(e.code === 1 ? '위치 권한이 거부됐어요. 출발지를 검색해 주세요.' : '현재 위치를 알 수 없어요. 출발지를 검색해 주세요.'),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  return (
    <section className="box">
      <div className="label">{label}</div>
      {value ? (
        <div className="row">
          <span className="place">{value.name}</span>
          <button onClick={() => onPick(null)}>바꾸기</button>
        </div>
      ) : (
        <>
          <form onSubmit={search} className="row" style={{ marginTop: 6 }}>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={allowHere ? '출발 장소 검색' : ASKS[ask]} enterKeyHint="search" />
            <button className="primary" disabled={!q.trim()}>검색</button>
          </form>
          {allowHere && (
            <button className="ghost" onClick={here} style={{ marginTop: 6 }}>
              <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="3" fill="currentColor" /><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
              현재 위치 사용
            </button>
          )}
          {list.map((p) => (
            <button key={`${p.lat},${p.lng},${p.name}`} className="pick" onClick={() => { onPick(p); setList([]); setQ(''); }}>
              {p.name} <span className="muted">{p.address}</span>
            </button>
          ))}
        </>
      )}
      {msg && <p className="warn">{msg}</p>}
    </section>
  );
}

export default function Home() {
  const [from, setFrom] = useState<Place | null>(null);
  const [to, setTo] = useState<Place | null>(null);
  const [routes, setRoutes] = useState<Ranked[]>([]);
  const [at, setAt] = useState<Date | null>(null);
  const [msg, setMsg] = useState('');
  const [sel, setSel] = useState(0);

  const odsayErr = useRef('');
  const odsayRef = useRef<Route[] | null>(null); // 출발·도착이 같으면 ODsay 경로는 다시 부르지 않는다 (일일 한도)

  // 출발·도착이 바뀌면 ODsay로 경로 후보를 받고, 30초마다 실시간·시간표만 다시 계산한다.
  async function plan(refresh = false) {
    if (!from || !to) return;
    if (!refresh) {
      odsayRef.current = null;
      setMsg('경로 계산 중...');
      setRoutes([]);
    }
    try {
      // ODsay는 Web 키로 브라우저에서 직접 호출한다 (서버 호출 금지). SearchPathType=2: 버스만.
      if (!odsayRef.current) {
        const body = await fetch(`https://api.odsay.com/v1/api/searchPubTransPathT?${new URLSearchParams({
          SX: String(from.lng), SY: String(from.lat), EX: String(to.lng), EY: String(to.lat), SearchPathType: '2', apiKey: ODSAY_KEY,
        })}`).then((r) => r.json());
        const parsed = parseOdsay(body);
        // ODsay가 실패해도(일일 한도 초과 등) 우리 데이터의 직행 노선은 보여준다
        odsayErr.current = !parsed.ok && parsed.reason !== '경로 없음' ? (/429|quota/i.test(parsed.reason) ? '오늘 경로 검색 한도를 다 써서 갈아타지 않는 버스만 보여요.' : parsed.reason) : '';
        // 실시간 버스 위치로 대기를 채우고, 서버가 찾은 직행 후보를 더한다. ODsay가 경로를 못 찾아도 직행 후보는 본다.
        odsayRef.current = parsed.ok ? [...parsed.routes].sort((a, b) => a.odsayMin - b.odsayMin) : [];
      }
      const odsay = odsayRef.current;
      let results: PlanResults = {};
      let headways: Headways = {};
      let sched: Schedules = {};
      let direct: Direct[] = [];
      try {
        const q = new URLSearchParams({ q: realtimeKeys(odsay, 30).join(','), from: `${from.lat},${from.lng}`, to: `${to.lat},${to.lng}` });
        const r = await fetch(`/api/plan?${q}`).then((r) => r.json());
        results = r.results ?? {};
        headways = r.headways ?? {};
        sched = { scheduled: r.scheduled, firstBus: r.firstBus };
        direct = r.direct ?? [];
      } catch { /* 실시간 실패: 아래에서 추정 불가로 표시 */ }
      // ODsay 경로보다 이동만 1.5배 넘게 걸리는 직행 후보는 뺀다 (정류장 수 × 평균 소요라 긴 노선은 부정확)
      const bestOdsay = odsay[0]?.odsayMin ?? Infinity;
      const byTime = [...odsay, ...directToRoutes(direct, odsay).filter((r) => r.odsayMin <= bestOdsay * 1.5)];
      if (!byTime.length) return setMsg(odsayErr.current || '버스로 가는 경로가 없어요. 걸어가기 가까운 거리일 수 있어요.');
      // 대기를 알 수 있는 후보가 먼저, 그 안에서 도착이 빠른 순. 모르면 이동 시간 순으로 맨 뒤.
      const ranked = byTime
        .map((r) => applyRealtime(r, results, headways, sched))
        .map((r) => ({ ...r, eta: arrivalMin(r.candidate) }))
        .sort((a, b) => (a.eta ? 0 : 1) - (b.eta ? 0 : 1) || (a.eta?.min ?? a.odsayMin) - (b.eta?.min ?? b.odsayMin));
      setRoutes(ranked.slice(0, 3));
      if (!refresh) setSel(0);
      setAt(new Date());
      setMsg(odsayErr.current);
    } catch {
      if (!refresh) setMsg('경로 API에 연결하지 못했어요. 잠시 뒤 다시 시도해 주세요.');
    }
  }

  useEffect(() => { plan(); }, [from, to]); // eslint-disable-line react-hooks/exhaustive-deps
  // 자동 갱신: 결과가 있고 화면을 보고 있을 때만 30초마다 (서버의 실시간 캐시가 20초)
  useEffect(() => {
    if (!at) return;
    const id = setTimeout(() => document.visibilityState === 'visible' && plan(true), 30_000);
    return () => clearTimeout(id);
  }, [at]); // eslint-disable-line react-hooks/exhaustive-deps

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
      <PlacePicker label="도착지" value={to} onPick={setTo} />
      {msg && <p className="muted">{msg}</p>}
      {at && routes.length > 0 && (
        <div className="meta">
          <span><span className="num">{kstClock(at)}</span> 기준 · 도착이 빠른 순</span>
          <span className="muted">30초마다 자동 갱신</span>
        </div>
      )}
      {from && to && routes[sel] && <RouteMap from={from} to={to} rides={routes[sel].rides} mapObj={routes[sel].mapObj} />}
      {routes.map((r, i) => {
        const walk = r.candidate.legs.reduce((s, l) => s + l.walkBeforeMin, r.candidate.walkAfterMin);
        const leg = r.candidate.legs[0];
        // 걸어가서 탈 수 있는 첫 버스
        const next = leg.nextBusesMin?.find((b) => b >= leg.walkBeforeMin + BOARD_MARGIN_MIN) ?? leg.nextBusesMin?.[0];
        const planned = leg.timetableMin?.find((b) => b >= leg.walkBeforeMin + BOARD_MARGIN_MIN);
        const [stop, side] = splitStop(r.rides[0].from);
        return (
          <article key={i} className={`box result${i === 0 && r.eta ? ' best' : ''}${i === sel ? ' sel' : ''}`} style={{ '--i': i } as React.CSSProperties} onClick={() => setSel(i)}>
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <div className="chips">{busNumbers(r.rides[0].busNos).map((n) => <span key={n} className="chip">{n}</span>)}</div>
                <div className="board"><b>{stop}</b>에서 타요{side && <div className="muted side">{side} 쪽</div>}</div>
              </div>
              <div className="arrive">
                {r.eta ? <><span className="eta">{Math.round(r.eta.min)}분</span><div className="muted">{kstClock(at!, r.eta.min)} 도착</div></>
                  : <><span className="eta">{r.odsayMin}분</span><div className="muted">+ 대기</div></>}
              </div>
            </div>
            <div className="wait">
              {next !== undefined ? <span className="badge live">버스 {Math.max(0, Math.round(next))}분 뒤 도착</span>
                : planned !== undefined ? <span className="badge">시간표 기준 {Math.round(planned)}분 뒤</span>
                : r.eta ? <span className="badge">약 {Math.round(leg.intervalMin ?? 0)}분 간격 (추정)</span>
                : r.firstBus !== undefined ? <span className="badge warnb">오늘 운행 끝 · 첫차 {clock12(r.firstBus)}</span>
                : <span className="badge warnb">{r.noBusNow ? '지금 운행 중인 버스 없음' : '도착 정보 없음'}</span>}
            </div>
            <ol className="steps">
              {r.rides.slice(1).map((x, j) => {
                const prev = r.rides[j];
                const off = splitStop(prev.to)[0], on = splitStop(x.from)[0];
                return (
                  <li key={j}>
                    <b>{off}</b>에서 내려 <b className="bus">{busNumbers(x.busNos).join(' · ')}</b>번으로 환승
                    {on !== off && <span className="muted"> ({on}까지 걸어서)</span>}
                  </li>
                );
              })}
              <li><b>{splitStop(r.rides.at(-1)!.to)[0]}</b>에서 내려요 <span className="muted">({r.rides.reduce((s, x) => s + x.stops, 0)}정류장)</span></li>
            </ol>
            <div className="muted foot">걷기 {Math.round(walk)}분{r.fare ? ` · ${r.fare.toLocaleString()}원` : ''}</div>
          </article>
        );
      })}
    </main>
  );
}
