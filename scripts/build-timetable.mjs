// data/schedules.json(사이트 시간표 원본) → data/timetable.json(BIS 노선 ID별 시간표).
// 실행: node --experimental-strip-types scripts/build-timetable.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { buildEntry, parseTime, sameStop, tripsFor } from '../lib/timetable.ts';
import { distM } from '../lib/direct.ts';

const read = async (f) => JSON.parse(await readFile(f, 'utf8'));
const [tabs, routes, stations] = await Promise.all(['data/schedules.json', 'data/routes.json', 'data/stations.json'].map(read));
const nameOf = new Map(stations.map((s) => [s.id, s.name]));
const byId = new Map(stations.map((s) => [s.id, s]));

// 같은 방향 표가 시행일만 다르게 여러 개 있으면 가장 최근 것만 쓴다
const day = (d) => (d ? new Date(d.replaceAll('.', '-')).getTime() : 0);
const latest = new Map();
for (const t of tabs) {
  const k = `${t.base}|${t.way}`;
  const o = latest.get(k);
  if (!o || day(t.date) > day(o.date) || (day(t.date) === day(o.date) && t.id > o.id)) latest.set(k, t);
}
const byBase = Map.groupBy([...latest.values()], (t) => t.base);
// 머리글이 빠지고 첫 행이 머리글 자리에 들어간 표(785 토·공휴일 등): 같은 번호에서 출발지가 같고 열 수가 같은 표의 머리글을 빌린다
const isTime = (c) => /^\d{1,2}:\d{2}/.test(c);
for (const ts of byBase.values()) for (const t of ts) {
  if (t.cols.filter(isTime).length < 2) continue;
  const start = t.way.replace(/<[^>]*>/g, '').split('→')[0].replace(/\s/g, '');
  const donor = ts.find((o) => o !== t && o.cols.length === t.cols.length && !o.cols.some(isTime) && o.cols[0].replace(/\s/g, '') === start);
  if (donor) (t.rows = [t.cols, ...t.rows]), (t.cols = donor.cols);
}

const out = {};
for (const r of routes) {
  const stops = r.stops.map((id) => nameOf.get(id) ?? '');
  const cum = r.stops.map((id, k) => { const a = byId.get(r.stops[k - 1]), b = byId.get(id); return a && b ? distM(a, b) : 0; });
  cum.forEach((d, k) => k && (cum[k] += cum[k - 1]));
  // 표의 종점(마지막 정류장 열)이 이 노선의 끝 정류장과 맞는 표가 있으면 그 표만 쓴다.
  // 같은 번호의 다른 방면 표가 앞부분 정류장만 맞아서 붙는 걸 막는다 (320-71 제주대행에 수산↔삼화 25회가 붙던 문제)
  const allTabs = byBase.get(r.no.split('-')[0]) ?? [];
  // 행마다 마지막 시각 열을 본다: 356번 표는 끝 열이 영주고지만 대부분 행은 제주대에서 끝난다
  const endsHere = (t, row) => { const j = row.findLastIndex((v, k) => parseTime(v ?? '') !== null && !/노선번호|구분|비\s*고/.test(t.cols[k])); return j >= 0 && stops.slice(-2).some((s) => sameStop(t.cols[j], s)); };
  const own = allTabs.filter((t) => t.rows.some((row) => endsHere(t, row)));
  // 표의 노선번호로 거른 행 먼저. BIS 번호가 표와 다르면(BIS "800-51" = 표 "801번") 번호 없이 이름 순서로만 맞춘다
  const build = (tabsOf) => buildEntry(tabsOf.flatMap((t) => tripsFor(t, stops, r.no)), cum) ?? buildEntry(tabsOf.flatMap((t) => tripsFor(t, stops)), cum);
  const e = (own.length && build(own)) || build(allTabs);
  if (e) out[r.id] = { ...e, n: r.stops.length }; // n = 만들 때 정류장 수. 노선만 갱신되고 시간표 갱신이 실패하면 서버가 이 값으로 걸러낸다
}
await writeFile('data/timetable.json', JSON.stringify(out));
console.log(`시간표 ${tabs.length}개(최신 ${latest.size}) → 노선 ${Object.keys(out).length}/${routes.length}개`);
