// 4단계 정확도 확인: 실제 버스를 타는 대신 버스 위치를 일정 시간 추적해서
// "남은 정류장 수 × 정류장당 소요"로 예측한 대기와 실제로 그 정류장에 닿은 시각을 비교한다.
// GitHub Actions에서 돌린다 (.github/workflows/accuracy.yml). 직접: node scripts/accuracy.mjs [분]
import { readFile, appendFile } from 'node:fs/promises';

const MINUTES = Number(process.argv[2] ?? 60);
const POLL_S = 30;
const MIN_PER_STOP = 2; // lib/config.ts와 같은 값
const PREFIXES = ['360', '365', '315', '202', '281']; // 제주시 간선 3개 + 시외 2개
const MAX_STOPS_AHEAD = 15; // 이보다 먼 버스는 예측에 쓰지 않음 (앱도 가까운 버스를 씀)

const routes = JSON.parse(await readFile('data/routes.json', 'utf8'));
const picked = PREFIXES.map((p) => routes.find((r) => r.no === p || r.no.startsWith(`${p}-`))).filter(Boolean);
console.log('추적 노선:', picked.map((r) => r.no).join(', '));

const field = (xml, n) => xml.match(new RegExp(`<${n}>([^<]*)</${n}>`))?.[1];
const reasons = {}; // 실패 이유 → 횟수
const fail = (why) => ((reasons[why] = (reasons[why] ?? 0) + 1), null);
async function positions(routeId) {
  try {
    const res = await fetch(`http://busopen.jeju.go.kr/OpenAPI/service/bis/BusLocation?route=${routeId}`, { signal: AbortSignal.timeout(10000) });
    const xml = await res.text();
    const code = field(xml, 'resultCode');
    if (code !== '00') return fail(`HTTP ${res.status}, resultCode ${code ?? '없음'}: ${xml.slice(0, 120).replace(/\s+/g, ' ')}`);
    return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)]
      .map(([, it]) => ({ plate: field(it, 'plateNo'), ord: Number(field(it, 'stationOrd')) }))
      .filter((b) => b.plate && b.plate !== 'null');
  } catch (e) {
    return fail(`${e.name}: ${e.message}`);
  }
}

// 기록: 노선 → [{ t(분), buses }]
const log = Object.fromEntries(picked.map((r) => [r.id, []]));
const start = Date.now();
let failures = 0, polls = 0;
while (Date.now() - start < MINUTES * 60_000) {
  for (const r of picked) {
    polls++;
    const buses = await positions(r.id);
    if (buses) log[r.id].push({ t: (Date.now() - start) / 60_000, buses });
    else failures++;
  }
  await new Promise((res) => setTimeout(res, POLL_S * 1000));
}

// 버스마다 각 정류장 순번에 처음 나타난 시각
const errors = [], pairs = [];
let lines = [];
for (const r of picked) {
  const snaps = log[r.id];
  const firstAt = new Map(); // `${plate}:${ord}` → t
  for (const s of snaps) for (const b of s.buses) if (!firstAt.has(`${b.plate}:${b.ord}`)) firstAt.set(`${b.plate}:${b.ord}`, s.t);
  // 버스가 정류장 target에 닿은 시각: target 이상 순번에서 처음 보인 시각
  const reached = (plate, target) => {
    let best = Infinity;
    for (const [k, t] of firstAt) {
      const [p, o] = k.split(':');
      if (p === plate && Number(o) >= target && Number(o) <= target + 2 && t < best) best = t;
    }
    return best;
  };
  let n = 0;
  for (const s of snaps) {
    for (const b of s.buses) {
      for (let ahead = 3; ahead <= MAX_STOPS_AHEAD; ahead += 3) {
        const t2 = reached(b.plate, b.ord + ahead);
        if (!Number.isFinite(t2) || t2 <= s.t) continue;
        const actual = t2 - s.t;
        if (actual > 90) continue; // 회차 대기 등 이상값
        errors.push(ahead * MIN_PER_STOP - actual);
        pairs.push([ahead, actual]);
        n++;
      }
    }
  }
  lines.push(`| ${r.no} | ${snaps.length} | ${new Set(snaps.flatMap((s) => s.buses.map((b) => b.plate))).size} | ${n} |`);
}

const mean = (a) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
const mae = mean(errors.map(Math.abs));
const bias = mean(errors);
const perStop = pairs.reduce((s, [k, a]) => s + a, 0) / (pairs.reduce((s, [k]) => s + k, 0) || 1);
const within = (m) => Math.round((100 * errors.filter((e) => Math.abs(e) <= m).length) / (errors.length || 1));

const report = `## 정확도 확인 (${MINUTES}분 추적, ${POLL_S}초 간격)

| 노선 | 조회 성공 | 버스 수 | 비교 건수 |
| --- | --- | --- | --- |
${lines.join('\n')}

- 조회 실패: ${failures}/${polls}${Object.entries(reasons).map(([k, v]) => `\n  - ${v}회: ${k}`).join('')}
- 비교 ${errors.length}건, 현재 값(정류장당 ${MIN_PER_STOP}분) 기준 평균 오차 **${mae.toFixed(1)}분**, 치우침 ${bias >= 0 ? '+' : ''}${bias.toFixed(1)}분 (+는 늦게 온다고 예측)
- 오차 2분 이내 ${within(2)}%, 5분 이내 ${within(5)}%
- 실측 정류장당 소요: **${perStop.toFixed(2)}분**
`;
console.log(report);
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, report);
