// data/schedules.json(사이트 시간표 원본) → data/timetable.json(BIS 노선 ID별 시간표).
// 실행: node --experimental-strip-types scripts/build-timetable.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { buildEntry, tripsFor } from '../lib/timetable.ts';

const read = async (f) => JSON.parse(await readFile(f, 'utf8'));
const [tabs, routes, stations] = await Promise.all(['data/schedules.json', 'data/routes.json', 'data/stations.json'].map(read));
const nameOf = new Map(stations.map((s) => [s.id, s.name]));

// 같은 방향 표가 시행일만 다르게 여러 개 있으면 가장 최근 것만 쓴다
const day = (d) => (d ? new Date(d.replaceAll('.', '-')).getTime() : 0);
const latest = new Map();
for (const t of tabs) {
  const k = `${t.base}|${t.way}`;
  const o = latest.get(k);
  if (!o || day(t.date) > day(o.date) || (day(t.date) === day(o.date) && t.id > o.id)) latest.set(k, t);
}
const byBase = Map.groupBy([...latest.values()], (t) => t.base);

const out = {};
for (const r of routes) {
  const stops = r.stops.map((id) => nameOf.get(id) ?? '');
  const tabsOf = byBase.get(r.no.split('-')[0]) ?? [];
  // 표의 노선번호로 거른 행 먼저. BIS 번호가 표와 다르면(BIS "800-51" = 표 "801번") 번호 없이 이름 순서로만 맞춘다
  const e = buildEntry(tabsOf.flatMap((t) => tripsFor(t, stops, r.no))) ?? buildEntry(tabsOf.flatMap((t) => tripsFor(t, stops)));
  if (e) out[r.id] = e;
}
await writeFile('data/timetable.json', JSON.stringify(out));
console.log(`시간표 ${tabs.length}개(최신 ${latest.size}) → 노선 ${Object.keys(out).length}/${routes.length}개`);
