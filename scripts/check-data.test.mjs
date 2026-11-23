import { test } from 'node:test';
import assert from 'node:assert/strict';
import { count, problems } from './check-data.mjs';

const ok = { 'stations.json': 4352, 'routes.json': 995, 'schedules.json': 438, 'timetable.json': 933, 'shapes.json': 995, 'walk.json': 399750 };

test('정상 건수는 통과', () => assert.deepEqual(problems(ok, ok), []));
test('빈 데이터는 최소 건수 미달로 실패', () => {
  assert.equal(problems({ ...ok, 'stations.json': 0 }, {}).length, 1);
  assert.equal(problems({ ...ok, 'walk.json': 10 }, {}).length, 1);
});
test('직전보다 20% 넘게 줄면 실패, 조금 줄면 통과', () => {
  assert.equal(problems({ ...ok, 'routes.json': 760 }, ok).length, 1); // 최소(700)는 넘지만 24% 감소
  assert.deepEqual(problems({ ...ok, 'routes.json': 950 }, ok), []);
});
test('건수 세기: 배열·객체·걷는 길', () => {
  assert.equal(count('a.json', [1, 2]), 2);
  assert.equal(count('a.json', { x: 1 }), 1);
  assert.equal(count('walk.json', { lat: [1, 2, 3] }), 3);
  assert.equal(count('a.json', null), 0);
});
test('현재 data/가 기준을 통과한다', async () => {
  const { readFile } = await import('node:fs/promises');
  const now = {};
  for (const name of Object.keys(ok)) now[name] = count(name, JSON.parse(await readFile(`data/${name}`, 'utf8')));
  assert.deepEqual(problems(now, {}), []);
});
