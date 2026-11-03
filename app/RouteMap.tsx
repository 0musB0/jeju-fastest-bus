'use client';
import { useEffect, useRef, useState } from 'react';
import type { Pt, Ride } from '@/lib/odsay';

// 카카오 지도 (JavaScript 키, 브라우저용. 카카오 콘솔에 등록한 Web 주소에서만 동작)
const KEY = process.env.NEXT_PUBLIC_KAKAO_JS_KEY ?? '';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Kakao = any;
let sdk: Promise<Kakao> | null = null;

function loadSdk(): Promise<Kakao> {
  sdk ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${KEY}&libraries=services&autoload=false`;
    s.onload = () => (window as Kakao).kakao.maps.load(() => resolve((window as Kakao).kakao));
    s.onerror = () => { sdk = null; reject(new Error('지도를 불러오지 못했어요')); };
    document.head.appendChild(s);
  });
  return sdk;
}

type Mark = { pt: Pt; label: string; kind: 'end' | 'stop' };

// 출발 → 승차 → (하차 → 환승 승차)… → 하차 → 도착. 걷는 구간은 점선, 버스 구간은 실선.
function marks(from: Pt, to: Pt, rides: Ride[], walkPath?: Pt[]): { list: Mark[]; segs: { path: Pt[]; bus: boolean }[] } {
  const list: Mark[] = [{ pt: from, label: '출발', kind: 'end' }];
  const segs: { path: Pt[]; bus: boolean }[] = [];
  let last = from;
  rides.forEach((r, i) => {
    if (!r.fromPt || !r.toPt) return;
    list.push({ pt: r.fromPt, label: i ? '환승' : '승차', kind: 'stop' });
    // 걷는 길: 서버가 길 따라 찾은 선, 없으면 직선
    segs.push({ path: r.walkPath ?? [last, r.fromPt], bus: false }, { path: r.path && r.path.length > 1 ? r.path : [r.fromPt, r.toPt], bus: true }); // 서버가 준 노선 모양(도로) → 없으면 정류장을 이어 그림
    if (i === rides.length - 1) list.push({ pt: r.toPt, label: '하차', kind: 'stop' });
    last = r.toPt;
  });
  segs.push({ path: (rides.length ? rides.at(-1)?.walkAfterPath : walkPath) ?? [last, to], bus: false }); // 버스 없이 걸어가면 walkPath
  list.push({ pt: to, label: '도착', kind: 'end' });
  return { list, segs };
}

// bus = 탄 버스의 지금 위치 (따라가는 중, 실시간), me = 내 위치 (GPS), heading = 내가 향한 방향(도)
export default function RouteMap({ from, to, rides, walkPath, bus, me, heading }: { from: Pt; to: Pt; rides: Ride[]; walkPath?: Pt[]; bus?: Pt; me?: Pt; heading?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<Kakao>(null);
  const drawn = useRef<Kakao[]>([]);
  const fitted = useRef(''); // 지도 범위를 맞춘 경로. 20초 갱신은 같은 경로라 사용자가 확대·이동한 화면을 그대로 둔다
  const [err, setErr] = useState('');
  const [ready, setReady] = useState(false); // 지도가 만들어진 뒤에 움직이는 표시를 그림

  useEffect(() => {
    if (!KEY) return;
    let alive = true;
    loadSdk().then((kakao) => {
      if (!alive || !box.current) return;
      const { maps } = kakao;
      const ll = (p: Pt) => new maps.LatLng(p.lat, p.lng);
      map.current ??= new maps.Map(box.current, { center: ll(from), level: 6 });
      drawn.current.forEach((o) => o.setMap(null));
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#e8771e';
      const { list, segs } = marks(from, to, rides, walkPath);
      drawn.current = [
        ...segs.map((s) => new maps.Polyline({ map: map.current, path: s.path.map(ll), strokeWeight: s.bus ? 5 : 3, strokeColor: s.bus ? accent : '#857f74', strokeOpacity: 0.9, strokeStyle: s.bus ? 'solid' : 'shortdash' })),
        ...list.map((m) => new maps.CustomOverlay({ map: map.current, position: ll(m.pt), yAnchor: 1.2, zIndex: 5, content: `<div class="pin ${m.kind}">${m.label}</div>` })),
      ];
      const sig = JSON.stringify(list.map((m) => [m.label, m.pt.lat, m.pt.lng]));
      if (sig !== fitted.current) {
        fitted.current = sig;
        const bounds = new maps.LatLngBounds();
        list.forEach((m) => bounds.extend(ll(m.pt)));
        segs.forEach((s) => s.path.forEach((p) => bounds.extend(ll(p))));
        map.current.setBounds(bounds, 40, 30, 30, 30);
      }
      setReady(true);
    }).catch((e) => setErr(e.message));
    return () => { alive = false; };
  }, [from, to, rides]);

  // 움직이는 표시(탄 버스, 내 위치)는 따로: 20초·GPS마다 지도 범위를 다시 맞추면 사용자가 옮긴 화면이 튄다
  // 표시는 한 번 만들고 자리·방향만 바꾼다. 갱신마다 지우고 새로 만들면 아이콘이 깜박인다 (2026-11-03)
  const busOv = useRef<Kakao>(null), meOv = useRef<Kakao>(null), arrow = useRef<HTMLElement | null>(null), rot = useRef(0);
  useEffect(() => {
    if (!KEY) return;
    loadSdk().then((kakao) => {
      if (!map.current) return; // 지도가 아직이면 ready가 바뀔 때 다시 그림
      const { maps } = kakao;
      if (bus) {
        busOv.current ??= new maps.CustomOverlay({ yAnchor: 1.2, zIndex: 3, content: '<div class="pin bus">탄 버스</div>' });
        busOv.current.setPosition(new maps.LatLng(bus.lat, bus.lng));
        busOv.current.setMap(map.current);
      } else busOv.current?.setMap(null);
      if (me) {
        if (!meOv.current) {
          const el = document.createElement('div');
          el.className = 'me';
          el.innerHTML = '<i></i><img src="/icon.svg" alt="내 위치">';
          arrow.current = el.querySelector('i');
          meOv.current = new maps.CustomOverlay({ zIndex: 4, content: el });
        }
        meOv.current.setPosition(new maps.LatLng(me.lat, me.lng));
        meOv.current.setMap(map.current);
        if (arrow.current) {
          arrow.current.style.display = heading === undefined ? 'none' : '';
          // 359° → 1°를 거꾸로 한 바퀴 돌지 않게 가까운 쪽으로 돈다
          if (heading !== undefined) rot.current += ((heading - rot.current) % 360 + 540) % 360 - 180;
          arrow.current.style.transform = `rotate(${Math.round(rot.current)}deg)`;
        }
      } else meOv.current?.setMap(null);
    }).catch(() => {});
  }, [ready, bus?.lat, bus?.lng, me?.lat, me?.lng, heading]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!KEY) return null;
  return err ? <p className="warn">{err}</p> : <div ref={box} className="map" role="img" aria-label="경로 지도" />;
}

// 노선 한 개의 선(노선 페이지). 접힌 <details> 안에 있으면 펼칠 때 그린다 (숨긴 상자에는 지도를 못 그림)
export function RouteLine({ path }: { path: Pt[] }) {
  const box = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!KEY || !box.current || path.length < 2) return;
    const holder = box.current.closest('details');
    let done = false;
    const draw = () => {
      if (done || (holder && !holder.open)) return;
      done = true;
      loadSdk().then((kakao) => {
        if (!box.current) return;
        const { maps } = kakao;
        const ll = (p: Pt) => new maps.LatLng(p.lat, p.lng);
        const map = new maps.Map(box.current, { center: ll(path[0]), level: 8 });
        const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#e8771e';
        new maps.Polyline({ map, path: path.map(ll), strokeWeight: 5, strokeColor: accent, strokeOpacity: 0.9 });
        [[path[0], '출발'], [path.at(-1)!, '종점']].forEach(([pt, label]) =>
          new maps.CustomOverlay({ map, position: ll(pt as Pt), yAnchor: 1.2, content: `<div class="pin end">${label}</div>` }));
        const bounds = new maps.LatLngBounds();
        path.forEach((p) => bounds.extend(ll(p)));
        map.setBounds(bounds, 30, 30, 30, 30);
      }).catch((e) => setErr(e.message));
    };
    draw();
    holder?.addEventListener('toggle', draw);
    return () => holder?.removeEventListener('toggle', draw);
  }, [path]);

  if (!KEY || path.length < 2) return null;
  return err ? <p className="warn">{err}</p> : <div ref={box} className="map" role="img" aria-label="노선 지도" />;
}

// 지도를 눌러 출발지·도착지 고르기. 누른 곳의 주소를 이름으로 쓴다 (카카오 지도 SDK 주소 변환, 없으면 "지도에서 고른 곳")
const JEJU_CENTER = { lat: 33.38, lng: 126.55 };
const inJeju = (p: Pt) => p.lat > 33.1 && p.lat < 33.6 && p.lng > 126.08 && p.lng < 127; // app/api/plan의 point()와 같은 범위
export function PickMap({ onPick }: { onPick: (p: { name: string; address?: string; lat: number; lng: number }) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [spot, setSpot] = useState<{ name: string; address?: string; lat: number; lng: number } | null>(null);
  const [err, setErr] = useState('');
  const me = useRef<Pt | null>(null); // 내 위치 (GPS, 지도에 파란 점)
  const pickRef = useRef<((p: Pt, pan?: boolean) => void) | null>(null);

  useEffect(() => {
    if (!KEY) return;
    let watch: number | undefined, alive = true;
    loadSdk().then((kakao) => {
      if (!alive || !box.current) return;
      const { maps } = kakao;
      const ll = (p: Pt) => new maps.LatLng(p.lat, p.lng);
      const map = new maps.Map(box.current, { center: ll(JEJU_CENTER), level: 9 });
      map.setMaxLevel(10); // 제주 섬 하나가 다 보이는 데까지만 멀어짐
      // 고른 곳 = 감귤 로고 핀 (기본 파란 마커 대신), 내 위치 = 파란 점
      const marker = new maps.CustomOverlay({ yAnchor: 1, zIndex: 3, content: '<img class="tangerine" src="/icon.svg" alt="고른 곳">' });
      const dot = new maps.CustomOverlay({ zIndex: 2, content: '<div class="me-dot" aria-label="내 위치"></div>' });
      const geocoder = new maps.services.Geocoder();
      const pick = (p: Pt, pan = false) => {
        if (!inJeju(p)) return setErr('제주 안에서 골라 주세요');
        setErr('');
        marker.setPosition(ll(p));
        marker.setMap(map);
        if (pan) (map.setLevel(4), map.panTo(ll(p)));
        setSpot({ name: '지도에서 고른 곳', ...p });
        geocoder.coord2Address(p.lng, p.lat, (res: Kakao[], status: string) => {
          const a = status === maps.services.Status.OK ? res[0] : null;
          const name = a?.road_address?.building_name || a?.road_address?.address_name || a?.address?.address_name;
          if (name) setSpot({ name, address: a?.address?.address_name, ...p });
        });
      };
      pickRef.current = pick;
      maps.event.addListener(map, 'click', (e: Kakao) => pick({ lat: e.latLng.getLat(), lng: e.latLng.getLng() }));
      // 내 위치를 계속 받아 파란 점으로. 처음 받은 위치가 제주면 거기서 시작
      let first = true;
      watch = navigator.geolocation?.watchPosition((g) => {
        const p = { lat: g.coords.latitude, lng: g.coords.longitude };
        me.current = p;
        dot.setPosition(ll(p));
        dot.setMap(map);
        if (first && inJeju(p)) (map.setCenter(ll(p)), map.setLevel(5));
        first = false;
      }, () => {}, { enableHighAccuracy: true, timeout: 20_000, maximumAge: 10_000 });
    }).catch((e) => setErr(e.message));
    return () => { alive = false; if (watch !== undefined) navigator.geolocation.clearWatch(watch); };
  }, []);

  // "내 위치로": 지도를 내 위치로 옮기고 그곳을 고른다
  const toMe = () => {
    if (me.current) return pickRef.current?.(me.current, true);
    setErr('내 위치를 받는 중이에요. 위치 권한을 허용했는지 확인해 주세요.');
    navigator.geolocation?.getCurrentPosition((g) => { me.current = { lat: g.coords.latitude, lng: g.coords.longitude }; pickRef.current?.(me.current, true); }, () => setErr('내 위치를 받지 못했어요. 위치 권한을 확인해 주세요.'), { enableHighAccuracy: true, timeout: 10_000 });
  };

  if (!KEY) return <p className="warn">지도를 쓸 수 없어요</p>;
  return (
    <div className="pickmap">
      {/* 한라산과 바다 물결 띠 */}
      <div className="pick-head">
        <svg viewBox="0 0 120 28" width="96" height="22" aria-hidden="true"><path d="M0 24 Q30 20 46 10 Q60 2 74 10 Q90 20 120 24Z" fill="currentColor" opacity=".85" /><path d="M0 26 q7.5-3 15 0 t15 0 t15 0 t15 0 t15 0 t15 0 t15 0 t15 0" fill="none" stroke="var(--green)" strokeWidth="1.6" /></svg>
        <span>제주 어디로 갈까요?</span>
      </div>
      <div className="pick-wrap">
        <div ref={box} className="map" role="application" aria-label="지도를 눌러 위치 고르기" />
        <button type="button" className="to-me" onClick={toMe} aria-label="내 위치로" title="내 위치로">
          <svg width="20" height="20" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="3" fill="currentColor" /><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M8 0v2.5M8 13.5V16M0 8h2.5M13.5 8H16" stroke="currentColor" strokeWidth="1.5" /></svg>
        </button>
      </div>
      <div className="row">
        <span className="muted">{spot ? spot.name : '지도를 눌러 감귤을 꽂아 보세요'}</span>
        <button className="primary" disabled={!spot} onClick={() => spot && onPick(spot)}>이 위치로</button>
      </div>
      {err && <p className="warn">{err}</p>}
    </div>
  );
}
