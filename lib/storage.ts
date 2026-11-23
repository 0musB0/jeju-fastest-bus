import type { Followed } from './follow.ts';
// 브라우저 저장소(localStorage·sessionStorage)에서 읽은 문자열 검증. 사용자가 지우거나 고치거나 옛 버전이 남긴 값이 와도
// 화면이 죽지 않게, 모양이 안 맞으면 null(없는 것으로 취급)을 돌려준다. 외부 호출·DOM 없음.

export type Place = { name: string; address?: string; lat: number; lng: number };
const obj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const json = (raw: string | null): unknown => { try { return JSON.parse(raw ?? 'null'); } catch { return null; } };

export const asPlace = (v: unknown): Place | null =>
  obj(v) && typeof v.name === 'string' && fin(v.lat) && fin(v.lng) && Math.abs(v.lat) <= 90 && Math.abs(v.lng) <= 180
    ? { name: v.name, ...(typeof v.address === 'string' ? { address: v.address } : {}), lat: v.lat, lng: v.lng } : null;

// 즐겨찾기: 깨진 항목만 버리고 나머지는 살린다
export const parseFavs = (raw: string | null): Place[] => { const v = json(raw); return Array.isArray(v) ? v.flatMap((x) => asPlace(x) ?? []) : []; };

// 탭 안에 저장한 출발·도착. "현재 위치"는 되살리지 않는다 (그새 움직였을 수 있으니 다시 묻는다)
export function parseTrip(raw: string | null): { from: Place | null; to: Place | null } | null {
  const v = json(raw);
  if (!obj(v)) return null;
  const from = asPlace(v.from), to = asPlace(v.to);
  return { from: from?.name === '현재 위치' ? null : from, to };
}

// 따라가기: 화면이 바로 쓰는 값(경로의 구간·시간 배열)까지 모양을 확인한다. 도착 시각에서 30분이 지났으면 버린다.
export type Pinned = { from: Place; to: Place; r: Followed; t: number; held: boolean; k?: number; since?: number };
export function parsePinned(raw: string | null, now: number): Pinned | null {
  const p = json(raw);
  if (!obj(p) || !obj(p.r)) return null;
  const from = asPlace(p.from), to = asPlace(p.to), r = p.r;
  const eta = r.eta, cand = r.candidate, rides = r.rides;
  if (!from || !to || !fin(p.t) || !obj(eta) || !fin(eta.min) || !Array.isArray(eta.boards)) return null;
  if (!obj(cand) || !Array.isArray(cand.legs) || !fin(cand.walkAfterMin) || !Array.isArray(rides) || !rides.length || rides.length !== cand.legs.length || eta.boards.length !== rides.length) return null;
  const legsOk = cand.legs.every((l) => obj(l) && fin(l.walkBeforeMin) && fin(l.rideMin));
  const ridesOk = rides.every((x) => obj(x) && Array.isArray(x.routeIds) && Array.isArray(x.busNos) && typeof x.stationId === 'string' && typeof x.from === 'string' && typeof x.to === 'string' && fin(x.stops));
  const boardsOk = eta.boards.every((b) => obj(b) && fin(b.at) && fin(b.atStop));
  if (!legsOk || !ridesOk || !boardsOk || now >= p.t + (eta.min + 30) * 60000) return null;
  return { from, to, r: r as unknown as Followed, t: p.t, held: p.held === true, ...(fin(p.k) ? { k: p.k } : {}), ...(fin(p.since) ? { since: p.since } : {}) };
}
