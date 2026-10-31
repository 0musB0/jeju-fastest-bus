'use client';
import { useEffect, useState } from 'react';
import { arrivalMin, kstClock } from '@/lib/eta';
import { parseOdsay, type Route } from '@/lib/odsay';
import { applyRealtime, directToRoutes, realtimeKeys, type PlanResults } from '@/lib/realtime';
import type { Direct } from '@/lib/direct';

type Place = { name: string; address?: string; lat: number; lng: number };
type Ranked = Route & { eta: ReturnType<typeof arrivalMin> };

const ODSAY_KEY = process.env.NEXT_PUBLIC_ODSAY_KEY ?? '';
const SOURCE_LABEL = { realtime: '실시간', timetable: '시간표 기준', unknown: '' } as const;

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

  function here() {
    setMsg('현재 위치 확인 중...');
    navigator.geolocation.getCurrentPosition(
      (p) => { onPick({ name: '현재 위치', lat: p.coords.latitude, lng: p.coords.longitude }); setMsg(''); },
      (e) => setMsg(e.code === 1 ? '위치 권한이 거부됐어요. 출발지를 검색해 주세요.' : '현재 위치를 알 수 없어요. 출발지를 검색해 주세요.'),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  return (
    <section style={{ marginBottom: 16 }}>
      <b>{label}</b>{' '}
      {value ? (
        <span>{value.name} <button onClick={() => onPick(null)}>바꾸기</button></span>
      ) : (
        <>
          {allowHere && <button onClick={here}>현재 위치</button>}
          <form onSubmit={search} style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="장소 이름" style={{ flex: 1, padding: 8 }} />
            <button disabled={!q.trim()}>검색</button>
          </form>
          {list.map((p) => (
            <button key={`${p.lat},${p.lng},${p.name}`} onClick={() => { onPick(p); setList([]); }} style={{ display: 'block', width: '100%', textAlign: 'left', marginTop: 4, padding: 8 }}>
              {p.name} <small style={{ color: '#666' }}>{p.address}</small>
            </button>
          ))}
        </>
      )}
      {msg && <p style={{ color: '#b00', margin: '6px 0' }}>{msg}</p>}
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
      if (!parsed.ok) return setMsg(parsed.reason === '경로 없음' ? '버스로 가는 경로가 없어요. 걸어가기 가까운 거리일 수 있어요.' : parsed.reason);
      // 실시간 버스 위치로 첫 버스 대기를 채우고, 서버가 찾은 직행 후보를 더한다. 실패하면 ODsay 결과만 쓴다.
      const odsay = [...parsed.routes].sort((a, b) => a.odsayMin - b.odsayMin);
      let results: PlanResults = {};
      let direct: Direct[] = [];
      try {
        const q = new URLSearchParams({ q: realtimeKeys(odsay).join(','), from: `${from.lat},${from.lng}`, to: `${to.lat},${to.lng}` });
        const r = await fetch(`/api/plan?${q}`).then((r) => r.json());
        results = r.results ?? {};
        direct = r.direct ?? [];
      } catch { /* 실시간 실패: 아래에서 추정 불가로 표시 */ }
      const byTime = [...odsay, ...directToRoutes(direct, odsay)];
      // 대기를 알 수 있는 후보가 먼저, 그 안에서 도착이 빠른 순. 모르면 이동 시간 순으로 맨 뒤.
      const ranked = byTime
        .map((r) => applyRealtime(r, results))
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
      <h1 style={{ fontSize: 24 }}>제주 가장 빠른 버스</h1>
      <PlacePicker label="출발" value={from} onPick={setFrom} allowHere />
      <PlacePicker label="도착" value={to} onPick={setTo} />
      {msg && <p>{msg}</p>}
      {at && routes.length > 0 && (
        <p style={{ color: '#666', fontSize: 14 }}>
          {kstClock(at)} 기준 {stale && <button onClick={plan}>다시 계산</button>}
        </p>
      )}
      <ol style={{ paddingLeft: 20 }}>
        {routes.map((r, i) => {
          const walk = r.candidate.legs.reduce((s, l) => s + l.walkBeforeMin, r.candidate.walkAfterMin);
          return (
            <li key={i} style={{ marginBottom: 16 }}>
              {r.eta ? (
                <b>{kstClock(at!, r.eta.min)} 도착 ({Math.round(r.eta.min)}분 뒤) · {SOURCE_LABEL[r.eta.source]}</b>
              ) : (
                <b>이동 {r.odsayMin}분 + 대기 · {r.noBusNow ? '지금 운행 중인 버스 없음 (첫차 전이거나 막차 후일 수 있어요)' : '대기 추정 불가'}</b>
              )}
              {r.rides.map((x, j) => (
                <div key={j}>
                  {j > 0 && '환승 → '}<b>{x.busNos.join(', ')}번</b> {x.from} 승차 → {x.to} 하차 ({x.stops}정류장)
                  {j === 0 && r.candidate.legs[0].nextBusesMin && <> · 다음 버스 {Math.round(r.candidate.legs[0].nextBusesMin[0])}분 뒤</>}
                </div>
              ))}
              <small style={{ color: '#666' }}>걷기 {walk}분 · {r.fare ? `요금 ${r.fare.toLocaleString()}원` : '요금 정보 없음 (직행 후보)'}</small>
            </li>
          );
        })}
      </ol>
      {/* 단순화: 시간표 데이터가 없어 첫차·막차는 "운행 중인 버스 없음"으로만 안내함, 시간표를 구하면 정확한 시각으로 교체 */}
    </main>
  );
}
