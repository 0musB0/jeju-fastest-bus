'use client';
import { useEffect, useRef, useState } from 'react';
import type { Pt } from '@/lib/odsay';

// 내 위치(GPS)와 향한 방향(나침반). 지도가 떠 있는 동안(active)만 받는다.
// me = 지도와 '탔는지' 판단에 쓰는 GPS 위치(acc = 정확도 m), meRef = 같은 값 (계산 함수가 최신값을 읽도록), heading = 북쪽 0°, 시계 방향
export function useMyLocation(active: boolean) {
  const [me, setMe] = useState<(Pt & { acc?: number }) | undefined>(undefined);
  const meRef = useRef<(Pt & { acc?: number }) | undefined>(undefined);
  meRef.current = me;
  const [heading, setHeading] = useState<number | undefined>(undefined);
  // 경로 지도가 떠 있는 동안 내 위치를 계속 받는다 (따라가기 여부와 상관없이). 한 번 실패해도 마지막 위치는 그대로 둔다
  useEffect(() => {
    if (!active || !navigator.geolocation) return;
    const set = (p: GeolocationPosition) => {
      setMe({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy });
      if (p.coords.heading != null && !isNaN(p.coords.heading) && (p.coords.speed ?? 0) > 1) setHeading(p.coords.heading); // 움직일 때 GPS 진행 방향
    };
    const opt = { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 };
    navigator.geolocation.getCurrentPosition(set, () => {}, opt); // 가만히 있으면 watch가 늦게 오는 폰이 있어 바로 한 번
    const w = navigator.geolocation.watchPosition(set, () => {}, opt);
    return () => navigator.geolocation.clearWatch(w);
  }, [active]);
  // 나침반: 서 있을 때도 폰이 향한 방향. 아이폰은 webkitCompassHeading, 안드로이드는 deviceorientationabsolute의 alpha
  // 아이폰은 권한을 화면을 누를 때만 물을 수 있어서, 지도가 뜬 뒤 첫 터치에 묻는다
  useEffect(() => {
    if (!active || typeof DeviceOrientationEvent === 'undefined') return;
    let last = -999, t = 0;
    const on = (e: DeviceOrientationEvent & { webkitCompassHeading?: number }) => {
      const h = e.webkitCompassHeading ?? (e.absolute && e.alpha != null ? 360 - e.alpha : undefined);
      const now = Date.now();
      if (h === undefined || now - t < 300 || Math.abs(((h - last + 540) % 360) - 180) < 5) return; // 0.3초·5° 넘게 바뀔 때만 (지도 표시를 너무 자주 다시 그리지 않게)
      last = h; t = now; setHeading(h);
    };
    const start = () => { window.addEventListener('deviceorientationabsolute', on as EventListener); window.addEventListener('deviceorientation', on as EventListener); };
    const ask = (DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> }).requestPermission;
    const tap = () => ask?.().then((r) => r === 'granted' && start()).catch(() => {});
    if (ask) window.addEventListener('pointerdown', tap, { once: true }); else start();
    return () => { window.removeEventListener('pointerdown', tap); window.removeEventListener('deviceorientationabsolute', on as EventListener); window.removeEventListener('deviceorientation', on as EventListener); };
  }, [active]);
  return { me, meRef, heading };
}
