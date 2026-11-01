// 제주 버스정보시스템(bus.jeju.go.kr)의 노선별 시간표를 받아 data/schedules.json(원본 표)으로 저장한다.
// robots.txt·이용약관 없음 확인(2026-10-31), 사용자 승인. 사이트가 중간 인증서를 보내지 않아서 워크플로가 NODE_EXTRA_CA_CERTS로 채워 준다. 서버 부담을 줄이려고 한 번에 하나씩, 요청 사이 0.3초 쉰다.
// 표 → 노선(BIS ID)별 시간표 변환은 scripts/build-timetable.mjs가 한다.
import { readFile, writeFile } from 'node:fs/promises';

const BASE = 'https://bus.jeju.go.kr';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(path, json) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(BASE + path, { signal: AbortSignal.timeout(15000) });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return json ? await res.json() : await res.text();
    } catch (e) {
      if (i >= 3) throw new Error(`${path}: ${e.message}`);
      await sleep(2000 * i);
    } finally {
      await sleep(300);
    }
  }
}

const routes = JSON.parse(await readFile('data/routes.json', 'utf8'));
const bases = [...new Set(routes.map((r) => r.no.split('-')[0]))];
const tabs = [];
let failed = 0;
for (const base of bases) {
  try {
    const html = await get(`/schedule/view/${encodeURIComponent(base)}`);
    const ids = [...new Set([...(html ?? '').matchAll(/id="tab(\d+)"/g)].map((m) => m[1]))];
    // 탭 이름("(평일)삼화지구-…-하귀"): 평일·휴일 표가 경유 문구(way)는 똑같고 이름에만 요일이 적혀 있다 (320번)
    const label = (id) => [...((html ?? '').match(new RegExp(`id="tab${id}"[\\s\\S]*?</td>`))?.[0] ?? '').matchAll(/<p[^>]*>([^<]*)<\/p>/g)].map((m) => m[1].trim()).join(' ');
    for (const id of ids) {
      const info = await get(`/data/schedule/getScheduleInfo?scheduleId=${id}`, true);
      const cells = await get(`/data/schedule/getScheduleTableInfo?scheduleId=${id}`, true);
      if (!info || !Array.isArray(cells) || !cells.length) continue;
      // 셀 목록 → 표 (0행은 머리글: 1열 "노선번호", 그다음 주요 정류장 이름들)
      const grid = [];
      for (const c of cells) (grid[c.ROW_SEQ] ??= [])[c.COLUMN_SEQ] = (c.COLUMN_NM ?? '').trim();
      tabs.push({
        id: Number(id),
        base,
        way: info.SCHEDULE_WAYPOINT ?? '',
        label: label(id),
        date: (info.ENFORCEMENT_NM ?? '').match(/\d{4}\.\d{1,2}\.\d{1,2}/)?.[0] ?? '',
        cols: grid[0].slice(1),
        rows: grid.slice(1).filter(Boolean).map((r) => r.slice(1)),
      });
    }
  } catch (e) {
    failed++;
    console.warn(e.message);
  }
}
if (failed > bases.length * 0.2 || tabs.length < 100) throw new Error(`실패 ${failed}/${bases.length}, 표 ${tabs.length}개 — 저장하지 않음`);
await writeFile('data/schedules.json', JSON.stringify(tabs));
console.log(`노선 묶음 ${bases.length} (실패 ${failed}), 시간표 ${tabs.length}개`);
