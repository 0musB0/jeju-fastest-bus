import { test } from 'node:test';
import assert from 'node:assert/strict';
import { directCandidates, distM } from './direct.ts';

// 위도 0.001도 ≈ 111m
const st = (id: string, lat: number) => ({ id, name: id, lat, lng: 126.5 });
const stations = [st('A', 33.500), st('B', 33.505), st('C', 33.520), st('D', 33.5205)];

test('거리 계산: 위도 0.001도는 약 111m', () => {
  assert.ok(Math.abs(distM({ lat: 33.5, lng: 126.5 }, { lat: 33.501, lng: 126.5 }) - 111) < 1);
});

test('직행 노선: 방향이 맞는 노선만, 노선마다 가장 빠른 조합', () => {
  const routes = [
    { id: '1', no: '100', to: '시청', stops: ['A', 'B', 'C'] },
    { id: '2', no: '100', to: '공항', stops: ['C', 'B', 'A'] }, // 반대 방향
    { id: '3', no: '200', to: '시청', stops: ['A', 'X', 'Y', 'Z', 'D'] },
  ];
  const r = directCandidates({ lat: 33.5, lng: 126.5 }, { lat: 33.5202, lng: 126.5 }, stations, routes);
  assert.deepEqual(r.map((d) => [d.routeId, d.fromId, d.stops]), [['1', 'A', 2], ['3', 'A', 4]]);
});
