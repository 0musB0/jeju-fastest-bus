// 4단계 정확도 확인: 실제 버스를 타는 대신, 배포된 앱의 /api/plan으로 정류장마다 "남은 정류장 수"를 일정 시간 추적해서
// 예측한 대기(남은 정류장 × 정류장당 소요)와 실제로 버스가 그 정류장에 닿은 시각을 비교한다.
// busopen은 GitHub(미국) 러너에서 시간 초과가 나서(2026-10-31 실측) 서울(icn1)에서 도는 앱을 거친다.
// GitHub Actions에서 돌린다 (.github/workflows/accuracy.yml). 직접: node scripts/accuracy.mjs [분]
import { readFile, appendFile } from 'node:fs/promises';

const MINUTES = Number(process.argv[2] ?? 60);
const POLL_S = 30;
const APP = 'https://jeju-fastest-bus.vercel.app';
const MIN_PER_STOP = 2; // lib/config.ts와 같은 값
const PREFIXES = ['360', '365', '315', '202', '281']; // 제주시 간선 3개 + 시외 2개
const MAX_STOPS_AHEAD = 15; // 이보다 먼 버스는 예측에 쓰지 않음 (앱도 가까운 버스를 씀)

const routes = JSON.parse(await readFile('data/routes.json', 'utf8'));
// 노선마다 정류장 2곳(40%, 70% 지점)을 지켜본다. 회차 정류장(같은 ID가 두 번)은 피한다.
const targets = PREFIXES.map((p) => routes.find((r) => r.no === p || r.no.startsWith(`${p}-`)))
  .filter(Boolean)
  .flatMap((r) => [0.4, 0.7].map((f) => ({ no: r.no, key: `${r.id}:${r.stops[Math.floor(r.stops.length * f)]}` })))
  .filter((t, _, all) => routes.find((r) => r.id === t.key.split(':')[0]).stops.filter((s) => s === t.key.split(':')[1]).length === 1);
console.log('추적:', targets.map((t) => `${t.no}(${t.key})`).join(', '));

const reasons = {}; // 실패 이유 → 횟수
const fail = (why) => ((reasons[why] = (reasons[why] ?? 0) + 1), null);
async function poll() {
  try {
    const res = await fetch(`${APP}/api/plan?q=${targets.map((t) => t.key).join(',')}`, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return fail(`HTTP ${res.status}`);
    return (await res.json()).results;
  } catch (e) {
    return fail(`${e.name}: ${e.message}`);
  }
}

// 기록: 정류장 → [{ t(분), away: 남은 정류장 수 배열 }]
const log = Object.fromEntries(targets.map((t) => [t.key, []]));
const start = Date.now();
let polls = 0;
while (Date.now() - start < MINUTES * 60_000) {
  polls++;
  const results = await poll();
  const t = (Date.now() - start) / 60_000;
  for (const k of Object.keys(log)) {
    const v = results?.[k];
    if (Array.isArray(v)) log[k].push({ t, away: v });
    else if (v) fail(v.error);
  }
  await new Promise((res) => setTimeout(res, POLL_S * 1000));
}

// 가장 가까운 버스가 a정류장 남았을 때 예측 a×2분, 실제 = 그 뒤 처음으로 가장 가까운 버스가 0정류장(도착)이 된 시각까지.
const errors = [], pairs = [], lines = [];
for (const tg of targets) {
  const snaps = log[tg.key];
  let n = 0;
  snaps.forEach((s, i) => {
    const a = s.away[0];
    if (a === undefined || a < 1 || a > MAX_STOPS_AHEAD) return;
    const hit = snaps.slice(i + 1).find((x) => x.away[0] === 0);
    // 0을 놓치고 지나간 경우(다음 버스가 가장 가까워짐)는 건너뛴다
    if (!hit || snaps.slice(i + 1, snaps.indexOf(hit)).some((x) => x.away[0] > a)) return;
    const actual = hit.t - s.t;
    errors.push(a * MIN_PER_STOP - actual);
    pairs.push([a, actual]);
    n++;
  });
  lines.push(`| ${tg.no} | ${tg.key} | ${snaps.length} | ${n} |`);
}

const mean = (a) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
const mae = mean(errors.map(Math.abs));
const bias = mean(errors);
const perStop = pairs.reduce((s, [, a]) => s + a, 0) / (pairs.reduce((s, [k]) => s + k, 0) || 1);
const within = (m) => Math.round((100 * errors.filter((e) => Math.abs(e) <= m).length) / (errors.length || 1));

const report = `## 정확도 확인 (${MINUTES}분 추적, ${POLL_S}초 간격)

| 노선 | 노선:정류장 | 조회 성공 | 비교 건수 |
| --- | --- | --- | --- |
${lines.join('\n')}

- 조회 ${polls}회${Object.entries(reasons).map(([k, v]) => `\n  - 실패 ${v}건: ${k}`).join('')}
- 비교 ${errors.length}건, 현재 값(정류장당 ${MIN_PER_STOP}분) 기준 평균 오차 **${mae.toFixed(1)}분**, 치우침 ${bias >= 0 ? '+' : ''}${bias.toFixed(1)}분 (+는 늦게 온다고 예측)
- 오차 2분 이내 ${within(2)}%, 5분 이내 ${within(5)}%
- 실측 정류장당 소요: **${perStop.toFixed(2)}분**
`;
console.log(report);
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, report);
