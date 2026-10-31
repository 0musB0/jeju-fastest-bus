import routeList from '@/data/routes.json';
import type { BusRoute } from '@/lib/direct';

// 시간표 원본 받기: bus.jeju.go.kr은 미국(GitHub 러너)에서 접속이 막혀서(2026-10-31 실측) 서울(icn1)에서 대신 받는다.
// scripts/fetch-schedules.mjs가 노선 묶음마다 부른다. 노선 JSON에 있는 묶음 번호만 받고 고정 주소만 부르므로 프록시가 되지 않는다.
// 같은 주소는 하루 동안 캐시해서 여러 번 불려도 제주 서버에는 한 번만 간다.
export const maxDuration = 60;
const BASE = 'https://bus.jeju.go.kr';
const bases = new Set((routeList as BusRoute[]).map((r) => r.no.split('-')[0]));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function get(path: string) {
  const res = await fetch(BASE + path, { signal: AbortSignal.timeout(10000), next: { revalidate: 86400 } });
  await sleep(200); // 제주 서버 부담 줄이기
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

type Cell = { ROW_SEQ: number; COLUMN_SEQ: number; COLUMN_NM?: string };

export async function GET(req: Request) {
  const base = new URL(req.url).searchParams.get('base') ?? '';
  if (!bases.has(base)) return Response.json({ error: '모르는 노선 묶음' }, { status: 400 });
  try {
    const html = await get(`/schedule/view/${encodeURIComponent(base)}`);
    const ids = [...new Set([...(html ?? '').matchAll(/id="tab(\d+)"/g)].map((m) => m[1]))];
    const tabs = [];
    for (const id of ids) {
      const info = JSON.parse((await get(`/data/schedule/getScheduleInfo?scheduleId=${id}`)) ?? 'null');
      const cells: Cell[] = JSON.parse((await get(`/data/schedule/getScheduleTableInfo?scheduleId=${id}`)) ?? '[]');
      if (!info || !Array.isArray(cells) || !cells.length) continue;
      // 셀 목록 → 표 (0행은 머리글: 1열 "노선번호", 그다음 주요 정류장 이름들)
      const grid: string[][] = [];
      for (const c of cells) (grid[c.ROW_SEQ] ??= [])[c.COLUMN_SEQ] = (c.COLUMN_NM ?? '').trim();
      tabs.push({
        id: Number(id),
        base,
        way: String(info.SCHEDULE_WAYPOINT ?? ''),
        date: String(info.ENFORCEMENT_NM ?? '').match(/\d{4}\.\d{1,2}\.\d{1,2}/)?.[0] ?? '',
        cols: (grid[0] ?? []).slice(1),
        rows: grid.slice(1).filter(Boolean).map((r) => r.slice(1)),
      });
    }
    return Response.json({ tabs });
  } catch (e) {
    return Response.json({ error: `시간표 서버 오류: ${(e as Error).message}` }, { status: 502 });
  }
}
