import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFavs, parsePinned, parseTrip } from './storage.ts';

const place = { name: '제주공항', lat: 33.51, lng: 126.49 };
const followed = { candidate: { legs: [{ walkBeforeMin: 2, rideMin: 10 }], walkAfterMin: 3 }, rides: [{ busNos: ['201'], routeIds: ['405320112'], stationId: '1', from: 'A', to: 'B', stops: 5 }], fare: 1150, odsayMin: 15, eta: { min: 20, source: 'realtime', boards: [{ at: 5, atStop: 2, how: 'realtime' }] } };
const pinned = (over: object = {}) => JSON.stringify({ from: place, to: { ...place, name: '성산' }, r: followed, t: 1_000_000, held: false, k: 1, ...over });

test('즐겨찾기: 깨진 JSON·배열 아님은 빈 목록, 깨진 항목만 버림', () => {
  assert.deepEqual(parseFavs(null), []);
  assert.deepEqual(parseFavs('{깨짐'), []);
  assert.deepEqual(parseFavs('{"a":1}'), []);
  assert.deepEqual(parseFavs(JSON.stringify([place, { name: 'x', lat: 'a', lng: 1 }, { name: 'y', lat: NaN, lng: 1 }, null, 7, { name: 'z', lat: 999, lng: 1 }])), [place]);
});

test('탭 저장: 현재 위치 출발은 되살리지 않고, 깨진 값은 null', () => {
  assert.equal(parseTrip('이상한'), null);
  assert.equal(parseTrip('[]'), null);
  assert.deepEqual(parseTrip(JSON.stringify({ from: { ...place, name: '현재 위치' }, to: place })), { from: null, to: place });
  assert.deepEqual(parseTrip(JSON.stringify({ from: 'x', to: place })), { from: null, to: place });
});

test('따라가기: 정상은 통과, 모양이 깨졌거나 만료됐으면 null', () => {
  assert.ok(parsePinned(pinned(), 1_000_000 + 60_000));
  assert.equal(parsePinned(pinned(), 1_000_000 + 51 * 60_000), null); // 도착(20분) + 30분 지남
  assert.equal(parsePinned(null, 0), null);
  assert.equal(parsePinned('{', 0), null);
  assert.equal(parsePinned(pinned({ t: 'x' }), 0), null);
  assert.equal(parsePinned(pinned({ from: null }), 0), null);
  assert.equal(parsePinned(pinned({ r: { ...followed, rides: [] } }), 0), null);
  assert.equal(parsePinned(pinned({ r: { ...followed, eta: { ...followed.eta, min: null } } }), 0), null);
  assert.equal(parsePinned(pinned({ r: { ...followed, candidate: { legs: [{ walkBeforeMin: 'a', rideMin: 1 }], walkAfterMin: 0 } } }), 0), null);
  assert.equal(parsePinned(pinned({ r: { ...followed, rides: [{ ...followed.rides[0], routeIds: 'x' }] } }), 0), null);
});
