import type { NextConfig } from 'next';

// 보안 헤더. 막아도 지도·광고가 깨질 일이 없는 것(프레임 삽입, base, object, form)은 바로 적용하고,
// 스크립트·연결·이미지 출처 제한은 먼저 Report-Only로 둔다: 카카오맵 SDK·애드센스가 어디서 무엇을 받는지 배포 화면 콘솔에서 위반 없이 도는지
// 확인한 뒤 헤더 이름을 Content-Security-Policy로 올린다 (이 환경에서는 카카오·광고 도메인에 접속할 수 없어 실제 화면으로 검증하지 못했다, 2026-11-23).
const ADS = 'https://pagead2.googlesyndication.com https://*.googlesyndication.com https://*.doubleclick.net https://*.google.com https://*.adtrafficquality.google';
const KAKAO = 'https://dapi.kakao.com https://*.kakao.com https://*.daumcdn.net';
const enforced = "base-uri 'self'; object-src 'none'; frame-ancestors 'self'; form-action 'self'";
const reportOnly = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' ${KAKAO} ${ADS}`, // Next가 넣는 인라인 스크립트 때문에 unsafe-inline (nonce를 쓰면 모든 페이지가 동적이 된다)
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  `connect-src 'self' https://api.odsay.com ${KAKAO} ${ADS}`,
  `frame-src ${ADS}`,
].join('; ');

const config: NextConfig = {
  // 걷는 길 데이터는 크기가 커서 import하지 않고 실행 중에 읽는다. 배포 묶음에 넣으라고 알려준다.
  outputFileTracingIncludes: { '/api/plan': ['./data/walk.json'] },
  headers: async () => [{
    source: '/:path*',
    headers: [
      { key: 'Content-Security-Policy', value: enforced },
      { key: 'Content-Security-Policy-Report-Only', value: reportOnly },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'geolocation=(self), camera=(), microphone=()' },
      { key: 'Strict-Transport-Security', value: 'max-age=63072000' },
    ],
  }],
};
export default config;
