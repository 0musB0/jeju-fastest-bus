import { distM, type Pt } from './direct.ts';

// 걷는 길 그래프 (data/walk.json, OpenStreetMap). 직선으로는 가까워도 오름·캠퍼스·하천을 가로질러 못 가는 곳이 있어서
// 걷기 시간을 실제 길 따라 잰다. 외부 호출이 없어 일일 한도가 없다.
export type WalkRaw = { lat: number[]; lng: number[]; e: number[] };
export type WalkTree = { to(q: Pt): { m: number; path: Pt[] } | null };
export type Walker = { tree(p: Pt, maxM: number): WalkTree | null };

const SNAP_M = 60; // 출발·도착점에서 이 거리 안의 길 점들에서 걷기 시작
const SNAP_MAX_M = 250; // 그 안에 없으면 가장 가까운 점 하나 (그것도 없으면 길 데이터 밖 → 직선으로 계산)

export function walkGraph(raw: WalkRaw): Walker {
  const n = raw.lat.length, lat = new Float64Array(n), lng = new Float64Array(n);
  for (let k = 0, a = 0, b = 0; k < n; k++) { a += raw.lat[k]; b += raw.lng[k]; lat[k] = a / 1e5; lng[k] = b / 1e5; }
  const pt = (k: number): Pt => ({ lat: lat[k], lng: lng[k] });
  // 인접 목록 (CSR)
  const start = new Int32Array(n + 1);
  for (const v of raw.e) start[v + 1]++;
  for (let k = 0; k < n; k++) start[k + 1] += start[k];
  const adj = new Int32Array(raw.e.length), len = new Float32Array(raw.e.length), fill = start.slice(0, n);
  for (let k = 0; k < raw.e.length; k += 2) {
    const u = raw.e[k], v = raw.e[k + 1], d = distM(pt(u), pt(v));
    adj[fill[u]] = v; len[fill[u]++] = d;
    adj[fill[v]] = u; len[fill[v]++] = d;
  }
  // 약 220m 격자
  const cell = (la: number, ln: number) => Math.floor(la / 0.002) * 100000 + Math.floor(ln / 0.0024);
  const grid = new Map<number, number[]>();
  for (let k = 0; k < n; k++) { const c = cell(lat[k], lng[k]); const g = grid.get(c); if (g) g.push(k); else grid.set(c, [k]); }
  const snap = (p: Pt): [number, number][] => {
    const out: [number, number][] = [];
    let best: [number, number] | null = null;
    const la = Math.floor(p.lat / 0.002), ln = Math.floor(p.lng / 0.0024);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const k of grid.get((la + a) * 100000 + ln + b) ?? []) {
      const d = distM(p, pt(k));
      if (d <= SNAP_M) out.push([k, d]);
      if (d <= SNAP_MAX_M && (!best || d < best[1])) best = [k, d];
    }
    return out.length ? out : best ? [best] : [];
  };

  function tree(p: Pt, maxM: number): WalkTree | null {
    const seeds = snap(p);
    if (!seeds.length) return null;
    const dist = new Map<number, number>(), prev = new Map<number, number>();
    // 이진 힙 Dijkstra, maxM에서 멈춘다
    const heap: [number, number][] = [];
    const push = (d: number, k: number) => {
      heap.push([d, k]);
      for (let i = heap.length - 1; i > 0; ) { const j = (i - 1) >> 1; if (heap[j][0] <= heap[i][0]) break; [heap[i], heap[j]] = [heap[j], heap[i]]; i = j; }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        for (let i = 0; ; ) {
          const l = 2 * i + 1, r = l + 1;
          let m = i;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === i) break;
          [heap[i], heap[m]] = [heap[m], heap[i]]; i = m;
        }
      }
      return top;
    };
    for (const [k, d] of seeds) if (d < (dist.get(k) ?? Infinity)) { dist.set(k, d); push(d, k); }
    while (heap.length) {
      const [d, u] = pop();
      if (d > (dist.get(u) ?? Infinity) || d > maxM) continue;
      for (let e = start[u]; e < start[u + 1]; e++) {
        const v = adj[e], nd = d + len[e];
        if (nd < (dist.get(v) ?? Infinity) && nd <= maxM) { dist.set(v, nd); prev.set(v, u); push(nd, v); }
      }
    }
    return {
      to(q) {
        const ends = snap(q);
        if (!ends.length) return null;
        let bestM = Infinity, bestK = -1;
        for (const [k, d] of ends) { const m = (dist.get(k) ?? Infinity) + d; if (m < bestM) (bestM = m), (bestK = k); }
        if (bestK < 0) return { m: Infinity, path: [] };
        const path: Pt[] = [q];
        for (let k: number | undefined = bestK; k !== undefined; k = prev.get(k)) path.push(pt(k));
        path.push(p);
        return { m: bestM, path: path.reverse() };
      },
    };
  }
  return { tree };
}
