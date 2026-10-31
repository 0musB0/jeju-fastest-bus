'use client';
import { useState } from 'react';

// 1단계 화면: 배포 확인과 API 점검용. 2단계에서 검색·결과 화면으로 바꾼다.
const ODSAY_KEY = process.env.NEXT_PUBLIC_ODSAY_KEY ?? '';

export default function Home() {
  const [out, setOut] = useState('');

  async function run(label: string, f: () => Promise<unknown>) {
    setOut(`${label} 확인 중...`);
    try {
      setOut(`${label}\n` + JSON.stringify(await f(), null, 2));
    } catch (e) {
      setOut(`${label} 실패: ${e}`);
    }
  }

  // ODsay는 Web 키로 브라우저에서 직접 호출한다 (서버 호출 금지). 제주공항 → 제주시청.
  const odsay = () =>
    fetch(
      `https://api.odsay.com/v1/api/searchPubTransPathT?${new URLSearchParams({
        SX: '126.4930', SY: '33.5070', EX: '126.5300', EY: '33.4995', apiKey: ODSAY_KEY,
      })}`,
    ).then((r) => r.json());

  return (
    <main>
      <h1>제주 가장 빠른 버스</h1>
      <p>준비 중입니다. 지금은 API 연결 점검 화면이에요.</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button onClick={() => run('ODsay 길찾기', odsay)}>ODsay 점검</button>
        <button onClick={() => run('카카오 장소 검색', () => fetch('/api/search?q=제주국제공항').then((r) => r.json()))}>카카오 점검</button>
        <button onClick={() => run('실시간 API', () => fetch('/api/check').then((r) => r.json()))}>실시간 점검</button>
      </div>
      <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, background: '#f4f4f4', padding: 8 }}>{out}</pre>
    </main>
  );
}
