export const metadata = { title: '제주 가장 빠른 버스', description: '목적지에 가장 일찍 도착하는 제주 버스를 찾아줍니다' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 560, margin: '0 auto', padding: 16 }}>
        {children}
        <footer style={{ marginTop: 40, fontSize: 12, color: '#666' }}>
          경로·요금: ODsay LAB · 버스 정보: 공공데이터포털(국토교통부 TAGO, 제주특별자치도) · 장소 검색: 카카오
        </footer>
      </body>
    </html>
  );
}
