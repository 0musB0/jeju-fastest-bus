import { API_MAX_QUERY } from './config.ts';
// API 보호: Origin 검증, 쿼리 길이 상한, IP별 분당 요청 상한. 외부 호출 없음.

// 브라우저가 보내는 Sec-Fetch-Site / Origin으로 다른 사이트 페이지에서 부르는 요청을 거른다.
// 같은 출처 GET은 Origin이 없을 수 있고, 둘 다 없으면(curl 등) 헤더를 꾸밀 수 있어 여기서 막을 수 없다 → 레이트리밋이 맡는다.
export function originOk(h: Headers): boolean {
  const site = h.get('sec-fetch-site');
  if (site) return site === 'same-origin' || site === 'none';
  const origin = h.get('origin');
  if (!origin) return true;
  try { return new URL(origin).host === (h.get('x-forwarded-host') ?? h.get('host')); } catch { return false; }
}

// 단순화: 함수 인스턴스 메모리라 인스턴스마다 따로 센다(Vercel이 인스턴스를 여럿 띄우면 상한이 그만큼 느슨해짐). 공유 저장소(KV)가 필요하면 그때 교체.
const hits = new Map<string, number[]>();
export function rateLimited(key: string, limit: number, now = Date.now(), windowMs = 60000): boolean {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  const over = recent.length >= limit;
  if (!over) recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k); // 오래된 IP 정리
  return over;
}

export const clientIp = (h: Headers) => (h.get('x-vercel-forwarded-for') ?? h.get('x-forwarded-for') ?? 'unknown').split(',')[0].trim();

// 통과하면 null, 막으면 돌려줄 응답
export function guardRequest(req: Request, name: string, limit: number): Response | null {
  if (!originOk(req.headers)) return Response.json({ error: '허용되지 않은 요청이에요' }, { status: 403 });
  if (new URL(req.url).search.length > API_MAX_QUERY) return Response.json({ error: '요청이 너무 길어요' }, { status: 414 });
  if (rateLimited(`${name}:${clientIp(req.headers)}`, limit)) return Response.json({ error: '요청이 너무 많아요. 잠시 뒤 다시 시도해 주세요' }, { status: 429, headers: { 'Retry-After': '60' } });
  return null;
}
