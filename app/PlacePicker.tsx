'use client';
import { useEffect, useRef, useState } from 'react';
import { parseFavs, type Place } from '@/lib/storage';
import { loadPinned, loadTrip } from './saved';
import { PickMap } from './RouteMap';

// 도착 칸 안내 문구: 제주말, 페이지를 열 때마다 바뀐다
const ASKS = ['어디 감수꽈?', '어드레 가카마씸?', '오늘은 어드레 감서?'];
// 즐겨찾는 도착지: 이 기기 브라우저에만 저장 (로그인 없음, 다른 기기와는 공유 안 됨)
const FAVS = 'favs';
const sameSpot = (a: Place, b: Place) => a.name === b.name && Math.abs(a.lat - b.lat) < 1e-5 && Math.abs(a.lng - b.lng) < 1e-5;

export default function PlacePicker({ label, value, onPick, allowHere, favorites }: { label: string; value: Place | null; onPick: (p: Place | null) => void; allowHere?: boolean; favorites?: boolean }) {
  const [q, setQ] = useState('');
  const [favs, setFavs] = useState<Place[]>([]);
  useEffect(() => {
    if (favorites) try { setFavs(parseFavs(localStorage.getItem(FAVS))); } catch {}
  }, [favorites]);
  const saveFavs = (next: Place[]) => {
    setFavs(next);
    try { localStorage.setItem(FAVS, JSON.stringify(next)); } catch {}
  };
  const isFav = !!value && favs.some((f) => sameSpot(f, value));
  const [list, setList] = useState<Place[]>([]);
  const [msg, setMsg] = useState('');
  const [onMap, setOnMap] = useState(false); // 지도에서 고르기 열림

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
            {/* 접힌 지도 모양 아이콘: 지도에서 고르기 */}
            <button type="button" className={`mapbtn${onMap ? ' on' : ''}`} onClick={() => setOnMap(!onMap)} aria-expanded={onMap} aria-label={onMap ? '지도 닫기' : '지도에서 고르기'} title="지도에서 고르기">
              <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6.5l6-2.5 6 2.5 6-2.5v13.5l-6 2.5-6-2.5-6 2.5z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /><path d="M9 4v13.5M15 6.5V20" stroke="currentColor" strokeWidth="1.7" /></svg>
            </button>
          </form>
          {allowHere && (
            <button className="ghost" onClick={here} style={{ marginTop: 6 }}>
              <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="3" fill="currentColor" /><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
              현재 위치 사용
            </button>
          )}
          {onMap && <PickMap onPick={(p) => { onPick(p); setOnMap(false); setMsg(''); setList([]); }} />}
          {favorites && favs.length > 0 && !list.length && (
            <div className="favs">
              {favs.map((f) => (
                <span key={`${f.lat},${f.lng},${f.name}`} className="favchip">
                  <button onClick={() => { onPick(f); setMsg(''); }}>{f.name}</button>
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
