// 경로 계산 조절값. 바꿀 때는 이 파일만 고친다.
export const NEAR_STOP_M = 600; // 출발·도착지에서 정류장을 찾는 반경
export const STOP_MATCH_M = 30; // 정류장 ID 대응표를 만들 때 같은 정류장으로 보는 거리
export const WALK_DETOUR = 1.3; // 직선거리 → 실제 걷는 거리 배율
export const WALK_M_PER_MIN = 70;
export const BOARD_MARGIN_MIN = 1; // 버스보다 이만큼 먼저 정류장에 닿아야 탈 수 있다
export const MIN_PER_STOP = 2; // 시간표가 없을 때 정류장당 평균 소요(분), 1단계에서 실측 후 조정

// 카카오 검색을 제주로 제한하는 사각형 (서경,남위,동경,북위)
export const JEJU_RECT = '126.08,33.10,127.00,33.60';
