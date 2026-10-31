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
    const places = body.documents.map((d: Record<string, string>) => ({
      name: d.place_name,
      address: d.road_address_name || d.address_name,
      lat: Number(d.y),
      lng: Number(d.x),
    }));
    return Response.json({ places });
  } catch {
    return Response.json({ error: '장소 검색 API 응답 없음' }, { status: 504 });
  }
}
