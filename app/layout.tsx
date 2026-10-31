import './globals.css';

export const viewport = { width: 'device-width', initialScale: 1 };
export const metadata = { title: '제주 가장 빠른 버스', description: '목적지에 가장 일찍 도착하는 제주 버스를 찾아줍니다' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        {children}
        <footer>
          경로·요금: ODsay LAB · 버스 정보: 제주특별자치도 버스정보시스템 · 장소 검색: 카카오
        </footer>
      </body>
    </html>
  );
}
