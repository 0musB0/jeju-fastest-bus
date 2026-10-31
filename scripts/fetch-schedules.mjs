// 제주 버스정보시스템(bus.jeju.go.kr)의 노선별 시간표를 받아 data/schedules.json(원본 표)으로 저장한다.
// robots.txt·이용약관 없음 확인(2026-10-31), 사용자 승인. 사이트가 미국(GitHub 러너)에서 막혀서 서울에서 도는 앱의 /api/schedule을 거친다.
// 표 → 노선(BIS ID)별 시간표 변환은 scripts/build-timetable.mjs가 한다.
import { readFile, writeFile } from 'node:fs/promises';

const APP = 'https://jeju-fastest-bus.vercel.app';
const routes = JSON.parse(await readFile('data/routes.json', 'utf8'));
const bases = [...new Set(routes.map((r) => r.no.split('-')[0]))];
const tabs = [];
let failed = 0;
for (const base of bases) {
  for (let i = 1; i <= 3; i++) {
    try {
      const res = await fetch(`${APP}/api/schedule?base=${encodeURIComponent(base)}`, { signal: AbortSignal.timeout(70000) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      tabs.push(...body.tabs);
      break;
    } catch (e) {
      if (i === 3) failed++, console.warn(`${base}: ${e.message}`);
      else await new Promise((r) => setTimeout(r, 3000 * i));
    }
  }
}
if (failed > bases.length * 0.2 || tabs.length < 100) throw new Error(`실패 ${failed}/${bases.length}, 표 ${tabs.length}개 — 저장하지 않음`);
await writeFile('data/schedules.json', JSON.stringify(tabs));
console.log(`노선 묶음 ${bases.length} (실패 ${failed}), 시간표 ${tabs.length}개`);
