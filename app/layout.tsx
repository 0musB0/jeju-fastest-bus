import './globals.css';

export const viewport = { width: 'device-width', initialScale: 1 };
export const metadata = { title: '혼저 탑서 · 제주 가장 빠른 버스', description: '목적지에 가장 일찍 도착하는 제주 버스를 찾아줍니다' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        {/* 제목·시각용 귀여운 글꼴(Jua, OFL 무료). text=로 쓰는 글자만 받아서 아주 작다 */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Jua&display=swap&text=%ED%98%BC%EC%A0%80%20%ED%83%91%EC%84%9C0123456789%3A%EB%B6%84" />
      </head>
      <body>
        {children}
        <footer>
          경로·요금: ODsay LAB · 버스 정보: 제주특별자치도 버스정보시스템 · 장소 검색: 카카오
        </footer>
      </body>
    </html>
  );
}
