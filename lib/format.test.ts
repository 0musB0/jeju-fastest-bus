import { test } from 'node:test';
import assert from 'node:assert/strict';
import { busNumbers, clock12, dur, routeKey, splitStop } from './format.ts';
import { inJeju } from './direct.ts';

test('dur: 60분부터 시간 단위', () => {
  assert.equal(dur(5.4), '5분');
  assert.equal(dur(60), '1시간');
  assert.equal(dur(150), '2시간 30분');
});
test('clock12: 자정·정오·자정 넘김', () => {
  assert.equal(clock12(0), '12:00 AM');
  assert.equal(clock12(350), '5:50 AM');
  assert.equal(clock12(720), '12:00 PM');
  assert.equal(clock12(1440 + 65), '1:05 AM');
});
test('busNumbers: 괄호·가지 번호를 떼고 중복 제거', () => {
  assert.deepEqual(busNumbers(['300(신사동)', '365-21', '365-2', '791(하귀-유수암)']), ['300', '365', '791']);
});
test('splitStop: 괄호 힌트 분리', () => {
  assert.deepEqual(splitStop('하귀환승정류장(하귀하나로마트)'), ['하귀환승정류장', '하귀하나로마트']);
  assert.deepEqual(splitStop('제주대학교'), ['제주대학교', '']);
});
test('routeKey: 탈 정류장과 버스 번호 조합', () => {
  assert.equal(routeKey({ rides: [{ from: 'A', busNos: ['1', '2'] }, { from: 'B', busNos: ['3'] }] }), 'A:1/2|B:3');
});
test('inJeju: 경계 안, 밖, NaN', () => {
  assert.ok(inJeju({ lat: 33.5, lng: 126.5 }));
  assert.ok(!inJeju({ lat: 37.5, lng: 127.0 }));
  assert.ok(!inJeju({ lat: NaN, lng: 126.5 }));
  assert.ok(!inJeju({ lat: 33.3, lng: 127.5 }));
});
