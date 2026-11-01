import { JEJU_RECT } from '@/lib/config';

// 장소 이름 → 좌표. 카카오 REST 키는 서버에만 있고, 검색 범위는 항상 제주로 제한한다.
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get('q')?.trim();
  if (!q || q.length > 50) return Response.json({ error: '검색어를 1~50자로 입력하세요' }, { status: 400 });
  const key = process.env.KAKAO_REST_KEY;
  if (!key) return Response.json({ error: '서버에 카카오 키가 없습니다' }, { status: 500 });

  const url = `https://dapi.kakao.com/v2/local/search/keyword.json?${new URLSearchParams({ query: q, rect: JEJU_RECT, size: '10' })}`;
  try {
    const res = await fetch(url, { headers: { Authorization: `KakaoAK ${key}` }, signal: AbortSignal.timeout(3000) });
    const body = await res.json();
    if (!res.ok || !Array.isArray(body.documents)) {
      return Response.json({ error: '장소 검색 API 실패', status: res.status, reason: body.message ?? body.errorType }, { status: 502 });
    }
    let places = body.documents.map((d: Record<string, string>) => ({
      name: d.place_name,
      address: d.road_address_name || d.address_name,
      lat: Number(d.y),
      lng: Number(d.x),
    }));
    // 장소 이름으로 없으면 주소("하귀로15길 47")로 찾는다. 주소 검색은 범위 지정이 없어 제주 안만 남긴다.
    if (!places.length) {
      const r = await fetch(`https://dapi.kakao.com/v2/local/search/address.json?${new URLSearchParams({ query: q, size: '10' })}`,
        { headers: { Authorization: `KakaoAK ${key}` }, signal: AbortSignal.timeout(3000) });
      const a = await r.json();
      const [x1, y1, x2, y2] = JEJU_RECT.split(',').map(Number);
      if (r.ok && Array.isArray(a.documents)) places = a.documents
        .map((d: { address_name: string; road_address?: { address_name: string; building_name?: string }; x: string; y: string }) => ({
          name: d.road_address?.building_name || d.road_address?.address_name || d.address_name,
          address: d.road_address?.address_name || d.address_name,
          lat: Number(d.y),
          lng: Number(d.x),
        }))
        .filter((p: { lat: number; lng: number }) => p.lng >= x1 && p.lng <= x2 && p.lat >= y1 && p.lat <= y2);
    }
    return Response.json({ places });
  } catch {
    return Response.json({ error: '장소 검색 API 응답 없음' }, { status: 504 });
  }
}
