import { test } from 'node:test';
import assert from 'node:assert/strict';
import { airportRides } from './guides.ts';

const st = (id: string, name: string, lat: number) => ({ id, name, lat, lng: 126.5 });
const stations = [st('a', '제주국제공항(하차전용)', 33.5), st('b', '제주국제공항', 33.501), st('c', '중간', 33.45), st('d', '중문', 33.4)];

test('공항 → 목적지 직행 노선: 하차전용·반대 방향 빼고, 같은 번호는 빠른 가지만', () => {
  const routes = [
    { id: '1', no: '182-1', to: '중문', stops: ['b', 'c', 'd'] },
    { id: '2', no: '182-2', to: '중문', stops: ['b', 'c', 'c', 'c', 'd'] },
    { id: '3', no: '300-1', to: '공항', stops: ['d', 'c', 'a'] }, // 반대 방향
    { id: '4', no: '400-1', to: '중문', stops: ['a', 'd'] }, // 하차전용에서는 못 탐
  ];
  const tt = { '1': { p: [0, 0, 2, 20], t: [360, 1200], n: 3 } };
  const r = airportRides(stations, routes, tt, /중문/);
  assert.equal(r.length, 1);
  assert.deepEqual(r[0], { no: '182', variant: '182-1', to: '중문', stops: 2, min: 20, first: 360, last: 1200, perDay: 2 });
});

test('가장 빠른 버스보다 1.6배 넘게 걸리는 노선은 뺀다', () => {
  const routes = [
    { id: '1', no: '100-1', to: '중문', stops: ['b', 'd'] },
    { id: '2', no: '200-1', to: '중문', stops: ['b', 'd'] },
  ];
  const tt = { '1': { p: [0, 0, 1, 30], t: [400], n: 2 }, '2': { p: [0, 0, 1, 60], t: [400], n: 2 } };
  assert.deepEqual(airportRides(stations, routes, tt, /중문/).map((r) => r.no), ['100']);
});
