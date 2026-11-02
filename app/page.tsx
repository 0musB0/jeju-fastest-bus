'use client';
import { Fragment, useEffect, useRef, useState } from 'react';
import { arrivalMin, kstClock12 as kstClock } from '@/lib/eta';
import { kstMinutes } from '@/lib/timetable';
import { BOARD_MARGIN_MIN } from '@/lib/config';
import { parseOdsay, type Pt, type Route } from '@/lib/odsay';
import { applyRealtime, tripsToRoutes, sameRide, rideKeys, stopKeys, onOurRoutes, withOurWalks, type Headways, type PlanResults, type Schedules } from '@/lib/realtime';
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
// "이 경로로 갈게요"로 고른 경로는 크롬을 껐다 켜도 남도록 localStorage에 둔다. 도착 시각에서 30분이 지나면 버린다.
const PINNED = 'pinned';
type Pinned = { from: Place; to: Place; r: Ranked; t: number; held: boolean };
const loadPinned = (): Pinned | null => {
  try {
    const p: Pinned | null = JSON.parse(localStorage.getItem(PINNED) ?? 'null');
    return p?.r?.eta && Date.now() < p.t + (p.r.eta.min + 30) * 60000 ? p : null;
  } catch { return null; }
};
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
// 탄 버스 안: 첫 버스는 이미 탔다고 보고(남은 탑승 시간만), 환승 버스는 새 실시간·시간표로 다시 계산한다.
// 다시 계산할 수 없으면 고정한 시각을 그대로 쓴다 (지난 시간만큼 남은 분을 줄임)
function riding(f: { r: Ranked; t: number }, results: PlanResults, headways: Headways, sched: Schedules): Ranked {
  const now = Date.now() / 60000, gone = now - f.t / 60000, b0 = f.r.eta!.boards[0], leg0 = f.r.candidate.legs[0];
  const fixed = { ...f.r, eta: { ...f.r.eta!, min: Math.max(0, f.r.eta!.min - gone) } };
  if (f.r.rides.length < 2) return fixed;
  const bare = { ...f.r, candidate: { ...f.r.candidate, legs: f.r.candidate.legs.map((l) => ({ walkBeforeMin: l.walkBeforeMin, rideMin: l.rideMin })) } };
  const re = applyRealtime(bare, results, headways, sched);
  // 단순화: 탄 버스는 시간표 탑승 시간대로 간다고 봄. walkBeforeMin을 -여유로 둬서 "지금(0분) 타는 버스"가 되게 함
  const rest = Math.max(0, f.t / 60000 + b0.at + leg0.rideMin - now);
  const id0 = f.r.candidate.legs[0].src?.find(([m]) => Math.abs(m - b0.at) < 1e-6)?.[1];
  re.candidate.legs[0] = { walkBeforeMin: -BOARD_MARGIN_MIN, nextBusesMin: [0], rideMin: rest, ...(id0 ? { src: [[0, id0]] as [number, string][] } : {}) };
  const eta = arrivalMin(re.candidate);
  return eta ? { ...re, eta } : fixed;
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
// 걸리는 시간: 60분부터는 "2시간 30분"
const dur = (m: number) => { const t = Math.round(m), h = Math.floor(t / 60); return h ? `${h}시간${t % 60 ? ` ${t % 60}분` : ''}` : `${t}분`; };
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
    // 따라가는 경로가 저장돼 있으면 묻지 않는다: 새 위치로 다시 찾으면 고른 경로가 풀림
    if (allowHere && !asked.current && !loadTrip()?.from && !loadPinned()) { asked.current = true; here(); }
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
  const [held, setHeld] = useState(false); // 고른 경로가 갱신 결과에서 빠져 화면을 고정한 상태
  const [walkMin, setWalkMin] = useState<number | null>(null); // 버스 없이 걸어가는 시간(3km 안)
  const [walkPath, setWalkPath] = useState<Pt[] | undefined>(undefined);
  const [pin, setPin] = useState(''); // "이 경로로 갈게요"로 고른 경로: 갱신 때 이 경로만 보여준다
  const frozenRef = useRef<{ r: Ranked; t: number } | null>(null); // 탄 버스가 지나간 순간의 고른 경로
  const routesRef = useRef<Ranked[]>([]), selRef = useRef(''), pinRef = useRef(''), heldRef = useRef(false), atRef = useRef<Date | null>(null);
  routesRef.current = routes;
  selRef.current = selKey;
  pinRef.current = pin;
  heldRef.current = held; atRef.current = at;

  const odsayErr = useRef('');
  const odsayRef = useRef<Route[] | null>(null); // 출발·도착이 같으면 ODsay 경로는 다시 부르지 않는다 (일일 한도)
  const reqId = useRef(0); // 새 검색마다 1씩 늘린다. 늦게 온 이전 검색·갱신 응답은 버린다.
  const live = useRef(false); // 결과가 화면에 있을 때만 자동 갱신
  const pathsRef = useRef(new Map<string, Trip['legs'][number]['path']>()); // 우리 경로의 지도 선: 처음 받은 것을 갱신 때도 쓴다

  // 출발·도착이 바뀌면 ODsay로 경로 후보를 받고, 30초마다 실시간·시간표만 다시 계산한다.
  // 따라가는 경로의 구간 키: 타기 전이면 모든 구간, 탄 뒤면 환승 구간만 (서버가 실시간을 먼저 조회)
  function pinKeys(): string[] {
    const r = frozenRef.current?.r ?? routesRef.current.find((x) => routeKey(x) === pinRef.current);
    return r && pinRef.current ? [...(heldRef.current ? [] : rideKeys([r], true)), ...rideKeys([r], false)].slice(0, 12) : [];
  }
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
      let walkAll: number | null = null;
      try {
        const pathKey = (x: Route['rides'][number]) => `${x.routeIds[0]}:${x.stationId}:${x.stops}`;
        const q = new URLSearchParams({ q: rideKeys(odsay, true).slice(0, 30).join(','), later: rideKeys(odsay, false).slice(0, 30).join(','), pin: pinKeys().join(','), stops: refresh ? '' : stopKeys(odsay).slice(0, 60).join(','),
          wf: refresh ? '' : [...new Set(odsay.map((o) => o.rides[0]?.stationId).filter(Boolean))].slice(0, 20).join(','),
          wt: refresh ? '' : [...new Set(odsay.map((o) => o.rides.at(-1)?.endStationId).filter(Boolean))].slice(0, 20).join(','), from: `${from.lat},${from.lng}`, to: `${to.lat},${to.lng}`,
          paths: refresh ? '' : [...new Set(odsay.slice(0, 6).flatMap((o) => o.rides.map(pathKey)))].join(','), ...(refresh ? { lite: '1' } : {}) });
        const r = await fetch(`/api/plan?${q}`).then((r) => r.json());
        results = r.results ?? {};
        headways = r.headways ?? {};
        sched = { scheduled: r.scheduled, pending: r.pending, firstBus: r.firstBus };
        trips = r.trips ?? [];
        walkAll = typeof r.walkAll === 'number' ? r.walkAll : null;
        if (!refresh) (setWalkMin(walkAll), setWalkPath(r.walkAllPath));
        // ODsay 경로 중 그 버스가 실제로 서지 않는 정류장에서 타거나 내리는 경로는 뺀다 (첫 검색에서 한 번)
        if (!refresh && r.stopsOk) odsay = odsayRef.current = odsay.filter((o) => onOurRoutes(o, r.stopsOk)).map((o) => withOurWalks(o, r.walkFrom, r.walkTo));
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
        setWalkMin(null);
        setRtDown(true);
        /* 첫 검색: ODsay 경로만, 대기는 추정 불가로 표시 */
      }
      if (stale()) return;
      // 이동 시간만으로 거르지 않는다: 대기까지 더한 도착 시각으로만 비교한다
      // 같은 버스·정류장 조합이면 우리 후보를 쓴다: 탑승 시간이 시간표 기준이고 가지 노선이 모두 묶여 있다.
      // ODsay 쪽을 남겼더니 ODsay의 긴 탑승 시간 때문에 바로 가는 355번이 아라초 환승 경로보다 뒤로 밀렸다 (2026-11-02)
      const byTime = [...odsay.filter((o) => !trips.some((t) => sameRide(o, t))), ...tripsToRoutes(trips, [])];
      if (!byTime.length) return setMsg(odsayErr.current || (walkAll !== null ? `버스로 가는 경로가 없어요. 걸어서 ${walkAll}분이에요.` : '버스로 가는 경로가 없어요. 걸어가기 가까운 거리일 수 있어요.'));
      // 대기를 알 수 있는 후보가 먼저, 그 안에서 도착이 빠른 순. 모르면 이동 시간 순으로 맨 뒤.
      const ranked = byTime
        .map((r) => applyRealtime(r, results, headways, sched))
        .map((r) => ({ ...r, eta: arrivalMin(r.candidate) }))
        .sort((a, b) => (a.eta ? 0 : 1) - (b.eta ? 0 : 1) || (a.eta?.min ?? a.odsayMin) - (b.eta?.min ?? b.odsayMin));
      // 오늘 운행이 끝나 내일 첫차를 타야 하는 경로는 보여주지 않는다 (첫차 전 새벽은 오늘 안이라 그대로 둠)
      const nowMin = kstMinutes(new Date());
      // 환승 버스도 시간표는 있는데 오늘 남은 차가 없으면(서버가 첫차 시각만 줌) 끝난 것으로 본다
      const transferEnded = (r: Route) => r.candidate.legs.some((l, i) => i > 0 && !l.timetableMin && !l.nextBusesMin && !l.intervalMin
        && r.rides[i].routeIds.some((id) => sched.firstBus?.[`${id}:${r.rides[i].stationId}`] !== undefined));
      const ended = (r: (typeof ranked)[number]) => !r.eta && ((r.firstBus !== undefined && r.firstBus <= nowMin) || transferEnded(r));
      // 같은 정류장에서 같은 버스를 타고 갈아타지 않고 가는 후보가 더 빠르거나 같으면, 중간에 갈아타는 후보는 뺀다 (355번 그대로 vs 아라초 환승)
      // 같은 버스(노선)를 더 먼 정류장에서 타는 후보도, 가까운 쪽 후보가 더 빠르거나 같으면 뺀다 (제주시청에서 탈 수 있는 341·342를 법원까지 18분 걸어가서 타라고 함).
      // 버스가 가까운 정류장을 이미 지나쳤다면 먼 쪽 후보가 더 빨라서 남는다. 같으면 덜 걷는 쪽.
      const walkOf = (r: Route) => r.candidate.legs.reduce((s, l) => s + l.walkBeforeMin, r.candidate.walkAfterMin);
      const detour = (r: (typeof ranked)[number]) => ranked.some((q) => q !== r && q.eta && r.eta && q.rides.length <= r.rides.length
        && q.rides[0].routeIds.some((id) => r.rides[0].routeIds.includes(id))
        && (q.rides.length < r.rides.length ? q.eta.min <= r.eta.min : q.eta.min < r.eta.min || (q.eta.min === r.eta.min && walkOf(q) < walkOf(r))));
      // 도착 시각을 낼 수 없는 경로(갈아탈 버스가 지금 안 다님: 낮에 심야 3006번 등)는, 계산되는 경로가 하나라도 있으면 뺀다.
      // 남겨 두면 첫 버스 칸에 "운행 버스 없음"처럼 엉뚱한 이유가 보였다 (신화월드 → 함덕, 2026-11-02)
      const anyEta = ranked.some((r) => r.eta && !ended(r) && !detour(r));
      const shown = ranked.filter((r) => !ended(r) && !detour(r) && (r.eta || !anyEta));
      if (!shown.some((r) => r.eta) && ranked.some(ended)) {
        setRoutes([]);
        setAt(null);
        const firsts = ranked.filter(ended).flatMap((r) => (r.firstBus !== undefined ? [r.firstBus] : []));
        return setMsg(`막차가 끝났어요.${firsts.length ? ` 내일 첫차는 ${clock12(Math.min(...firsts))}부터예요.` : ''}`);
      }
      // 자동 갱신 때 고른 경로(안 골랐으면 1위)가 목록에서 빠지면 화면을 그대로 둔다: 그 버스를 이미 탔으면 정류장을 지나쳐 후보에서 빠지기 때문
      // 단순화: 고정된 동안 시각은 마지막 계산 그대로, 다른 경로가 더 빨라져도 바꾸지 않음
      const next = shown.slice(0, 3), cur = routesRef.current;
      if (refresh && pinRef.current) {
        // "이 경로로 갈게요"를 누른 경로만 따라간다. 타려던 버스가 정류장을 지나가면(탔거나 놓침) 새 계산은 다음 차가 되므로 그때부터는 화면을 고정한다.
        const old = cur.find((r) => routeKey(r) === pinRef.current), fresh = ranked.find((r) => routeKey(r) === pinRef.current);
        const boardAt = (r: typeof old, t: Date | null) => (r?.eta && t ? t.getTime() / 60000 + r.eta.boards[0].at : NaN);
        // 고른 경로는 맨 위에, 그 아래에는 새로 찾은 경로들을 그대로 보여준다
        let top = fresh;
        if (heldRef.current || !fresh || boardAt(fresh, new Date()) > boardAt(old, atRef.current) + 3) {
          if (!frozenRef.current && old && atRef.current) frozenRef.current = { r: old, t: atRef.current.getTime() };
          const f = frozenRef.current;
          top = f ? riding(f, results, headways, sched) : old;
          setHeld(true);
        }
        setRoutes([...(top ? [top] : []), ...next.filter((r) => routeKey(r) !== pinRef.current)]);
        setAt(new Date());
        return;
      }
      const picked = cur[Math.max(0, cur.findIndex((r) => routeKey(r) === selRef.current))];
      if (refresh && picked && !next.some((r) => routeKey(r) === routeKey(picked))) return setHeld(true);
      setHeld(false);
      setRoutes(next);
      if (!refresh) (setSelKey(''), setPin(''), (frozenRef.current = null));
      setAt(new Date());
      setMsg('');
      live.current = true;
    } catch {
      if (!refresh && !stale()) setMsg('경로를 계산하지 못했어요. 잠시 뒤 다시 시도해 주세요.');
    }
  }

  const restored = useRef(false), pinBoot = useRef(false);
  useEffect(() => {
    const p = loadPinned(), t = loadTrip();
    if (p) {
      // 고른 경로를 그 경로를 찾을 때의 출발지(현재 위치 포함)로 되살린다. 버스 안에서 다시 열어도 같은 경로를 따라간다
      pinBoot.current = true;
      frozenRef.current = p.held ? { r: p.r, t: p.t } : null;
      setFrom(p.from); setTo(p.to); setRoutes([p.r]); setAt(new Date(p.t)); setPin(routeKey(p.r)); setSelKey(routeKey(p.r)); setHeld(p.held);
    } else if (t) { setFrom(t.from); setTo(t.to); }
    restored.current = true;
  }, []);
  useEffect(() => {
    if (restored.current) try { sessionStorage.setItem(SAVED, JSON.stringify({ from, to })); } catch {}
    // 되살린 고른 경로는 새로 찾지 않고 갱신만 한다 (새로 찾으면 고른 경로가 풀림)
    if (pinBoot.current) {
      if (pin) (pinBoot.current = false), (live.current = true), plan(true); // 첫 렌더(아직 pin 전)에는 아무것도 안 함: plan()이 되살린 경로를 지움
      return;
    }
    plan();
  }, [from, to]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    try {
      const r = frozenRef.current?.r ?? routes.find((x) => routeKey(x) === pin);
      if (pin && r && from && to && at) localStorage.setItem(PINNED, JSON.stringify({ from, to, r, t: frozenRef.current?.t ?? at.getTime(), held }));
      else if (restored.current && !pinBoot.current) localStorage.removeItem(PINNED);
    } catch {}
  }, [pin, held, at]); // eslint-disable-line react-hooks/exhaustive-deps
  // 자동 갱신: 화면을 보고 있을 때만 30초마다 (서버의 실시간 캐시가 20초). 돌아왔다고 바로 다시 계산하지는 않는다.
  useEffect(() => {
    const id = setInterval(() => { if (document.visibilityState === 'visible') plan(true); }, 30_000);
    return () => clearInterval(id);
  }, [from, to]); // eslint-disable-line react-hooks/exhaustive-deps

  const sel = Math.max(0, routes.findIndex((r) => routeKey(r) === selKey));
  // 버스보다 걷는 게 빠르거나 같으면 걷기를 맨 위에 두고 기본으로 고른다
  const walkFirst = !!at && walkMin !== null && routes.length > 0 && !pin && !held && (!routes[0].eta || walkMin <= routes[0].eta.min);
  const walkSel = walkFirst && (selKey === '' || selKey === 'walk');
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
          <span className="muted">{held ? '고른 경로 유지 중' : '30초마다 자동 갱신'}</span>
        </div>
      )}
      {at && held && !pin && <p className="muted">타려던 버스가 정류장을 지나서, 탄 경로를 계속 보여드려요(시각은 {kstClock(at)} 계산 기준). 새로 찾으려면 출발지를 다시 고르세요.</p>}
      {at && pin && <p className="muted">{held ? '타려던 버스가 정류장을 지나서 탄 것으로 봐요. 갈아탈 버스는 계속 실시간으로 다시 계산해요.' : '맨 위 경로를 따라가요. 타려던 버스가 지나가면 그때 계산으로 고정해요.'} 아래는 30초마다 새로 찾은 경로예요.</p>}
      {at && routes.length > 0 && rtDown && <p className="warn">실시간 버스 위치를 받지 못해 일부는 시간표로 계산했어요.</p>}
      {walkFirst && (
        <article className={`box result best${walkSel ? ' sel' : ''}`} role="button" tabIndex={0} aria-pressed={walkSel} onClick={() => setSelKey('walk')}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelKey('walk'); } }}>
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}><div className="board"><b>걸어가요</b></div></div>
            <div className="arrive"><span className="eta">{dur(walkMin!)}</span><div className="muted">{kstClock(at!, walkMin!)} 도착</div></div>
          </div>
        </article>
      )}
      {from && to && walkSel && <RouteMap from={from} to={to} rides={[]} walkPath={walkPath} />}
      {from && to && !walkSel && routes[sel] && <RouteMap from={from} to={to} rides={routes[sel].rides} />}
      {routes.map((r, i) => {
        const key = routeKey(r);
        const walk = r.candidate.legs.reduce((s, l) => s + l.walkBeforeMin, r.candidate.walkAfterMin);
        return (
          <article key={key} className={`box result${i === 0 && r.eta && !walkFirst ? ' best' : ''}${i === sel && !walkSel ? ' sel' : ''}`} style={{ '--i': i } as React.CSSProperties}
            role="button" tabIndex={0} aria-pressed={i === sel && !walkSel} onClick={() => setSelKey(key)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelKey(key); } }}>
            <div className="head">
              {r.eta ? <><span className="eta">{dur(r.eta.min)}</span><span className="muted">{kstClock(at!, r.eta.min)} 도착</span></>
                : <><span className="eta">{dur(r.odsayMin)}</span><span className="muted">+ 대기</span></>}
            </div>
            <div className="muted sub">걷기 {Math.round(walk)}분{r.fare ? ` · ${r.fare.toLocaleString()}원` : ''}{r.rides.length > 1 ? ` · 환승 ${r.rides.length - 1}번` : ''}</div>
            <Bar r={r} />
            {/* 카카오맵처럼 세로 줄: 걷기(점선) → 타는 정류장 → 버스(실선) → 내리는 정류장 … → 도착. 고른 카드만 전부, 나머지는 첫 정류장만 */}
            <ol className={`tl${i === sel && !walkSel ? '' : ' short'}`}>
              {r.rides.map((x, j) => {
                const l = r.candidate.legs[j], b = r.eta?.boards[j];
                const [on, side] = splitStop(x.from);
                const prevOff = j ? splitStop(r.rides[j - 1].to)[0] : '';
                const riding = held && key === pin && j === 0;
                const ended = j > 0 && !r.eta && !l.timetableMin && !l.intervalMin;
                const time = riding ? <span className="when live">탄 버스</span>
                  // 모두 "지금부터" 몇 분 뒤 (사용자 요청 2026-11-02: 시각 대신 "N시간 M분 뒤 도착")
                  : b ? (b.how === 'realtime' ? <span className="when live">{dur(Math.max(0, b.at))} 뒤 도착<small>실시간</small></span>
                    : b.how === 'interval' ? <span className="when">약 {dur(b.at)} 뒤 도착<small>배차 어림</small></span>
                    : <span className="when">{dur(b.at)} 뒤 도착<small>시간표</small></span>)
                  : j === 0 && r.firstBus !== undefined ? <span className="when off">{r.firstBus > kstMinutes(at!) ? '첫차 전' : '운행 끝'}<small>첫차 {clock12(r.firstBus)}</small></span>
                  : <span className="when off">{ended ? '막차 지났을 수 있음' : j === 0 && r.noBusNow ? '운행 버스 없음' : '정보 없음'}</span>;
                return (
                  <Fragment key={j}>
                    {l.walkBeforeMin > 0 && (j === 0 || on !== prevOff) && <li className={`walk${j ? ' later' : ''}`}>걸어서 {Math.round(l.walkBeforeMin)}분</li>}
                    <li className={`stop${j ? ' later' : ''}`}>
                      <b>{on}</b>{side && <span className="muted side"> {side} 쪽</span>}<span className="muted">{j ? ' 환승' : ' 승차'}</span>
                      {x.toward && <div className="muted toward">{splitStop(x.toward)[0]} 방면</div>}
                      <div className="busbox">
                        <div className="chips">{chips(boardNo(r, j) ? [boardNo(r, j)!] : busNumbers(x.busNos), opened.includes(`${key}:${j}`), () => setOpened([...opened, `${key}:${j}`]))}</div>
                        {time}
                      </div>
                      {j > 0 && b && b.how !== 'interval' && <div className="muted note">환승 여유 {Math.round(b.at - b.atStop)}분</div>}
                    </li>
                    <li className={`ride${j ? ' later' : ''}`}>{x.stopsBy?.[boardIdx(r, j)] ?? x.stops}개 정류장 · {riding ? `내릴 때까지 약 ${Math.round(l.rideMin)}분` : `${Math.round(l.rideMin)}분 타요`}</li>
                    {j === r.rides.length - 1 && <li className="stop off later"><b>{splitStop(x.to)[0]}</b><span className="muted"> 하차</span></li>}
                  </Fragment>
                );
              })}
              {r.candidate.walkAfterMin > 0 && <li className="walk later">걸어서 {Math.round(r.candidate.walkAfterMin)}분</li>}
              <li className="stop end later"><b>도착</b></li>
            </ol>
            <div className="foot row" style={{ justifyContent: 'flex-end' }}>
              {r.eta && <button type="button" className={pin === key ? 'follow on' : 'follow'} onClick={(e) => {
                e.stopPropagation();
                if (pin === key) { pinRef.current = ''; heldRef.current = false; frozenRef.current = null; routesRef.current = []; setPin(''); setHeld(false); plan(true); }
                else ((frozenRef.current = null), setHeld(false), setPin(key), setSelKey(key), setRoutes([r, ...routes.filter((x) => routeKey(x) !== key)]));
              }}>{pin === key ? '따라가기 그만' : '이 경로로 갈게요'}</button>}
            </div>
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
