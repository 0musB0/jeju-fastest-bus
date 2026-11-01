import { test } from 'node:test';
import assert from 'node:assert/strict';
import { walkGraph } from './walk.ts';

test('걷는 길: 직선으로 가까워도 길이 돌아가면 길 따라 잰다', () => {
  // ㄷ자 길: (0,0) → 북쪽 1km → 동쪽 → 남쪽으로 내려와 (0, 동쪽 약 280m). 가운데는 길이 없다(오름).
  const pts = [[3350000, 12650000], [3350900, 12650000], [3350900, 12650300], [3350000, 12650300]];
  const raw = { lat: pts.map((p, k) => p[0] - (k ? pts[k - 1][0] : 0)), lng: pts.map((p, k) => p[1] - (k ? pts[k - 1][1] : 0)), e: [0, 1, 1, 2, 2, 3] };
  const w = walkGraph(raw);
  const r = w.tree({ lat: 33.5, lng: 126.5 }, 5000)!.to({ lat: 33.5, lng: 126.503 })!;
  assert.ok(r.m > 2000 && r.m < 2300, `${r.m}`); // 직선 약 280m가 아니라 1km + 280m + 1km
  assert.equal(r.path.length, 6); // 출발점, 길 점 4개, 도착점
  assert.equal(w.tree({ lat: 33.5, lng: 126.5 }, 500)!.to({ lat: 33.5, lng: 126.503 })!.m, Infinity); // 500m 안에는 못 닿음
  assert.equal(w.tree({ lat: 33.3, lng: 126.5 }, 500), null); // 길 데이터 밖
});
