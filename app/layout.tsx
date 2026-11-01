import './globals.css';

export const viewport = { width: 'device-width', initialScale: 1 };
const title = '혼저 탑서 · 제주 가장 빠른 버스';
const description = '가까운 정류장이 아니라 목적지에 가장 먼저 닿는 제주 버스를 찾아줘요';
// 아이콘·미리보기 이미지는 app/icon.svg, apple-icon.png, opengraph-image.png 파일로 Next가 자동으로 넣는다
export const metadata = {
  metadataBase: new URL('https://jeju-fastest-bus.vercel.app'),
  title: { default: title, template: '%s · 혼저 탑서' }, description,
  openGraph: { title, description, siteName: '혼저 탑서', locale: 'ko_KR', type: 'website', url: '/' },
  twitter: { card: 'summary_large_image', title, description },
  verification: { google: 'P2GUzIC1LSDuFqbKS3kY2BlTpYczUyqW2WSoZHYYpa0' }, // 구글 서치 콘솔 소유 확인
};

// 애드센스 게시자 ID(ca-pub-…)가 있으면 광고 스크립트를 넣는다. 없으면 광고 관련 코드는 하나도 나가지 않는다.
const adClient = process.env.NEXT_PUBLIC_ADSENSE_CLIENT;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        {/* 제목·시각용 귀여운 글꼴(Jua, OFL 무료). text=로 쓰는 글자만 받아서 아주 작다 */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Jua&display=swap&text=%ED%98%BC%EC%A0%80%20%ED%83%91%EC%84%9C0123456789%3A%EB%B6%84APM%20" />
        {adClient && <script async src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${adClient}`} crossOrigin="anonymous" />}
      </head>
      <body>
        <nav className="nav"><a href="/">길찾기</a><a href="/guide">버스 안내</a><a href="/about">소개</a></nav>
        {children}
        <footer>
          경로·요금: ODsay LAB · 버스 정보: 제주특별자치도 버스정보시스템 · 장소 검색: 카카오
          <div className="links"><a href="/about">소개</a><a href="/guide">버스 안내</a><a href="/terms">이용약관</a><a href="/privacy">개인정보처리방침</a><a href="/contact">문의</a></div>
        </footer>
      </body>
    </html>
  );
}
