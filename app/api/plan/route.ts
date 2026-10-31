import { revalidateTag } from 'next/cache';
import { parseBusLocation, stopsAway } from '@/lib/realtime';

// 실시간: 노선별 버스 위치 → 우리 정류장까지 남은 정류장 수.
// 제주 BIS ID(숫자 9자리)만 받고, 고정된 BusLocation 주소만 부르므로 아무 데나 부르는 프록시가 되지 않는다.
// 단순화: 정류장 JSON 대신 "그 노선의 정류장 목록에 있는지"로 정류장을 검증함, 정류장 JSON이 생기면 그것도 확인
const ID = /^\d{9}$/;
const MAX_ROUTES = 10;

export async function GET(req: Request) {
  const pairs = (new URL(req.url).searchParams.get('q') ?? '')
    .split(',')
    .map((p) => p.split(':'))
    .filter(([r, s]) => ID.test(r) && ID.test(s));
  const routes = [...new Set(pairs.map(([r]) => r))];
  if (!routes.length || routes.length > MAX_ROUTES) return Response.json({ error: `노선은 1~${MAX_ROUTES}개` }, { status: 400 });

  const locs = new Map(await Promise.all(routes.map(async (r) => {
    try {
      const res = await fetch(`http://busopen.jeju.go.kr/OpenAPI/service/bis/BusLocation?route=${r}`, {
        signal: AbortSignal.timeout(3000),
        next: { revalidate: 20, tags: [`loc-${r}`] }, // 인스턴스 간 공유 캐시
      });
      const parsed = parseBusLocation(await res.text());
      if (!parsed.ok) revalidateTag(`loc-${r}`, { expire: 0 }); // 오류 응답은 캐시에 남기지 않는다
      return [r, parsed] as const;
    } catch {
      return [r, { ok: false, reason: '실시간 API 응답 없음' }] as const;
    }
  })));

  const results: Record<string, number[] | { error: string }> = {};
  for (const [r, s] of pairs) {
    const loc = locs.get(r)!;
    const away = loc.ok ? stopsAway(loc.stops, s) : null;
    results[`${r}:${s}`] = !loc.ok ? { error: loc.reason } : away ?? { error: '이 노선에 없는 정류장' };
  }
  return Response.json({ results });
}
