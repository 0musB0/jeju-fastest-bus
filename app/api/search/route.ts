import { JEJU_RECT, KAKAO_TIMEOUT_MS, SEARCH_RATE_PER_MIN } from '../../../lib/config.ts';
import { inJeju } from '../../../lib/direct.ts';
import { guardRequest } from '../../../lib/guard.ts';

type Place = { name: string; address: string; lat: number; lng: number };
// 외부 응답 검증: 좌표가 숫자이고 제주 안인 장소만 (카카오가 빈 값·이상한 값을 주면 NaN이 경로 계산까지 번지므로 여기서 버린다)
const clean = (name: unknown, address: unknown, y: unknown, x: unknown): Place[] => {
  const lat = Number(y), lng = Number(x);
  return typeof name === 'string' && name && inJeju({ lat, lng })
    ? [{ name, address: typeof address === 'string' ? address : '', lat, lng }] : [];
};

// 장소 이름 → 좌표. 카카오 REST 키는 서버에만 있고, 검색 범위는 항상 제주로 제한한다.
export async function GET(req: Request) {
  const blocked = guardRequest(req, 'search', SEARCH_RATE_PER_MIN);
  if (blocked) return blocked;
  const q = new URL(req.url).searchParams.get('q')?.trim();
  if (!q || q.length > 50) return Response.json({ error: '검색어를 1~50자로 입력하세요' }, { status: 400 });
  const key = process.env.KAKAO_REST_KEY;
  if (!key) return Response.json({ error: '서버에 카카오 키가 없습니다' }, { status: 500 });

  const url = `https://dapi.kakao.com/v2/local/search/keyword.json?${new URLSearchParams({ query: q, rect: JEJU_RECT, size: '10' })}`;
  try {
    const res = await fetch(url, { headers: { Authorization: `KakaoAK ${key}` }, signal: AbortSignal.timeout(KAKAO_TIMEOUT_MS) });
    const body = await res.json();
    if (!res.ok || !Array.isArray(body?.documents)) {
      return Response.json({ error: '장소 검색 API 실패', status: res.status, reason: body?.message ?? body?.errorType }, { status: 502 });
    }
    let places = (body.documents as Record<string, unknown>[]).flatMap((d) => clean(d?.place_name, d?.road_address_name || d?.address_name, d?.y, d?.x));
    // 장소 이름으로 없으면 주소("하귀로15길 47")로 찾는다. 주소 검색은 범위 지정이 없어 제주 안만 남긴다(clean이 거름).
    if (!places.length) {
      const r = await fetch(`https://dapi.kakao.com/v2/local/search/address.json?${new URLSearchParams({ query: q, size: '10' })}`,
        { headers: { Authorization: `KakaoAK ${key}` }, signal: AbortSignal.timeout(KAKAO_TIMEOUT_MS) });
      const a = await r.json();
      if (r.ok && Array.isArray(a?.documents)) places = (a.documents as { address_name?: string; road_address?: { address_name?: string; building_name?: string }; x?: string; y?: string }[])
        .flatMap((d) => clean(d?.road_address?.building_name || d?.road_address?.address_name || d?.address_name, d?.road_address?.address_name || d?.address_name, d?.y, d?.x));
    }
    return Response.json({ places });
  } catch {
    return Response.json({ error: '장소 검색 API 응답 없음' }, { status: 504 });
  }
}
