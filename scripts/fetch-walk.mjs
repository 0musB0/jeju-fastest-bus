// 걷는 길(OpenStreetMap) → data/walk.json. 걷기 시간을 직선이 아니라 실제 길로 계산하는 데 쓴다.
// 실행: node scripts/fetch-walk.mjs  (Overpass API, 한 번에 받음. 길은 자주 안 바뀌어서 가끔만 돌린다)
// 형식: lat·lng = 1e-5도 단위 정수의 차분, e = 이어진 두 점 번호 쌍 [a, b, a, b, ...]
import { writeFile } from 'node:fs/promises';

// 제주 본섬. 자동차 전용도로·공사 중인 길·보행 금지 길은 뺀다.
const q = `[out:json][timeout:300];
way["highway"]["highway"!~"^(motorway|motorway_link|construction|proposed|raceway|bus_guideway|abandoned)$"]["foot"!~"^(no|private)$"]["access"!~"^(no|private)$"]["area"!="yes"](33.18,126.13,33.58,126.98);
(._;>;);out skel qt;`;
const servers = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
let data;
for (const s of servers) {
  try {
    const res = await fetch(s, { method: 'POST', body: new URLSearchParams({ data: q }), signal: AbortSignal.timeout(360_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
    break;
  } catch (e) { console.error(s, e.message); }
}
if (!data?.elements?.length) throw new Error('Overpass 응답 없음');

const coord = new Map(), ways = [];
for (const el of data.elements) {
  if (el.type === 'node') coord.set(el.id, [Math.round(el.lat * 1e5), Math.round(el.lon * 1e5)]);
  else if (el.type === 'way') ways.push(el.nodes);
}
const idx = new Map(), lat = [], lng = [], e = [];
const at = (id) => {
  if (!idx.has(id)) { const [a, b] = coord.get(id); idx.set(id, lat.length); lat.push(a); lng.push(b); }
  return idx.get(id);
};
for (const w of ways) for (let k = 1; k < w.length; k++) if (coord.has(w[k - 1]) && coord.has(w[k])) e.push(at(w[k - 1]), at(w[k]));
const diff = (v) => v.map((x, k) => (k ? x - v[k - 1] : x));
await writeFile('data/walk.json', JSON.stringify({ lat: diff(lat), lng: diff(lng), e }));
console.log(`걷는 길: 점 ${lat.length}개, 선분 ${e.length / 2}개`);
