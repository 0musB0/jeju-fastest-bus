import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findTrips, indexData, distM } from './direct.ts';

// 위도 0.001도 ≈ 111m
const st = (id: string, lat: number) => ({ id, name: id, lat, lng: 126.5 });
const stations = [st('A', 33.500), st('B', 33.505), st('C', 33.520), st('D', 33.5205)];

test('거리 계산: 위도 0.001도는 약 111m', () => {
  assert.ok(Math.abs(distM({ lat: 33.5, lng: 126.5 }, { lat: 33.501, lng: 126.5 }) - 111) < 1);
});

test('직행 노선: 방향이 맞는 노선만, 같은 정류장 조합은 합침', () => {
  const routes = [
    { id: '1', no: '100', to: '시청', stops: ['A', 'B', 'C'] },
    { id: '2', no: '100', to: '공항', stops: ['C', 'B', 'A'] }, // 반대 방향
    { id: '3', no: '200', to: '시청', stops: ['A', 'X', 'Y', 'Z', 'D'] },
  ];
  const r = findTrips({ lat: 33.5, lng: 126.5 }, { lat: 33.5202, lng: 126.5 }, indexData(stations, routes));
  assert.deepEqual(r.map((t) => t.legs.map((l) => [l.routeIds, l.fromId, l.stops])), [[[['1'], 'A', 2]], [[['3'], 'A', 4]]]);
});

test('한 번 환승: 출발지 근처에서 바로 탈 수 없는 노선으로만 갈아탄다', () => {
  // A(출발) … M(중간, 2km) … E(도착, 4km). 노선 1: A→M, 노선 2: M→E, 노선 3: M'(M 옆 100m)→E
  const s = (id: string, lat: number, lng = 126.5) => ({ id, name: id, lat, lng });
  const st2 = [s('A', 33.5), s('M', 33.518), s('M2', 33.5189), s('E', 33.536)];
  const routes = [
    { id: '1', no: '100', to: '', stops: ['A', 'M'] },
    { id: '2', no: '200', to: '', stops: ['M', 'E'] },
    { id: '3', no: '300', to: '', stops: ['M2', 'E'] },
    { id: '4', no: '400', to: '', stops: ['A', 'M', 'E'] }, // 직행
  ];
  const r = findTrips({ lat: 33.5, lng: 126.5 }, { lat: 33.536, lng: 126.5 }, indexData(st2, routes));
  assert.deepEqual(r[0].legs.map((l) => l.routeIds), [['4']]);
  const transfers = r.filter((t) => t.legs.length === 2).map((t) => t.legs.map((l) => l.routeIds.join('/') + '@' + l.fromId));
  assert.deepEqual(transfers, [['1/4@A', '2@M'], ['1/4@A', '3@M2']]); // A→M은 100·400 아무거나
  // 400번은 출발지에서 바로 타면 되므로 환승 2번째 버스로 쓰지 않는다
  assert.ok(!transfers.some((t) => t[1].startsWith('4')));
});

test('두 번 환승: 한 번으로 안 닿으면 세 노선을 잇는다', () => {
  const s = (id: string, lat: number) => ({ id, name: id, lat, lng: 126.5 });
  const st3 = [s('A', 33.5), s('P', 33.518), s('Q', 33.536), s('E', 33.554)];
  const routes = [
    { id: '1', no: '100', to: '', stops: ['A', 'P'] },
    { id: '2', no: '200', to: '', stops: ['P', 'Q'] },
    { id: '3', no: '300', to: '', stops: ['Q', 'E'] },
  ];
  const r = findTrips({ lat: 33.5, lng: 126.5 }, { lat: 33.554, lng: 126.5 }, indexData(st3, routes));
  assert.deepEqual(r.map((t) => t.legs.map((l) => `${l.nos[0]}@${l.fromId}`)), [['100@A', '200@P', '300@Q']]);
});
