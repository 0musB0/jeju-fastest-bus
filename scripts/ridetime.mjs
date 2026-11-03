// 탑승 시간 실측: 배포된 앱의 /api/plan으로 노선 끝 정류장까지 "남은 정류장 수"를 30초마다 받아 버스 한 대 한 대를 따라가고,
// 실제로 정류장 사이를 달린 시간을 시간표(data/timetable.json)의 같은 구간 소요와 비교한다. 결과 = 시간대별 "실제 ÷ 시간표" 배율.
// 270번 제주대→상귀동카름이 시간표 54분인데 퇴근길(월 18시)에 약 75분 걸림(2026-11-02, 사용자 실측) → 출퇴근 배율을 재려고 만듦.
// GitHub Actions에서 돌린다 (accuracy.yml, script=ridetime). 직접: node --experimental-strip-types scripts/ridetime.mjs [분]
import { readFile, appendFile } from 'node:fs/promises';
import { offsetAt } from '../lib/timetable.ts';

const MINUTES = Number(process.argv[2] ?? 60);
const POLL_S = 30;
const APP = 'https://jeju-fastest-bus.vercel.app';
const NOS = ['270-2', '270-1', '360', '365', '315', '202', '281', '325', '331', '600']; // 270 + 제주시 간선 + 시외·공항
const MIN_SPAN = 8; // 이보다 짧게 따라간 버스는 빼기 (30초 간격이라 짧은 구간은 오차가 큼)

const routes = JSON.parse(await readFile('data/routes.json', 'utf8'));
const tables = JSON.parse(await readFile('data/timetable.json', 'utf8'));
const targets = NOS.map((no) => routes.find((r) => (r.no === no || r.no.startsWith(`${no}-`)) && tables[r.id])).filter(Boolean)
  .map((r) => ({ no: r.no, id: r.id, n: r.stops.length, key: `${r.id}:${r.stops.at(-1)}`, p: tables[r.id].p }));
console.log('추적:', targets.map((t) => t.no).join(', '));

const kstHour = () => Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
const reasons = {};
const fail = (why) => ((reasons[why] = (reasons[why] ?? 0) + 1), null);

// 버스 맞추기: 30초 사이 버스는 0~4정류장 나아가고 서로 앞지르지 않는다고 봄 (단순화)
// buses = [{ ord, t0, o0, h }]: 지금 순번, 처음 본 시각·순번·시간
const live = Object.fromEntries(targets.map((t) => [t.key, []]));
const done = []; // { no, h, actual, sched }
function close(tg, b) {
  if (b.ord - b.o0 >= MIN_SPAN && b.t1 > b.t0) done.push({ no: tg.no, h: b.h, actual: b.t1 - b.t0, sched: offsetAt(tg.p, b.ord) - offsetAt(tg.p, b.o0) });
}
function track(tg, away, t) {
  const ords = away.map((a) => tg.n - 1 - a).sort((x, y) => y - x); // 앞선 버스부터
  const prev = live[tg.key], next = [];
  let j = 0;
  for (const o of ords) {
    while (j < prev.length && prev[j].ord > o) close(tg, prev[j++]); // 앞 버스가 사라짐(종점 도착)
    const b = prev[j];
    if (b && o - b.ord <= 4) {
      next.push(o > b.ord ? { ...b, ord: o, t1: t } : b); // 순번이 바뀐 순간만 기록
      j++;
    } else next.push({ ord: o, o0: o, t0: t, t1: t, h: kstHour() });
  }
  while (j < prev.length) close(tg, prev[j++]);
  live[tg.key] = next;
}

const start = Date.now();
let polls = 0;
while (Date.now() - start < MINUTES * 60_000) {
  polls++;
  try {
    const res = await fetch(`${APP}/api/plan?q=${targets.map((t) => t.key).join(',')}`, { signal: AbortSignal.timeout(20000) });
    const results = res.ok ? (await res.json()).results : fail(`HTTP ${res.status}`);
    const t = (Date.now() - start) / 60_000;
    for (const tg of targets) {
      const v = results?.[tg.key];
      if (Array.isArray(v)) track(tg, v, t);
      else if (v) fail(v.error);
    }
  } catch (e) {
    fail(`${e.name}: ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, POLL_S * 1000));
}
for (const tg of targets) for (const b of live[tg.key]) close(tg, b);

const sum = (a, f) => a.reduce((s, x) => s + f(x), 0);
const row = (label, xs) => `| ${label} | ${xs.length} | ${sum(xs, (x) => x.actual).toFixed(0)} | ${sum(xs, (x) => x.sched).toFixed(0)} | **${(sum(xs, (x) => x.actual) / (sum(xs, (x) => x.sched) || 1)).toFixed(2)}** |`;
const hours = [...new Set(done.map((d) => d.h))].sort((a, b) => a - b);
const report = `## 탑승 시간 실측 (${MINUTES}분, ${POLL_S}초 간격, 조회 ${polls}회)

| 구분 | 버스 | 실제(분) | 시간표(분) | 배율 |
| --- | --- | --- | --- | --- |
${hours.map((h) => row(`${h}시(KST)`, done.filter((d) => d.h === h))).join('\n')}
${targets.map((tg) => row(tg.no, done.filter((d) => d.no === tg.no))).join('\n')}
${row('전체', done)}
${Object.entries(reasons).map(([k, v]) => `\n- 실패 ${v}건: ${k}`).join('')}

<details><summary>버스별</summary>

${done.map((d) => `${d.no} ${d.h}시 실제 ${d.actual.toFixed(1)} / 시간표 ${d.sched.toFixed(1)}`).join('\n\n')}
</details>
`;
console.log(report);
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, report);
