import { parsePinned, parseTrip, type Pinned } from '@/lib/storage';

// 브라우저 저장소 읽기 (값 검증은 lib/storage.ts, 접근이 막힌 브라우저에서는 없는 것으로)
// 크롬이 뒤에 둔 탭을 지웠다가 다시 열면 페이지가 새로 뜬다. 그때 출발·도착을 되살린다 (탭을 닫으면 사라짐).
export const SAVED = 'trip';
export const loadTrip = () => { try { return parseTrip(sessionStorage.getItem(SAVED)); } catch { return null; } };
// "이 경로로 갈게요"로 고른 경로는 크롬을 껐다 켜도 남도록 localStorage에 둔다. 도착 시각에서 30분이 지나면 버린다.
export const PINNED = 'pinned';
export const loadPinned = (): Pinned | null => { try { return parsePinned(localStorage.getItem(PINNED), Date.now()); } catch { return null; } };
