// 화면 문구용 순수 함수 (app/page.tsx에서 분리, MUS2-152)

// 자정부터 분 → "5:50 AM"
export const clock12 = (m: number) => `${Math.floor(m / 60) % 12 || 12}:${String(m % 60).padStart(2, '0')} ${m % 1440 < 720 ? 'AM' : 'PM'}`;
// 경로 구분 열쇠: 구간마다 탈 정류장과 버스
export const routeKey = (r: { rides: { from: string; busNos: string[] }[] }) => r.rides.map((x) => `${x.from}:${x.busNos.join('/')}`).join('|');
// 걸리는 시간: 60분부터는 "2시간 30분"
export const dur = (m: number) => { const t = Math.round(m), h = Math.floor(t / 60); return h ? `${h}시간${t % 60 ? ` ${t % 60}분` : ''}` : `${t}분`; };
// 버스 번호만: "300(신사동)", "365-21" → "300", "365" (같은 번호는 하나로)
export const busNumbers = (nos: string[]) => [...new Set(nos.map((n) => n.replace(/\(.*\)/, '').replace(/-\d+$/, '').trim()))];
// "하귀환승정류장(하귀하나로마트)" → ["하귀환승정류장", "하귀하나로마트"]. 괄호는 길 건너 같은 이름 정류장을 가리는 힌트라 작게 남긴다.
export const splitStop = (name: string) => {
  const m = name.match(/^(.*?)\s*\((.*)\)$/);
  return m ? [m[1], m[2]] : [name, ''];
};
