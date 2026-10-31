// 1단계 전용: 배포 환경(icn1)에서 실시간 후보 API가 응답하는지 확인한다. 2단계가 끝나면 지운다.
// 키는 응답에 넣지 않는다. 응답 앞부분만 보여준다.
const TAGO = 'https://apis.data.go.kr/1613000';

async function probe(name: string, url: string) {
  const t = Date.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000), cache: 'no-store' });
    const text = await res.text();
    return { name, status: res.status, ms: Date.now() - t, body: text.slice(0, 1500) };
  } catch (e) {
    return { name, error: String(e), ms: Date.now() - t };
  }
}

export async function GET(req: Request) {
  const key = process.env.DATA_GO_KR_KEY ?? '';
  const p = new URL(req.url).searchParams;
  const city = p.get('city') ?? '39'; // TAGO 제주 도시코드로 추정, 아래 도시 목록으로 확인
  const node = p.get('node'); // 정류장 ID를 주면 그 정류장의 도착 예정 정보를 조회
  const q = (o: Record<string, string>) => new URLSearchParams({ serviceKey: key, _type: 'json', numOfRows: '20', ...o });

  // ?bis=Station,BusArrives?station=405000153 처럼 busopen 경로를 시험한다 (호스트 고정, 1단계 전용)
  const bis = p.get('bis');
  if (bis) {
    const paths = bis.split(',').filter((x) => /^[A-Za-z]+(\?[A-Za-z0-9=&]*)?$/.test(x)).slice(0, 10);
    return Response.json(await Promise.all(paths.map((x) => probe(x, `http://busopen.jeju.go.kr/OpenAPI/service/bis/${x}`))));
  }

  const results = await Promise.all([
    probe('TAGO 도시코드 목록', `${TAGO}/BusSttnInfoInqireService/getCtyCodeList?${q({})}`),
    probe('TAGO 정류장 검색(제주시청)', `${TAGO}/BusSttnInfoInqireService/getSttnNoList?${q({ cityCode: city, nodeNm: '제주시청' })}`),
    node
      ? probe('TAGO 정류장 도착 예정', `${TAGO}/ArvlInfoInqireService/getSttnAcctoArvlPrearngeInfoList?${q({ cityCode: city, nodeId: node })}`)
      : Promise.resolve({ name: 'TAGO 정류장 도착 예정', skipped: '?node=정류장ID 를 붙이면 조회' }),
    probe('제주 버스정보(busopen) 정류장', 'http://busopen.jeju.go.kr/OpenAPI/service/bis/Station'),
  ]);
  return Response.json({ region: process.env.VERCEL_REGION ?? 'local', hasKey: { dataGoKr: !!key, kakao: !!process.env.KAKAO_REST_KEY }, results });
}
