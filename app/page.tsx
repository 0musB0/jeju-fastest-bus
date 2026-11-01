'use client';
import { useEffect, useRef, useState } from 'react';
import { arrivalMin, kstClock12 as kstClock } from '@/lib/eta';
import { kstMinutes } from '@/lib/timetable';
import { parseOdsay, type Route } from '@/lib/odsay';
import { applyRealtime, tripsToRoutes, rideKeys, stopKeys, onOurRoutes, type Headways, type PlanResults, type Schedules } from '@/lib/realtime';
import type { Trip } from '@/lib/direct';
import RouteMap from './RouteMap';

type Place = { name: string; address?: string; lat: number; lng: number };
type Ranked = Route & { eta: ReturnType<typeof arrivalMin> };

const ODSAY_KEY = process.env.NEXT_PUBLIC_ODSAY_KEY ?? '';
// 크롬이 뒤에 둔 탭을 지웠다가 다시 열면 페이지가 새로 뜬다. 그때 출발·도착을 되살린다 (탭을 닫으면 사라짐).
const SAVED = 'trip';
const loadTrip = (): { from: Place | null; to: Place | null } | null => {
  // "현재 위치"는 되살리지 않는다: 그새 움직였을 수 있으니 다시 묻는다
  try { const t = JSON.parse(sessionStorage.getItem(SAVED) ?? 'null'); return t && { ...t, from: t.from?.name === '현재 위치' ? null : t.from }; } catch { return null; }
};
// 도착 칸 안내 문구: 제주말, 페이지를 열 때마다 바뀐다
const ASKS = ['어디 감수꽈?', '어드레 가카마씸?', '오늘은 어드레 감서?'];
// 버스 번호만: "300(신사동)", "365-21" → "300", "365" (같은 번호는 하나로)
// 자정부터 분 → "5:50 AM"
const clock12 = (m: number) => `${Math.floor(m / 60) % 12 || 12}:${String(m % 60).padStart(2, '0')} ${m % 1440 < 720 ? 'AM' : 'PM'}`;
// 경로 구분 열쇠: 구간마다 탈 정류장과 버스
const routeKey = (r: { rides: { from: string; busNos: string[] }[] }) => r.rides.map((x) => `${x.from}:${x.busNos.join('/')}`).join('|');
// 버스 번호는 4개까지, 나머지는 "+N" (누르면 다 펼침)
const chips = (nos: string[], open: boolean, onOpen: () => void) => [
  ...(open ? nos : nos.slice(0, 4)).map((n) => <span key={n} className="chip">{n}</span>),
  ...(!open && nos.length > 4 ? [<button key="+" type="button" className="chip more" aria-label={`버스 ${nos.length - 4}개 더 보기`} onClick={(e) => { e.stopPropagation(); onOpen(); }}>+{nos.length - 4}</button>] : []),
];
const busNumbers = (nos: string[]) => [...new Set(nos.map((n) => n.replace(/\(.*\)/, '').replace(/-\d+$/, '').trim()))];
// "하귀환승정류장(하귀하나로마트)" → ["하귀환승정류장", "하귀하나로마트"]. 괄호는 길 건너 같은 이름 정류장을 가리는 힌트라 작게 남긴다.
const splitStop = (name: string) => {
  const m = name.match(/^(.*?)\s*\((.*)\)$/);
  return m ? [m[1], m[2]] : [name, ''];
};

// 즐겨찾는 도착지: 이 기기 브라우저에만 저장 (로그인 없음, 다른 기기와는 공유 안 됨)
const FAVS = 'favs';
const sameSpot = (a: Place, b: Place) => a.name === b.name && Math.abs(a.lat - b.lat) < 1e-5 && Math.abs(a.lng - b.lng) < 1e-5;

function PlacePicker({ label, value, onPick, allowHere, favorites }: { label: string; value: Place | null; onPick: (p: Place | null) => void; allowHere?: boolean; favorites?: boolean }) {
  const [q, setQ] = useState('');
  const [favs, setFavs] = useState<Place[]>([]);
  useEffect(() => {
    if (favorites) try { setFavs(JSON.parse(localStorage.getItem(FAVS) ?? '[]')); } catch {}
  }, [favorites]);
  const saveFavs = (next: Place[]) => {
    setFavs(next);
    try { localStorage.setItem(FAVS, JSON.stringify(next)); } catch {}
  };
  const isFav = !!value && favs.some((f) => sameSpot(f, value));
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
    if (allowHere && !asked.current && !loadTrip()?.from) { asked.current = true; here(); }
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
          {favorites && value.name !== '현재 위치' && (
            <button className={isFav ? 'fav on' : 'fav'} aria-pressed={isFav} aria-label={isFav ? '즐겨찾기에서 빼기' : '즐겨찾기에 저장'}
              onClick={() => saveFavs(isFav ? favs.filter((f) => !sameSpot(f, value)) : [...favs, { name: value.name, address: value.address, lat: value.lat, lng: value.lng }])}>
              <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 2.8l2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3L2.9 9.5l6.3-.9z" fill={isFav ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
              </svg>
            </button>
          )}
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
          {favorites && favs.length > 0 && !list.length && (
            <div className="favs">
              {favs.map((f) => (
                <span key={`${f.lat},${f.lng},${f.name}`} className="favchip">
                  <button onClick={() => onPick(f)}>{f.name}</button>
                  <button className="x" aria-label={`${f.name} 즐겨찾기에서 빼기`} onClick={() => saveFavs(favs.filter((g) => g !== f))}>×</button>
                </span>
              ))}
            </div>
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

// 구글 애드센스 광고 1자리(결과 아래). 게시자 ID와 광고 단위 ID가 둘 다 있을 때만 나온다.
const AD_CLIENT = process.env.NEXT_PUBLIC_ADSENSE_CLIENT, AD_SLOT = process.env.NEXT_PUBLIC_ADSENSE_SLOT;
function Ad() {
  useEffect(() => { try { ((window as any).adsbygoogle ||= []).push({}); } catch {} }, []);
  return <ins className="adsbygoogle ad" data-ad-client={AD_CLIENT} data-ad-slot={AD_SLOT} data-ad-format="auto" data-full-width-responsive="true" />;
}

export default function Home() {
  const [from, setFrom] = useState<Place | null>(null);
  const [to, setTo] = useState<Place | null>(null);
  const [routes, setRoutes] = useState<Ranked[]>([]);
  const [at, setAt] = useState<Date | null>(null);
  const [msg, setMsg] = useState('');
  const [rtDown, setRtDown] = useState(false); // 실시간 서버가 응답하지 않아 시간표로만 계산했는지
  const [opened, setOpened] = useState<string[]>([]); // 버스 번호를 다 펼친 경로
  const [selKey, setSelKey] = useState(''); // 고른 경로: 30초 갱신으로 순서가 바뀌어도 같은 경로를 따라간다

  const odsayErr = useRef('');
  const odsayRef = useRef<Route[] | null>(null); // 출발·도착이 같으면 ODsay 경로는 다시 부르지 않는다 (일일 한도)
  const reqId = useRef(0); // 새 검색마다 1씩 늘린다. 늦게 온 이전 검색·갱신 응답은 버린다.
  const live = useRef(false); // 결과가 화면에 있을 때만 자동 갱신
  const pathsRef = useRef(new Map<string, Trip['legs'][number]['path']>()); // 우리 경로의 지도 선: 처음 받은 것을 갱신 때도 쓴다

  // 출발·도착이 바뀌면 ODsay로 경로 후보를 받고, 30초마다 실시간·시간표만 다시 계산한다.
  async function plan(refresh = false) {
    if (refresh && !live.current) return;
    const id = refresh ? reqId.current : ++reqId.current;
    const stale = () => id !== reqId.current;
    if (!refresh) {
      live.current = false;
      odsayRef.current = null;
      setRoutes([]);
      setAt(null);
      setMsg(from && to ? '경로 계산 중...' : '');
    }
    if (!from || !to) return; // "바꾸기": 옛 결과를 지우고 끝
    try {
      // ODsay는 Web 키로 브라우저에서 직접 호출한다 (서버 호출 금지). SearchPathType=2: 버스만.
      // ODsay는 보조: 오류·한도 초과·무응답(5초)이어도 우리 데이터로 찾은 직행·환승 경로를 보여준다
      let odsay = odsayRef.current;
      if (!odsay) {
        let parsed: ReturnType<typeof parseOdsay>;
        try {
          const body = await fetch(`https://api.odsay.com/v1/api/searchPubTransPathT?${new URLSearchParams({
            SX: String(from.lng), SY: String(from.lat), EX: String(to.lng), EY: String(to.lat), SearchPathType: '2', apiKey: ODSAY_KEY,
          })}`, { signal: AbortSignal.timeout(5000) }).then((r) => r.json());
          parsed = parseOdsay(body);
        } catch {
          parsed = { ok: false, reason: '응답 없음' };
        }
        if (stale()) return;
        odsayErr.current = !parsed.ok && parsed.reason !== '경로 없음'
          ? (/429|quota/i.test(parsed.reason) ? '경로를 찾지 못했어요. (보조 경로 검색 한도 초과, 내일 다시 채워져요)' : '경로를 찾지 못했어요. 잠시 뒤 다시 시도해 주세요.')
          : '';
        odsay = parsed.ok ? [...parsed.routes].sort((a, b) => a.odsayMin - b.odsayMin) : [];
        odsayRef.current = odsay;
      }
      let results: PlanResults = {};
      let headways: Headways = {};
      let sched: Schedules = {};
      let trips: Trip[] = [];
      try {
        const pathKey = (x: Route['rides'][number]) => `${x.routeIds[0]}:${x.stationId}:${x.stops}`;
        const q = new URLSearchParams({ q: rideKeys(odsay, true).slice(0, 30).join(','), later: rideKeys(odsay, false).slice(0, 30).join(','), stops: refresh ? '' : stopKeys(odsay).slice(0, 60).join(','), from: `${from.lat},${from.lng}`, to: `${to.lat},${to.lng}`,
          paths: refresh ? '' : [...new Set(odsay.slice(0, 6).flatMap((o) => o.rides.map(pathKey)))].join(','), ...(refresh ? { lite: '1' } : {}) });
        const r = await fetch(`/api/plan?${q}`).then((r) => r.json());
        results = r.results ?? {};
        headways = r.headways ?? {};
        sched = { scheduled: r.scheduled, pending: r.pending, firstBus: r.firstBus };
        trips = r.trips ?? [];
        // ODsay 경로 중 그 버스가 실제로 서지 않는 정류장에서 타거나 내리는 경로는 뺀다 (첫 검색에서 한 번)
        if (!refresh && r.stopsOk) odsay = odsayRef.current = odsay.filter((o) => onOurRoutes(o, r.stopsOk));
        // 지도 선은 첫 검색에서만 받는다 (갱신 응답은 빈 선). 구간 = 탈 정류장 > 내릴 정류장 + 노선
        const legKey = (l: Trip['legs'][number]) => `${l.fromId}>${l.toId}>${l.routeIds[0]}`;
        if (!refresh) pathsRef.current.clear();
        for (const t of trips) for (const l of t.legs) {
          if (l.path?.length) pathsRef.current.set(legKey(l), l.path);
          else l.path = pathsRef.current.get(legKey(l)) ?? [];
        }
        // ODsay 경로의 지도 선을 노선 모양(도로)으로 바꾼다
        for (const o of odsay) for (const x of o.rides) if (r.paths?.[pathKey(x)]?.length > 1) x.path = r.paths[pathKey(x)];
        // "이 노선에 없는 정류장"은 고장이 아니다. 실시간 API 오류·무응답만 안내한다.
        setRtDown(Object.values(results).some((v) => !Array.isArray(v) && v.error !== '이 노선에 없는 정류장'));
      } catch {
        if (refresh) return; // 갱신 중 한 번 끊기면 이전 결과를 그대로 둔다
        setRtDown(true);
        /* 첫 검색: ODsay 경로만, 대기는 추정 불가로 표시 */
      }
      if (stale()) return;
      // 이동 시간만으로 거르지 않는다: 대기까지 더한 도착 시각으로만 비교한다
      const byTime = [...odsay, ...tripsToRoutes(trips, odsay)];
      if (!byTime.length) return setMsg(odsayErr.current || '버스로 가는 경로가 없어요. 걸어가기 가까운 거리일 수 있어요.');
      // 대기를 알 수 있는 후보가 먼저, 그 안에서 도착이 빠른 순. 모르면 이동 시간 순으로 맨 뒤.
      const ranked = byTime
        .map((r) => applyRealtime(r, results, headways, sched))
        .map((r) => ({ ...r, eta: arrivalMin(r.candidate) }))
        .sort((a, b) => (a.eta ? 0 : 1) - (b.eta ? 0 : 1) || (a.eta?.min ?? a.odsayMin) - (b.eta?.min ?? b.odsayMin));
      setRoutes(ranked.slice(0, 3));
      if (!refresh) setSelKey('');
      setAt(new Date());
      setMsg('');
      live.current = true;
    } catch {
      if (!refresh && !stale()) setMsg('경로를 계산하지 못했어요. 잠시 뒤 다시 시도해 주세요.');
    }
  }

  const restored = useRef(false);
  useEffect(() => {
    const t = loadTrip();
    if (t) { setFrom(t.from); setTo(t.to); }
    restored.current = true;
  }, []);
  useEffect(() => {
    if (restored.current) try { sessionStorage.setItem(SAVED, JSON.stringify({ from, to })); } catch {}
    plan();
  }, [from, to]); // eslint-disable-line react-hooks/exhaustive-deps
  // 자동 갱신: 화면을 보고 있을 때만 30초마다 (서버의 실시간 캐시가 20초). 돌아왔다고 바로 다시 계산하지는 않는다.
  useEffect(() => {
    const id = setInterval(() => { if (document.visibilityState === 'visible') plan(true); }, 30_000);
    return () => clearInterval(id);
  }, [from, to]); // eslint-disable-line react-hooks/exhaustive-deps

  const sel = Math.max(0, routes.findIndex((r) => routeKey(r) === selKey));
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
          <span><span className="num">{kstClock(at)}</span> 기준 · 도착이 빠른 순</span>
          <span className="muted">30초마다 자동 갱신</span>
        </div>
      )}
      {at && routes.length > 0 && rtDown && <p className="warn">실시간 버스 위치를 받지 못해 일부는 시간표로 계산했어요.</p>}
      {from && to && routes[sel] && <RouteMap from={from} to={to} rides={routes[sel].rides} />}
      {routes.map((r, i) => {
        const key = routeKey(r);
        const walk = r.candidate.legs.reduce((s, l) => s + l.walkBeforeMin, r.candidate.walkAfterMin);
        const leg = r.candidate.legs[0];
        // 걸어가서 탈 첫 버스: 도착 시각 계산이 고른 버스와 같은 것을 보여준다
        const b0 = r.eta?.boards[0];
        const next = b0?.how === 'realtime' ? b0.at : undefined;
        const planned = b0?.how === 'timetable' ? b0.at : undefined;
        const [stop, side] = splitStop(r.rides[0].from);
        return (
          <article key={key} className={`box result${i === 0 && r.eta ? ' best' : ''}${i === sel ? ' sel' : ''}`} style={{ '--i': i } as React.CSSProperties}
            role="button" tabIndex={0} aria-pressed={i === sel} onClick={() => setSelKey(key)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelKey(key); } }}>
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <div className="chips">{chips(busNumbers(r.rides[0].busNos), opened.includes(key), () => setOpened([...opened, key]))}</div>
                <div className="board"><b>{stop}</b>에서 타요{side && <div className="muted side">{side} 쪽</div>}</div>
              </div>
              <div className="arrive">
                {r.eta ? <><span className="eta">{Math.round(r.eta.min)}분</span><div className="muted">{kstClock(at!, r.eta.min)} 도착</div></>
                  : <><span className="eta">{r.odsayMin}분</span><div className="muted">+ 대기</div></>}
              </div>
            </div>
            <div className="wait">
              {next !== undefined ? <span className="badge live">버스 {Math.max(0, Math.round(next))}분 뒤 도착</span>
                : planned !== undefined ? <span className="badge">{planned > 60 ? `다음 차 ${kstClock(at!, planned)}` : `시간표 기준 ${Math.round(planned)}분 뒤`}</span>
                : r.eta ? <span className="badge">약 {Math.round(leg.intervalMin ?? 0)}분 간격 (추정)</span>
                : r.firstBus !== undefined ? <span className="badge warnb">{r.firstBus > kstMinutes(at!) ? '첫차 전' : '오늘 운행 끝'} · 첫차 {clock12(r.firstBus)}</span>
                : <span className="badge warnb">{r.noBusNow ? '지금 운행 중인 버스 없음' : '도착 정보 없음'}</span>}
            </div>
            <ol className="steps">
              {r.rides.slice(1).map((x, j) => {
                const prev = r.rides[j];
                const off = splitStop(prev.to)[0], on = splitStop(x.from)[0];
                const b = r.eta?.boards[j + 1], l = r.candidate.legs[j + 1];
                const ended = !r.eta && !l.timetableMin && !l.intervalMin;
                return (
                  <li key={j}>
                    <b>{off}</b>에서 내려 <b className="bus">{busNumbers(x.busNos).join(' · ')}</b>번으로 환승
                    {on !== off && <span className="muted"> ({on}까지 걸어서)</span>}
                    {ended && <div className="warn transfer-eta">환승 버스 시간 정보 없음 · 막차가 지났을 수 있어요</div>}
                    {b && <div className="muted transfer-eta">
                      {b.how === 'interval' ? `약 ${Math.round(b.at)}분 뒤 탑승 (배차 간격 어림)` : `${Math.round(b.at)}분 뒤 도착 · ${kstClock(at!, b.at)} (시간표 기준)`}
                      {b.how !== 'interval' && ` · 환승 여유 ${Math.round(b.at - b.atStop)}분`}
                    </div>}
                  </li>
                );
              })}
              <li><b>{splitStop(r.rides.at(-1)!.to)[0]}</b>에서 내려요 <span className="muted">({r.rides.reduce((s, x) => s + x.stops, 0)}정류장)</span></li>
            </ol>
            <div className="muted foot">걷기 {Math.round(walk)}분{r.fare ? ` · ${r.fare.toLocaleString()}원` : ''}</div>
          </article>
        );
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
