# 제주 가장 빠른 버스 (CLAUDE.md)

출발지(기본값은 현재 위치)와 목적지를 넣으면 **목적지에 가장 일찍 도착하는** 제주 버스 경로와 탈 정류장을 알려주는 웹사이트. 제주도 버스만 다룬다.
계획 문서: https://claude.ai/artifact/MiSUjTzMAtsjDyvPXmr8Je

## 하지 않는 것 (첫 버전)

로그인, 앱 설치, 지도(목록이 먼저), 제주 외 지역, 택시 비교, 데이터베이스.
요청받지 않은 기능, 추상화, 설정은 만들지 않는다.
즐겨찾는 도착지는 사용자 요청(2026-11-01)으로 추가: 브라우저 localStorage에만 저장(로그인·서버 저장 없음).

## 스택

- Next.js (App Router) + TypeScript, Vercel 배포
- 길찾기 화면 1개(+애드센스 승인용 안내·소개·약관 정적 페이지, 2026-11-01), 서버 함수 2개: `app/api/search` (장소 검색), `app/api/plan` (경로 계산)
- 정류장, 노선, 시간표, 노선 모양은 `data/*.json` 정적 파일로 둔다. DB는 쓰지 않는다.
- 테스트는 `node:test` + `node:assert`로 작성하고 `npm test`로 돌린다. 새 라이브러리는 꼭 필요할 때만 추가한다.

## 파일 지도

새 세션은 이 지도로 구조를 먼저 파악하고, 고칠 파일만 연다. **파일을 더하거나 빼거나 역할을 바꾸면 같은 커밋에서 이 지도도 고친다.**

```
app/page.tsx          화면 전체(클라이언트). 경로 카드 = 시간 막대(Bar) + 세로 줄(고른 카드만 전부), "이 경로로 갈게요" 따라가기(localStorage). 장소 검색 → ODsay 직접 호출 → /api/plan → applyRealtime → arrivalMin → 정렬·표시, 20초마다 lite 재계산. 즐겨찾기(localStorage). 결과 아래 애드센스 1자리(NEXT_PUBLIC_ADSENSE_CLIENT·_SLOT 둘 다 있을 때만)
app/RouteMap.tsx      결과 지도(카카오맵 JS SDK), 노선 선 그리기. RouteLine = 노선 페이지의 노선 한 개 선(펼칠 때 그림)
app/layout.tsx        폰트(Jua)·메타·상단 메뉴·하단 링크. icon.svg, apple-icon.png, opengraph-image.* = 아이콘·링크 미리보기
app/ads.txt/route.ts  애드센스 ads.txt (게시자 ID 없으면 404)
app/privacy/page.tsx  개인정보처리방침 (애드센스 요건)
app/about, terms, contact  소개·이용 방법, 이용약관, 문의(이메일) 정적 페이지
app/routes/page.tsx   모든 노선 번호 목록 (상단 메뉴 "노선")
app/routes/[base]     번호별 가지 노선: 지도 선·정류장 순서·요일별 첫 정류장 출발 시각(빌드 때 data로)
app/guide/page.tsx    버스 안내 글 목록
app/guide/[slug]      안내 글 본문(요금·종류·타는 법) + 공항→관광지 직행 표(빌드 때 data로 계산)
app/sitemap.ts, robots.ts  검색엔진용
lib/guides.ts         안내 글 목록(GUIDES), airportRides(공항 → 목적지 직행 노선·소요·첫차·막차)
app/globals.css       디자인(모래·현무암·귤색)
app/api/search        카카오 키워드 검색 프록시(제주 rect 고정)
app/api/plan          서버 핵심. data/*.json을 import해 findTrips(우리 경로 후보) + 노선별 busopen BusLocation(실시간) + 시간표 도착 시각 + 지도 선(paths)을 돌려줌
lib/config.ts         조절값 상수 전부
lib/direct.ts         정류장·노선 인덱스, 거리·걷기, findTrips(직행·환승 2번), legPath
lib/eta.ts            arrivalMin: 후보 1개의 도착 시각(순수 함수), kstClock 표시
lib/follow.ts         따라가기 순수 함수: walking(누른 뒤 걸은 만큼), passed(버스 지나감 판정), riding(탄 버스 안·환승 정류장에서 남은 경로 다시 계산), shift
lib/realtime.ts       BusLocation XML 파싱, 남은 정류장 수, applyRealtime(대기 반영), tripsToRoutes(우리 경로 → 화면용 Route)
lib/odsay.ts          ODsay 응답 파싱(JEB 접두어 제거), 요금 계산
lib/timetable.ts      시간표 표 파싱·이름 맞추기·Entry 생성, arrivals/firstAt, kstDay(공휴일 목록)·kstMinutes
lib/*.test.ts         같은 이름 파일의 테스트 (npm test)
data/stations.json    정류장 {id,name,lat,lng,dir}      ← scripts/fetch-data.mjs (data.yml, 매달 2일)
data/routes.json      노선 {id,no,to,stops[]}          ← scripts/fetch-data.mjs
data/schedules.json   사이트 시간표 원본 표(탭 이름 label에 평일/휴일)             ← scripts/fetch-schedules.mjs (schedules.yml, 매달 2일)
data/timetable.json   노선ID → {p,t,m,n} 정류장 순번 기준 ← scripts/build-timetable.mjs
data/shapes.json      노선ID → {p 좌표, s 정류장 선분}   ← scripts/fetch-shapes.mjs
scripts/accuracy.mjs  배포된 /api/plan으로 대기 예측 정확도 측정 (accuracy.yml, 수동)
```

자주 고치는 곳: 조절값은 `lib/config.ts`, 대기·도착 계산은 `lib/eta.ts`·`lib/realtime.ts`, 경로 후보는 `lib/direct.ts`, 화면 문구·배치는 `app/page.tsx`. data/*.json은 크니 통째로 열지 말고 `head -c`로 본다.

## 데이터 출처와 규칙

| 용도 | 출처 | 규칙 |
| --- | --- | --- |
| 장소 → 좌표 | 카카오 로컬 키워드 검색 (REST 키) | 서버에서만 호출. 검색 범위는 항상 제주 `rect`로 제한 |
| 경로 후보(보조), 도로 모양 | ODsay 대중교통 길찾기 (**Web 키**, 일일 한도 있음 → 우리 데이터로 찾은 경로가 기본) | **브라우저에서 직접 호출**. 콘솔의 허용 도메인은 Vercel 주소만. Server 키는 쓰지 않는다 (Vercel IP가 계속 바뀜). Referer를 꾸며 서버에서 호출하지 않는다 (약관 위반 소지) |
| 정류장, 노선 | 제주 버스정보 busopen (`Station`, `Bus`, `BusLocation`) | `scripts/fetch-data.mjs`를 GitHub Actions가 매달 돌려 `data/*.json`으로 커밋. busopen은 미국 GitHub 러너에서 시간 초과가 날 수 있음(2026-10-31) |
| 시간표 | bus.jeju.go.kr `/data/schedule/getScheduleInfo`·`getScheduleTableInfo` (robots.txt·약관 없음 확인, 사용자 승인 2026-10-31) | `scripts/fetch-schedules.mjs` → `data/schedules.json`, `scripts/build-timetable.mjs`가 주요 정류장 이름을 BIS 정류장과 맞춰 `data/timetable.json`(노선 ID별)으로. 매달, 요청 사이 0.3초 |
| 노선 모양(지도 선) | bus.jeju.go.kr `/data/search/getLinkInfoByLineId` (POST, 시간표와 같은 사이트·승인) | `scripts/fetch-shapes.mjs` → `data/shapes.json`, 시간표 워크플로에서 매달. 정류장은 선분 번호로 맞춤(`--reindex`로 다시 계산) |
| 걷는 길 | OpenStreetMap (Overpass API, User-Agent 필요) | `scripts/fetch-walk.mjs` → `data/walk.json`, `walk.yml` 석 달마다. 서버에서 읽기만 함(외부 호출 없음, 한도 없음). 화면 하단에 OSM 출처 표기 |
| 실시간 위치 | 제주 버스정보 busopen `BusLocation?route=` (키 없음, 1단계에서 선택) | 노선 단위 조회, 검색 1회당 최대 16개 노선(6초 넘으면 남은 노선은 건너뜀, 상위 6개 후보의 환승 구간까지 먼저). 대기 = 남은 정류장 수 × 구간 정류장당 소요. `BusArrives`(도착 예정)는 값이 2022·2025년에 멈춰 있어 쓰지 않는다. 서버가 가끔 3초를 넘긴다 |

- API 키는 Vercel 환경 변수에만 둔다. 커밋, 로그, 클라이언트 번들에 넣지 않는다 (도메인을 제한한 브라우저 키 `NEXT_PUBLIC_ODSAY_KEY`, `NEXT_PUBLIC_KAKAO_JS_KEY`만 예외).
- 공공 API는 오류를 HTTP 200에 담아 보낼 수 있다. 결과 코드를 확인하고, 오류 응답은 캐시하지 않는다.
- `/api/plan`은 제주 BIS ID(숫자 9자리)만 받고, 그 노선의 정류장 목록에 있는 정류장만 계산한다. 실시간 API를 아무나 쓰는 프록시가 되면 안 된다.
- ODsay와 공공데이터는 출처 표기 조건이 있으니 화면 하단에 항상 표기한다.

## 경로 선택 공식

모든 후보는 **목적지 도착 예정 시각**으로 비교한다. 걷기와 첫 대기는 더하지 않고 둘 중 큰 값을 쓴다.

```
도착 시각 = 지금 + max(걷기1, 탈 수 있는 다음 버스 도착) + 탑승 + 환승(걷기 + 대기) + 걷기2
```

1. **후보**: 서버(`lib/direct.ts` `findTrips`)가 정류장·노선 JSON만으로 직행과 환승 2번까지의 경로를 찾는다(출발·도착 1km, 사용자 요청 2026-11-02, 환승 걷기 200m). ODsay 결과는 한도가 남아 있을 때 더하는 보조다. 탑승 시간은 시간표의 정류장 간 소요, 없으면 정류장 수 × 평균 소요.
2. **방향**: 같은 이름의 정류장이 길 양쪽에 있다. ODsay의 `startLocalStationID`·`busLocalBlID`가 제주 BIS ID와 같아서(확인함, 2026-10-31부터 앞에 "JEB"가 붙어 와서 떼고 씀) 방향은 노선 정류장 목록으로 걸러진다. ID가 비어 있으면 대기를 추정하지 않는다(좌표로 맞추는 대응표는 만들지 않음, 우리 경로는 처음부터 BIS ID).
3. **대기 시간**: ① 실시간이 기준(사용자 요청 2026-11-02). 시간표는 실시간에 안 보이는 버스(아직 기점을 떠나지 않은 버스)와 실시간 버스 뒤의 차에만 쓴다. 실시간이 "오는 버스 없음"(빈 배열)이면 그것도 실시간 결과라 시간표 버스로 메우지 않는다(2026-11-03) → ② 실시간 위치를 못 받은 구간만 시간표·배차 간격 (간격만 있으면 그 절반) → ③ 둘 다 없으면 "추정 불가"로 순위 맨 뒤(계산되는 경로가 하나라도 있으면 아예 숨김, 2026-11-02). 환승 버스도 같은 규칙(실시간 조회 칸에 들어갈 때). 제주 밖 출발지는 항상 ②. 화면에 "실시간"/"시간표 기준"을 표시한다.
4. **놓치는 버스**: 버스보다 1분 이상 먼저 정류장에 닿아야 탈 수 있다(환승은 3분). 실시간은 보통 다음 1~2대만 주므로 그 뒤는 시간표로 채운다.
5. **걷기**: ODsay 도보 시간을 우선 쓴다. 우리 경로의 출발·도착 걷기는 `data/walk.json`(OpenStreetMap 걷는 길, `scripts/fetch-walk.mjs`, 석 달마다 워크플로)을 따라 `lib/walk.ts`로 재고 지도에도 그 길을 그린다(오름·캠퍼스를 가로지르지 않게). 길 데이터 밖이거나 환승 걷기(200m 안)는 직선거리 × 1.3 ÷ 분당 80m.
6. **결과**: 도착 시각 순으로 3개, 요금과 계산 기준 시각을 함께 보여준다. 20초마다 실시간·시간표만 자동으로 다시 계산한다(ODsay는 다시 부르지 않음). 첫차 전·막차 후와 경로 없음은 따로 안내한다.

조절값(1km, 200m, 1.3배, 분당 80m, 1분 여유, 정류장당 평균 소요)은 `lib/config.ts` 한 곳에 상수로 모은다.

## 시간 (KST)

- Vercel 서버는 UTC로 돈다. "지금", 첫차·막차, 시간표 비교는 모두 `Asia/Seoul` 기준으로 한다.
- `new Date().getHours()`처럼 서버의 로컬 시간을 쓰지 않는다. `Intl.DateTimeFormat`에 `timeZone: 'Asia/Seoul'`을 넘긴다.
- 평일, 토요일, 일요일·공휴일 시간표를 구분한다(`lib/timetable.ts` `kstDay`, 공휴일은 손으로 적은 목록이라 매년 말에 다음 해를 더한다). 자정을 넘기는 막차도 처리한다.

## Vercel 설정

- 함수 지역은 서울로 고정한다: `vercel.json`에 `"regions": ["icn1"]`.
- 실시간 조회는 2개씩 나눠 병렬로 보내고(제주 서버는 5개를 동시에 보내면 모두 3초를 넘김, 실측), 각 요청에 `AbortSignal.timeout(3000)`을 둔다.
- 실시간 응답은 `fetch(url, { next: { revalidate: 20 } })`로 인스턴스 간에 캐시를 공유한다. 함수 메모리 캐시는 쓰지 않는다.
- Hobby 요금제는 비상업 용도 전용이다. 광고나 유료화를 하면 Pro로 옮긴다. 애드센스 코드는 들어 있지만 `NEXT_PUBLIC_ADSENSE_CLIENT`가 없으면 꺼져 있다(2026-11-01). 이 값을 넣기 전에 Pro 전환을 먼저 확인한다.
- API 확인은 로컬이 아니라 배포된 환경에서 한다 (IP·지역 문제는 로컬에서 드러나지 않는다).

## 코딩 규칙

- 도착 시각 계산은 외부 호출이 없는 순수 함수(`lib/eta.ts`)로 만들고 테스트를 붙인다. 필수 케이스: 계획 문서의 예시(A: 걷기 2분, 25분 뒤 버스 / B: 걷기 6분, 8분 뒤 버스 → B가 17분 빠름), 놓치는 버스, 환승, 자정 전후 KST.
- 외부 API 응답은 경계에서 검증한 뒤 안쪽으로 넘긴다. 실패하면 빈 결과 대신 이유를 담아 돌려준다 (API 실패, 경로 없음, 막차 후, 위치 거부).
- 파일은 적게, 함수는 짧게. 같은 일을 하는 코드가 이미 있으면 그것을 쓴다.
- 일부러 단순하게 처리한 곳에는 한계를 주석으로 남긴다 (예: `// 단순화: 배차 간격의 절반을 대기로 씀, 시간표가 생기면 교체`).
- UI 문구와 주석은 한국어로 쓴다.

## 진행 단계

1. 빈 프로젝트를 Vercel(icn1)에 배포하고 API를 확인한다: ODsay Web 키, 실시간 후보 3곳 비교, 실시간 값의 단위와 몇 대까지 주는지, 시간표 데이터 확보 여부, 일일 한도와 약관.
2. 계산 함수와 테스트, 최소 화면 (검색, 결과 3개, 오류 문구).
3. 실시간 반영, 직행 후보, 정류장 방향 대응표, 공유 캐시.
4. 출발·도착 5쌍으로 실제 도착 시각과 비교해 정확도를 확인한다. 지도는 그다음.
