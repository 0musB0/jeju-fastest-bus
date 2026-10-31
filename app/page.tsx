'use client';
import { useEffect, useRef, useState } from 'react';
import { arrivalMin, kstClock } from '@/lib/eta';
import { parseOdsay, type Route } from '@/lib/odsay';
import { applyRealtime, directToRoutes, realtimeKeys, type Headways, type PlanResults } from '@/lib/realtime';
import type { Direct } from '@/lib/direct';

type Place = { name: string; address?: string; lat: number; lng: number };
type Ranked = Route & { eta: ReturnType<typeof arrivalMin> };

const ODSAY_KEY = process.env.NEXT_PUBLIC_ODSAY_KEY ?? '';
const SOURCE_LABEL = { realtime: '실시간', timetable: '배차 간격 추정', unknown: '' } as const;

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
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={allowHere ? '출발 장소 검색' : '어디로 가세요?'} enterKeyHint="search" />
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
  const [stale, setStale] = useState(false);
  const [msg, setMsg] = useState('');

  async function plan() {
    if (!from || !to) return;
    setMsg('경로 계산 중...');
    setRoutes([]);
    try {
      // ODsay는 Web 키로 브라우저에서 직접 호출한다 (서버 호출 금지). SearchPathType=2: 버스만.
      const body = await fetch(`https://api.odsay.com/v1/api/searchPubTransPathT?${new URLSearchParams({
        SX: String(from.lng), SY: String(from.lat), EX: String(to.lng), EY: String(to.lat), SearchPathType: '2', apiKey: ODSAY_KEY,
      })}`).then((r) => r.json());
      const parsed = parseOdsay(body);
      if (!parsed.ok && parsed.reason !== '경로 없음') return setMsg(parsed.reason);
      // 실시간 버스 위치로 대기를 채우고, 서버가 찾은 직행 후보를 더한다. ODsay가 경로를 못 찾아도 직행 후보는 본다.
      const odsay = parsed.ok ? [...parsed.routes].sort((a, b) => a.odsayMin - b.odsayMin) : [];
      let results: PlanResults = {};
      let headways: Headways = {};
      let direct: Direct[] = [];
      try {
        const q = new URLSearchParams({ q: realtimeKeys(odsay).join(','), from: `${from.lat},${from.lng}`, to: `${to.lat},${to.lng}` });
        const r = await fetch(`/api/plan?${q}`).then((r) => r.json());
        results = r.results ?? {};
        headways = r.headways ?? {};
        direct = r.direct ?? [];
      } catch { /* 실시간 실패: 아래에서 추정 불가로 표시 */ }
      const byTime = [...odsay, ...directToRoutes(direct, odsay)];
      if (!byTime.length) return setMsg('버스로 가는 경로가 없어요. 걸어가기 가까운 거리일 수 있어요.');
      // 대기를 알 수 있는 후보가 먼저, 그 안에서 도착이 빠른 순. 모르면 이동 시간 순으로 맨 뒤.
      const ranked = byTime
        .map((r) => applyRealtime(r, results, headways))
        .map((r) => ({ ...r, eta: arrivalMin(r.candidate) }))
        .sort((a, b) => (a.eta ? 0 : 1) - (b.eta ? 0 : 1) || (a.eta?.min ?? a.odsayMin) - (b.eta?.min ?? b.odsayMin));
      setRoutes(ranked.slice(0, 3));
      setAt(new Date());
      setStale(false);
      setMsg('');
    } catch {
      setMsg('경로 API에 연결하지 못했어요. 잠시 뒤 다시 시도해 주세요.');
    }
  }

  useEffect(() => { plan(); }, [from, to]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!at) return;
    const id = setTimeout(() => setStale(true), 60_000);
    return () => clearTimeout(id);
  }, [at]);

  return (
    <main>
      <h1><span>제주</span> 가장 빠른 버스</h1>
      <p className="lead">가까운 정류장이 아니라, 목적지에 가장 먼저 닿는 버스를 찾아요.</p>
      <PlacePicker label="출발" value={from} onPick={setFrom} allowHere />
      <PlacePicker label="도착" value={to} onPick={setTo} />
      {msg && <p className="muted">{msg}</p>}
      {at && routes.length > 0 && (
        <div className="meta">
          <span><span className="num">{kstClock(at)}</span> 기준 · 도착이 빠른 순</span>
          {stale && <button className="primary" onClick={plan}>다시 계산</button>}
        </div>
      )}
      {routes.map((r, i) => {
        const walk = r.candidate.legs.reduce((s, l) => s + l.walkBeforeMin, r.candidate.walkAfterMin);
        const next = r.candidate.legs[0].nextBusesMin?.[0];
        return (
          <article key={i} className={`box result${i === 0 && r.eta ? ' best' : ''}`} style={{ '--i': i } as React.CSSProperties}>
            {r.eta ? (
              <div>
                <span className="eta">{kstClock(at!, r.eta.min)}</span>
                <span className="muted"> 도착 · {Math.round(r.eta.min)}분 뒤</span>
                <span className={`badge${r.eta.source === 'realtime' ? ' live' : ''}`}>{SOURCE_LABEL[r.eta.source]}</span>
              </div>
            ) : (
              <div>
                <span className="eta">{r.odsayMin}분</span><span className="muted"> 이동 + 대기</span>
                <p className="warn">{r.noBusNow ? '지금 운행 중인 버스가 없어요 (첫차 전이거나 막차 후일 수 있어요)' : '버스 대기 시간을 알 수 없어요'}</p>
              </div>
            )}
            {r.rides.map((x, j) => (
              <div key={j} className="ride">
                {j > 0 && <span className="muted">환승 </span>}
                <span className="bus">{x.busNos.join(', ')}번</span> {x.from} 승차 → {x.to} 하차 <span className="muted">({x.stops}정류장)</span>
                {j === 0 && next !== undefined && <div className="muted">다음 버스 약 {Math.round(next)}분 뒤 도착</div>}
              </div>
            ))}
            <div className="muted" style={{ marginTop: 6 }}>걷기 {walk}분 · {r.fare ? `요금 ${r.fare.toLocaleString()}원` : '요금 정보 없음'}</div>
          </article>
        );
      })}
      {/* 단순화: 시간표 데이터가 없어 첫차·막차는 "운행 중인 버스 없음"으로만 안내함, 시간표를 구하면 정확한 시각으로 교체 */}
    </main>
  );
}
