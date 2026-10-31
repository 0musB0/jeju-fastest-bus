import './globals.css';

export const viewport = { width: 'device-width', initialScale: 1 };
export const metadata = { title: '제주 가장 빠른 버스', description: '목적지에 가장 일찍 도착하는 제주 버스를 찾아줍니다' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        {/* 제목 전용 귀여운 글꼴(Jua). text=로 제목 글자만 받아서 아주 작다 */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Jua&display=swap&text=%EC%A0%9C%EC%A3%BC%20%EA%B0%80%EC%9E%A5%EB%B9%A0%EB%A5%B8%EB%B2%84%EC%8A%A4" />
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
