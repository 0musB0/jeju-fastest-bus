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
    s.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${KEY}&autoload=false`;
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

export default function RouteMap({ from, to, rides, walkPath }: { from: Pt; to: Pt; rides: Ride[]; walkPath?: Pt[] }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<Kakao>(null);
  const drawn = useRef<Kakao[]>([]);
  const [err, setErr] = useState('');

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
        ...list.map((m) => new maps.CustomOverlay({ map: map.current, position: ll(m.pt), yAnchor: 1.2, content: `<div class="pin ${m.kind}">${m.label}</div>` })),
      ];
      const bounds = new maps.LatLngBounds();
      list.forEach((m) => bounds.extend(ll(m.pt)));
      segs.forEach((s) => s.path.forEach((p) => bounds.extend(ll(p))));
      map.current.setBounds(bounds, 40, 30, 30, 30);
    }).catch((e) => setErr(e.message));
    return () => { alive = false; };
  }, [from, to, rides]);

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
