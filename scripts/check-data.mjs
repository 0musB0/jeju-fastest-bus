// 데이터 갱신 워크플로의 커밋 전 검사: 건수가 너무 적거나 직전 커밋보다 크게 줄었으면 실패시켜 빈 데이터가 자동 커밋되지 않게 한다.
// 사용: node scripts/check-data.mjs   (data/*.json과 git HEAD의 같은 파일을 비교)
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// 최소 건수 (2026-11 실측: 정류장 4352, 노선 995, 표 438, 시간표 933, 모양 995, 걷는 길 점 399,750). 실측의 절반 안팎으로 잡았다.
export const MIN = { 'stations.json': 3000, 'routes.json': 700, 'schedules.json': 100, 'timetable.json': 500, 'shapes.json': 700, 'walk.json': 150000 };
export const KEEP = 0.8; // 직전 커밋 건수의 이 비율보다 줄면 실패 (노선 개편으로 조금 줄 수는 있다)

export const count = (name, v) => (name === 'walk.json' ? v?.lat?.length ?? 0 : Array.isArray(v) ? v.length : Object.keys(v ?? {}).length);

// 순수 함수: { 파일: 건수 } 두 벌(지금, 직전)을 비교해 문제 목록을 돌려준다
export function problems(now, before, min = MIN, keep = KEEP) {
  const out = [];
  for (const [name, n] of Object.entries(now)) {
    if (n < (min[name] ?? 0)) out.push(`${name}: ${n}건 (최소 ${min[name]})`);
    const b = before[name];
    if (b && n < b * keep) out.push(`${name}: ${n}건, 직전 ${b}건보다 ${Math.round((1 - n / b) * 100)}% 줄어듦`);
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const now = {}, before = {};
  for (const name of Object.keys(MIN)) {
    try { now[name] = count(name, JSON.parse(await readFile(`data/${name}`, 'utf8'))); } catch (e) { now[name] = 0; console.error(`${name}: 읽기 실패 (${e.message})`); }
    try { before[name] = count(name, JSON.parse(execFileSync('git', ['show', `HEAD:data/${name}`], { maxBuffer: 64 << 20 }).toString())); } catch { /* 직전 커밋에 없으면 비교 생략 */ }
  }
  console.log('건수', now, '직전', before);
  const bad = problems(now, before);
  if (bad.length) { console.error(`데이터 이상, 커밋하지 않음:\n- ${bad.join('\n- ')}`); process.exit(1); }
  console.log('데이터 건수 정상');
}
