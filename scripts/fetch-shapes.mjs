// 노선 모양(도로를 따라가는 좌표)을 bus.jeju.go.kr에서 받아 data/shapes.json으로 저장한다. 지도에 노선을 도로 따라 그릴 때 쓴다.
// 사이트 노선검색 지도가 쓰는 /data/search/getLinkInfoByLineId (POST, lineId = BIS 노선 ID). 시간표와 같은 사이트, 사용자 승인(2026-10-31).
// 한 번에 하나씩, 요청 사이 0.3초. 중간 인증서는 워크플로가 NODE_EXTRA_CA_CERTS로 채워 준다.
// 결과: { 노선ID: { p: [위도, 경도, 위도, 경도, ...], s: [정류장마다 p의 점 번호] } }
import { readFile, writeFile } from 'node:fs/promises';

const URL_ = 'https://bus.jeju.go.kr/data/search/getLinkInfoByLineId';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = 6371000, rad = Math.PI / 180;
const dist = (a, b) => Math.hypot((b[1] - a[1]) * rad * Math.cos(a[0] * rad), (b[0] - a[0]) * rad) * R;

async function get(id) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(URL_, { method: 'POST', body: new URLSearchParams({ lineId: id }), signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      if (!Array.isArray(body)) throw new Error('배열이 아님');
      return body.flatMap((p) => (+p.localY && +p.localX ? [[+p.localY, +p.localX]] : []));
    } catch (e) {
      if (i >= 3) throw new Error(`${id}: ${e.message}`);
      await sleep(2000 * i);
    } finally {
      await sleep(300);
    }
  }
}

// 점을 줄인다: 선에서 8m 안쪽으로 벗어나는 점은 버림 (Douglas-Peucker)
function simplify(pts, tol = 8) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let best = -1, far = 0;
    for (let i = a + 1; i < b; i++) {
      // 점 i에서 선분 a-b까지 거리 (평면 근사)
      const ab = dist(pts[a], pts[b]), ai = dist(pts[a], pts[i]), bi = dist(pts[b], pts[i]);
      const d = ab < 1 ? ai : Math.sqrt(Math.max(0, ai * ai - ((ai * ai - bi * bi + ab * ab) / (2 * ab)) ** 2));
      if (d > far) (far = d), (best = i);
    }
    if (far > tol) (keep[best] = 1), stack.push([a, best], [best, b]);
  }
  return pts.filter((_, i) => keep[i]);
}

// 정류장마다 모양의 어느 점인지: 앞 정류장 뒤에서, 30m 안에 처음 닿는 점 (없으면 가장 가까운 점)
function stopIndex(pts, stops) {
  let prev = 0;
  return stops.map((st) => {
    if (!st) return -1;
    let best = -1, bd = Infinity;
    for (let i = prev; i < pts.length; i++) {
      const d = dist(pts[i], st);
      if (d < 30) { best = i; break; }
      if (d < bd) (bd = d), (best = i);
    }
    if (best < 0 || dist(pts[best], st) > 200) return -1; // 모양과 동떨어진 정류장
    prev = best;
    return best;
  });
}

const routes = JSON.parse(await readFile('data/routes.json', 'utf8'));
const stations = new Map(JSON.parse(await readFile('data/stations.json', 'utf8')).map((s) => [s.id, [s.lat, s.lng]]));
const old = JSON.parse(await readFile('data/shapes.json', 'utf8').catch(() => '{}'));
const out = {};
let failed = 0;
for (const r of routes) {
  try {
    const pts = simplify(await get(r.id));
    if (pts.length < 2) throw new Error(`${r.id}: 좌표 없음`);
    out[r.id] = { p: pts.flat().map((v) => Math.round(v * 1e5) / 1e5), s: stopIndex(pts, r.stops.map((id) => stations.get(id))) };
  } catch (e) {
    failed++;
    console.warn(e.message);
    if (old[r.id]) out[r.id] = old[r.id]; // 실패하면 지난달 것 유지
  }
}
if (failed > routes.length * 0.2) throw new Error(`실패 ${failed}/${routes.length} — 저장하지 않음`);
await writeFile('data/shapes.json', JSON.stringify(out));
console.log(`노선 모양 ${Object.keys(out).length}/${routes.length} (실패 ${failed})`);
