// /ads.txt: 애드센스가 이 사이트의 광고 판매자를 확인하는 파일. 게시자 ID가 없으면 404.
export const dynamic = 'force-static';

export function GET() {
  const pub = process.env.NEXT_PUBLIC_ADSENSE_CLIENT?.replace(/^ca-/, '');
  if (!pub) return new Response('Not found', { status: 404 });
  return new Response(`google.com, ${pub}, DIRECT, f08c47fec0942fa0\n`, { headers: { 'content-type': 'text/plain' } });
}
