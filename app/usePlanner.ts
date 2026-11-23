'use client';
import { useEffect, useRef, useState } from 'react';
import { kstMinutes } from '@/lib/timetable';
import { pace, passed, riding, searchOrigin, shift, walking, type Followed, type Frozen } from '@/lib/follow';
import { parseOdsay, type Pt, type Route } from '@/lib/odsay';
import { rideKeys, stopKeys, onOurRoutes, withOurWalks, type Headways, type PlanResults, type Schedules } from '@/lib/realtime';
import { rankRoutes } from '@/lib/rank';
import { clock12, routeKey } from '@/lib/format';
import { distM, type Trip } from '@/lib/direct';
import { BOARDED_M, REFRESH_MS } from '@/lib/config';
import { loadPinned, loadTrip, PINNED, SAVED } from './saved';
import type { Place } from '@/lib/storage';

type Ranked = Followed;
const ODSAY_KEY = process.env.NEXT_PUBLIC_ODSAY_KEY ?? '';

// 길찾기 상태와 계산 전부: 출발·도착이 바뀌면 ODsay로 경로 후보를 받고, 20초마다 실시간·시간표만 다시 계산한다.
// 따라가기("이 경로로 갈게요")·탄 뒤 고정·저장 복원도 여기서 처리한다. 화면(app/page.tsx)은 돌려받은 값을 그리기만 한다.
export function usePlanner({ from, to, setFrom, setTo, meRef }: { from: Place | null; to: Place | null; setFrom: (p: Place | null) => void; setTo: (p: Place | null) => void; meRef: { current: (Pt & { acc?: number }) | undefined } }) {
  const [routes, setRoutes] = useState<Ranked[]>([]);
  const [at, setAt] = useState<Date | null>(null);
  const [msg, setMsg] = useState('');
  const [rtWhy, setRtWhy] = useState(''); // 실시간을 못 받은 이유 문구 (빈 문자열이면 정상)
  const [selKey, setSelKey] = useState(''); // 고른 경로: 20초 갱신으로 순서가 바뀌어도 같은 경로를 따라간다
  const [held, setHeld] = useState(false); // 고른 경로가 갱신 결과에서 빠져 화면을 고정한 상태
  const [walkMin, setWalkMin] = useState<number | null>(null); // 버스 없이 걸어가는 시간(3km 안)
  const [walkPath, setWalkPath] = useState<Pt[] | undefined>(undefined);
  const [pos, setPos] = useState<Record<string, Record<number, Pt & { name: string }>>>({}); // 따라가는 구간 버스 위치 (남은 정류장 수 → 정류장)
  const busAt = (r: Ranked) => (r.bus ? pos[r.bus.key]?.[r.bus.left] : undefined); // 탄 버스가 지금 있는 정류장
  const [pin, setPin] = useState(''); // "이 경로로 갈게요"로 고른 경로: 갱신 때 이 경로만 보여준다
  const sinceRef = useRef(0); // 따라가기를 누른 시각(ms): 그때부터 정류장으로 걸어간다고 봄
  const frozenRef = useRef<Frozen | null>(null); // 탄 것으로 본 순간의 고른 경로와 탄 구간 수
  const routesRef = useRef<Ranked[]>([]), selRef = useRef(''), pinRef = useRef(''), heldRef = useRef(false), atRef = useRef<Date | null>(null);
  routesRef.current = routes;
  selRef.current = selKey;
  pinRef.current = pin;
  heldRef.current = held; atRef.current = at;

  const odsayOrg = useRef<Pt | null>(null); // ODsay 경로를 받은 출발 위치: 탑승 뒤 내가 500m 넘게 움직이면 다시 받는다
  const lastOrigin = useRef<Pt | null>(null); // 마지막으로 계산에 쓴 출발 좌표 ("현재 위치" 갱신 때 30m 안 움직임 판단의 기준)
  const busSeen = useRef<{ base: { key: string; left: number; t: number }; last: { key: string; left: number; t: number } } | null>(null); // 탄 버스의 남은 정류장 수 기록 (속도 보정용)
  const odsayErr = useRef('');
  const odsayRef = useRef<Route[] | null>(null); // 출발·도착이 같으면 ODsay 경로는 다시 부르지 않는다 (일일 한도)
  const reqId = useRef(0); // 새 검색마다 1씩 늘린다. 늦게 온 이전 검색·갱신 응답은 버린다.
  const live = useRef(false); // 결과가 화면에 있을 때만 자동 갱신
  const placesRef = useRef<{ from: Place; to: Place } | null>(null); // 마지막으로 계산한 출발·도착 (따라가는 경로를 갱신·저장할 때)
  const pathsRef = useRef(new Map<string, Trip['legs'][number]['path']>()); // 우리 경로의 지도 선: 처음 받은 것을 갱신 때도 쓴다

  // 출발·도착이 바뀌면 ODsay로 경로 후보를 받고, 20초마다 실시간·시간표만 다시 계산한다.
  // 따라가는 경로의 구간 키: 타기 전이면 모든 구간, 탄 뒤면 환승 구간만 (서버가 실시간을 먼저 조회)
  function pinKeys(): string[] {
    const fk = pinRef.current; // 따라가는 경로
    const r = frozenRef.current?.r ?? routesRef.current.find((x) => routeKey(x) === fk);
    // 탄 뒤에는 지금 탄 버스의 내릴 정류장도: 내 버스가 늦는지 실제 위치로 본다 (lib/follow.ts onBus)
    const on = frozenRef.current && r?.rides[frozenRef.current.k - 1];
    const off = on?.endStationId ? on.routeIds.filter(Boolean).map((id) => `${id}:${on.endStationId}`) : [];
    return r && fk ? [...off, ...(heldRef.current ? [] : rideKeys([r], true)), ...rideKeys([r], false)].slice(0, 12) : [];
  }
  async function plan(refresh = false) {
    if (refresh && !live.current) return;
    const id = refresh ? reqId.current : ++reqId.current;
    const stale = () => id !== reqId.current;
    // 고른 경로(누른 경로·카드로 고른 경로·탄 경로)는 새로 검색해도 사용자가 "따라가기 그만"이나 다른 카드를 누를 때까지 남긴다 (2026-11-03 사용자 요청)
    const kept = pinRef.current ? frozenRef.current?.r ?? routesRef.current.find((x) => routeKey(x) === pinRef.current) : undefined;
    // 따라가는 중에 출발지·도착지를 "바꾸기"로 비워도 따라가는 경로는 그 경로의 출발·도착으로 계속 다시 계산한다
    if (from && to) placesRef.current = { from, to };
    const P = from && to ? { from, to } : kept ? placesRef.current : null;
    if (!refresh) {
      live.current = false;
      odsayRef.current = null;
      setRoutes(kept ? [kept] : []);
      if (!kept) setAt(null);
      setMsg(P ? '경로 계산 중...' : '');
    }
    if (!P) return; // "바꾸기": 옛 결과를 지우고 끝 (따라가는 경로가 없을 때)
    const { to: T } = P;
    // 탄 뒤(고정 상태)에는 새 경로를 지금 내 위치에서 찾는다. GPS가 없으면 처음 출발지 그대로 (기존 동작)
    // 출발이 "현재 위치"면 갱신 때마다 GPS로 다시 잡는다 (MUS2-29). 기준은 마지막으로 쓴 좌표
    const F = searchOrigin(!!frozenRef.current && !!pinRef.current, P.from.name === '현재 위치', meRef.current, refresh && lastOrigin.current ? lastOrigin.current : P.from, P.from);
    lastOrigin.current = { lat: F.lat, lng: F.lng };
    if (odsayOrg.current && distM(odsayOrg.current, F) > 500) odsayRef.current = null;
    try {
      // ODsay는 Web 키로 브라우저에서 직접 호출한다 (서버 호출 금지). SearchPathType=2: 버스만.
      // ODsay는 보조: 오류·한도 초과·무응답(5초)이어도 우리 데이터로 찾은 직행·환승 경로를 보여준다
      let odsay = odsayRef.current;
      if (!odsay) {
        let parsed: ReturnType<typeof parseOdsay>;
        try {
          const body = await fetch(`https://api.odsay.com/v1/api/searchPubTransPathT?${new URLSearchParams({
            SX: String(F.lng), SY: String(F.lat), EX: String(T.lng), EY: String(T.lat), SearchPathType: '2', apiKey: ODSAY_KEY,
          })}`, { signal: AbortSignal.timeout(5000) }).then((r) => r.json());
          parsed = parseOdsay(body);
        } catch {
          parsed = { ok: false, reason: '응답 없음' };
        }
        if (stale()) return;
        odsayErr.current = !parsed.ok && parsed.reason !== '경로 없음'
          ? (/429|quota/i.test(parsed.reason) ? '경로를 찾지 못했어요. (보조 경로 검색 한도 초과, 내일 다시 채워져요)' : '경로를 찾지 못했어요. 잠시 뒤 다시 시도해 주세요.')
          : '';
        odsay = parsed.ok ? [...parsed.routes].sort((a, b) => a.odsayMin - b.odsayMin) : [];
        odsayRef.current = odsay;
        odsayOrg.current = { lat: F.lat, lng: F.lng };
      }
      let results: PlanResults = {}, staleSec: Record<string, number> = {};
      let headways: Headways = {};
      let sched: Schedules = {};
      let trips: Trip[] = [];
      let walkAll: number | null = null;
      try {
        const pathKey = (x: Route['rides'][number]) => `${x.routeIds[0]}:${x.stationId}:${x.stops}`;
        const q = new URLSearchParams({ q: rideKeys(odsay, true).slice(0, 30).join(','), later: rideKeys(odsay, false).slice(0, 30).join(','), pin: pinKeys().join(','), stops: refresh ? '' : stopKeys(odsay).slice(0, 60).join(','),
          wf: refresh ? '' : [...new Set(odsay.map((o) => o.rides[0]?.stationId).filter(Boolean))].slice(0, 20).join(','),
          wt: refresh ? '' : [...new Set(odsay.map((o) => o.rides.at(-1)?.endStationId).filter(Boolean))].slice(0, 20).join(','), from: `${F.lat},${F.lng}`, to: `${T.lat},${T.lng}`,
          paths: refresh ? '' : [...new Set(odsay.slice(0, 6).flatMap((o) => o.rides.map(pathKey)))].join(','), ...(refresh ? { lite: '1' } : {}) });
        const r = await fetch(`/api/plan?${q}`).then((r) => r.json());
        if (r.error) throw Object.assign(new Error(r.error), { serverMsg: String(r.error) }); // 403·414·429 등 서버가 막은 응답: 이유를 화면에 보여준다
        results = r.results ?? {};
        staleSec = r.stale ?? {};
        headways = r.headways ?? {};
        setPos(r.pos ?? {});
        sched = { rtMin: r.rtMin, scheduled: r.scheduled, pending: r.pending, firstBus: r.firstBus };
        trips = r.trips ?? [];
        walkAll = typeof r.walkAll === 'number' ? r.walkAll : null;
        if (!refresh) (setWalkMin(walkAll), setWalkPath(r.walkAllPath));
        // ODsay 경로 중 그 버스가 실제로 서지 않는 정류장에서 타거나 내리는 경로는 뺀다 (첫 검색에서 한 번)
        if (!refresh && r.stopsOk) odsay = odsayRef.current = odsay.filter((o) => onOurRoutes(o, r.stopsOk)).map((o) => withOurWalks(o, r.walkFrom, r.walkTo));
        // 지도 선은 첫 검색에서만 받는다 (갱신 응답은 빈 선). 구간 = 탈 정류장 > 내릴 정류장 + 노선
        const legKey = (l: Trip['legs'][number]) => `${l.fromId}>${l.toId}>${l.routeIds[0]}`;
        if (!refresh) pathsRef.current.clear();
        for (const t of trips) for (const l of t.legs) {
          if (l.path?.length) pathsRef.current.set(legKey(l), l.path);
          else l.path = pathsRef.current.get(legKey(l)) ?? [];
        }
        // 갱신 때 새로 나타난 후보(처음 검색엔 없던 구간)는 선이 없어 지도에 직선으로 그려졌다 → 그 구간만 노선 모양을 따로 받는다
        const miss = trips.flatMap((t) => t.legs).filter((l) => !l.path?.length);
        if (miss.length) {
          const mk = (l: Trip['legs'][number]) => `${l.routeIds[0]}:${l.fromId}:${l.stopsBy?.[0] ?? l.stops}`;
          const got = await fetch(`/api/plan?${new URLSearchParams({ paths: [...new Set(miss.map(mk))].slice(0, 30).join(',') })}`).then((x) => x.json()).catch(() => ({}));
          for (const l of miss) {
            const pts = got.paths?.[mk(l)];
            if (pts?.length > 1) (l.path = pts, pathsRef.current.set(legKey(l), pts));
          }
        }
        // ODsay 경로의 지도 선을 노선 모양(도로)으로 바꾼다
        for (const o of odsay) for (const x of o.rides) if (r.paths?.[pathKey(x)]?.length > 1) x.path = r.paths[pathKey(x)];
      } catch (e) {
        if (refresh) return; // 갱신 중 한 번 끊기면 이전 결과를 그대로 둔다
        setWalkMin(null);
        setRtWhy((e as { serverMsg?: string })?.serverMsg ?? '실시간 서버에 연결하지 못해 시간표로 계산했어요.');
        /* 첫 검색: ODsay 경로만, 대기는 추정 불가로 표시 */
      }
      if (stale()) return;
      const nowMin = kstMinutes(new Date());
      const { ranked, shown, endedList } = rankRoutes(odsay, trips, results, headways, sched, nowMin);
      if (!ranked.length) return setMsg(odsayErr.current || (walkAll !== null ? `버스로 가는 경로가 없어요. 걸어서 ${walkAll}분이에요.` : '버스로 가는 경로가 없어요. 걸어가기 가까운 거리일 수 있어요.'));
      if (!shown.some((r) => r.eta) && endedList.length) {
        setRoutes(kept ? [kept] : []);
        if (!kept) setAt(null);
        const firsts = endedList.flatMap((r) => (r.firstBus !== undefined ? [r.firstBus] : []));
        return setMsg(`막차가 끝났어요.${firsts.length ? ` 내일 첫차는 ${clock12(Math.min(...firsts))}부터예요.` : ''}`);
      }
      const next = shown.slice(0, 3), cur = routesRef.current;
      // 경고는 보여주는 경로의 첫 버스가 실시간을 하나도 못 받았을 때만. 같은 번호의 가지 노선 하나(341-6 등)가 시간 초과여도
      // 다른 가지(341-2)의 버스 위치를 받았으면 그 구간은 실시간으로 계산된다 (2026-11-03, 341-6·341-7은 busopen이 매번 시간 초과)
      const noLive = (x: Route['rides'][number]) => {
        const v = x.routeIds.map((id) => results[`${id}:${x.stationId}`]).filter((y) => y !== undefined);
        return !v.some(Array.isArray) && v.some((y) => !Array.isArray(y) && y.error !== '이 노선에 없는 정류장');
      };
      // 이유를 말해 준다: 어느 번호가 어떤 이유로 못 받았는지, 직전 위치로 대신했다면 몇 초 전인지
      // 실패한 노선만 말한다 (나머지는 실시간 그대로). 직전 위치로 대신한 노선은 몇 초 전 값인지
      const nosOf = (xs: (Route['rides'][number] | undefined)[]) => [...new Set(xs.flatMap((x) => (x ? [x.busNos[0]] : [])))].join('·');
      const bad = next.map((r) => r.rides[0]).filter((x) => x && noLive(x));
      const old = next.map((r) => r.rides[0]).find((x) => x?.routeIds.some((id) => staleSec[id]));
      if (Object.keys(results).length) setRtWhy(bad.length ? `${nosOf(bad)}번만 시간표 기준이에요.` : old ? `${old.busNos[0]}번 버스 위치는 ${Math.min(...old.routeIds.flatMap((id) => staleSec[id] ?? []))}초 전 값이에요.` : '');
      // 따라갈 경로: "이 경로로 갈게요"를 누른 경로, 아니면 카드를 눌러 고른 경로, 아니면 목록에서 빠진 1위.
      // 고른 경로가 빠지는 건 보통 그 버스를 이미 타서 정류장을 지났기 때문이다. 예전에는 그때 화면을 마지막 계산 그대로 멈췄는데,
      // 탄 뒤에도 버스 위치·갈아탈 버스를 계속 실시간으로 다시 계산한다 (사용자 요청 2026-11-03)
      const picked = cur[Math.max(0, cur.findIndex((r) => routeKey(r) === selRef.current))];
      const lost = !!picked && !shown.some((r) => routeKey(r) === routeKey(picked)); // 4위 밖으로 밀린 건 빠진 게 아님
      // 카드를 눌러 보던(또는 1위) 경로가 빠지면 그 버스를 탄 것으로 보고 따라가기로 바꾼다 ("따라가기 그만"으로 끔).
      // 단, 정말 탔을 때만: GPS가 있으면 승차 정류장 150m 안, 없으면 그 카드를 눌러 골랐을 때 (아무것도 안 눌렀는데 1위가 지나갔다고 고정되던 문제, 2026-11-03)
      // 카드 누르기는 지도에 보여줄 경로 고르기일 뿐이라 따라가는 경로를 바꾸지 않는다: 다른 카드를 보다가 내 경로 카드를 누르면 지도가 내 경로로 돌아온다
      const st = picked?.rides[0]?.fromPt, me0 = meRef.current;
      const boarded = me0 && st ? distM(me0, st) <= BOARDED_M : !!picked && selRef.current === routeKey(picked);
      if (refresh && lost && boarded && !pinRef.current) { pinRef.current = routeKey(picked); setPin(pinRef.current); sinceRef.current ||= Date.now(); }
      const fk = pinRef.current;
      if (fk) {
        // "이 경로로 갈게요"를 누른 경로를 맨 위에, 그 아래에 새로 찾은 경로들. 타려던 버스가 지나가면 탄 것으로 보고 고정한다.
        const nowMs = Date.now(), nowMin = nowMs / 60000, atMs = atRef.current?.getTime() ?? nowMs;
        const old = cur.find((r) => routeKey(r) === fk), found = ranked.find((r) => routeKey(r) === fk);
        const fresh = found && walking(found, (nowMs - (sinceRef.current || atMs)) / 60000);
        const board = (r: Ranked | undefined, ms: number, j: number) => (r?.eta?.boards[j] ? ms / 60000 + r.eta.boards[j].at : NaN);
        const unpin = () => { busSeen.current = null; pinRef.current = ''; selRef.current = ''; frozenRef.current = null; setPin(''); setSelKey(''); setHeld(false); setRoutes(next); setAt(new Date()); };
        // 도착하고 30분이 지나면 따라가기를 끝낸다
        if (old?.eta && nowMs > atMs + (old.eta.min + 30) * 60000) return unpin();
        let f = frozenRef.current, top: Ranked | undefined;
        if (!f) {
          if (fresh && !(old && passed(board(old, atMs, 0), board(fresh, nowMs, 0), nowMin))) top = fresh;
          // 고른 경로가 새 계산에서 잠깐 빠졌는데(ODsay 실패·데이터 갱신) 버스가 아직 올 때가 아니면, 탔다고 보지 않고 그대로 둔다
          else if (!fresh && old && board(old, atMs, 0) - nowMin > 2) top = shift(old, (nowMs - atMs) / 60000);
          else if (old) f = frozenRef.current = { r: old, t: atMs, k: 1 };
        }
        if (f) {
          // 탄 버스의 실제 속도: 처음 본 때 대비 줄어든 정류장 수로 시간표 속도와 비교 (lib/follow.ts pace)
          const ride = f.r.rides[f.k - 1], perStop = f.r.candidate.legs[f.k - 1].rideMin / (ride?.stops || 1);
          const seen = busSeen.current;
          top = riding(f, nowMs, results, headways, sched, seen ? pace(seen.base, seen.last, perStop) : 1);
          if (top.bus) {
            const n = { ...top.bus, t: nowMs };
            busSeen.current = !seen || seen.last.key !== n.key || n.left > seen.last.left ? { base: n, last: n } : { base: n.t - seen.base.t > 10 * 60000 ? seen.last : seen.base, last: n };
          }
          // 갈아탈 버스도 곧 올 차였는데 지나갔으면 그 버스도 탄 것으로 본다 (환승 뒤 다음 차로 바뀌지 않게)
          if (f.k < f.r.rides.length && passed(board(old, atMs, f.k), board(top, nowMs, f.k), nowMin)) {
            f = frozenRef.current = { r: old!, t: atMs, k: f.k + 1 };
            top = riding(f, nowMs, results, headways, sched);
          }
          setHeld(true);
        }
        setRoutes([...(top ? [top] : []), ...next.filter((r) => routeKey(r) !== fk)]);
        setAt(new Date());
        setMsg('');
        live.current = true;
        return;
      }
      setHeld(false);
      setRoutes(next);
      if (!refresh) setSelKey('');
      setAt(new Date());
      setMsg('');
      live.current = true;
    } catch {
      if (!refresh && !stale()) setMsg('경로를 계산하지 못했어요. 잠시 뒤 다시 시도해 주세요.');
    }
  }

  const restored = useRef(false), pinBoot = useRef(false);
  useEffect(() => {
    const p = loadPinned(), t = loadTrip();
    if (p) {
      // 고른 경로를 그 경로를 찾을 때의 출발지(현재 위치 포함)로 되살린다. 버스 안에서 다시 열어도 같은 경로를 따라간다
      pinBoot.current = true;
      frozenRef.current = p.held ? { r: p.r, t: p.t, k: p.k ?? 1 } : null;
      sinceRef.current = p.since ?? p.t;
      setFrom(p.from); setTo(p.to); setRoutes([p.r]); setAt(new Date(p.t)); setPin(routeKey(p.r)); setSelKey(routeKey(p.r)); setHeld(p.held);
    } else if (t) { setFrom(t.from); setTo(t.to); }
    restored.current = true;
  }, []);
  useEffect(() => {
    if (restored.current) try { sessionStorage.setItem(SAVED, JSON.stringify({ from, to })); } catch {}
    // 되살린 고른 경로는 새로 찾지 않고 갱신만 한다 (새로 찾으면 고른 경로가 풀림)
    if (pinBoot.current) {
      if (pin) (pinBoot.current = false), (live.current = true), plan(true); // 첫 렌더(아직 pin 전)에는 아무것도 안 함: plan()이 되살린 경로를 지움
      return;
    }
    plan();
  }, [from, to]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    try {
      const r = frozenRef.current?.r ?? routes.find((x) => routeKey(x) === pin);
      const pl = placesRef.current;
      if (pin && r && pl && at) localStorage.setItem(PINNED, JSON.stringify({ from: pl.from, to: pl.to, r, t: frozenRef.current?.t ?? at.getTime(), held, k: frozenRef.current?.k ?? 1, since: sinceRef.current }));
      else if (restored.current && !pinBoot.current) localStorage.removeItem(PINNED);
    } catch {}
  }, [pin, held, at]); // eslint-disable-line react-hooks/exhaustive-deps
  // 자동 갱신: 화면을 보고 있을 때만 REFRESH_MS(20초)마다 (사용자 요청 2026-11-03). 서버는 같은 노선 위치를 15초 동안 합쳐 쓰므로(LOC_TTL_MS) 이보다 자주 불러도 새 값이 없다. 돌아왔다고 바로 다시 계산하지는 않는다.
  useEffect(() => {
    const id = setInterval(() => { if (document.visibilityState === 'visible') plan(true); }, REFRESH_MS);
    return () => clearInterval(id);
  }, [from, to]); // eslint-disable-line react-hooks/exhaustive-deps

  const sel = Math.max(0, routes.findIndex((r) => routeKey(r) === selKey));
  // 버스보다 걷는 게 빠르거나 같으면 걷기를 맨 위에 두고 기본으로 고른다
  const walkFirst = !!at && walkMin !== null && routes.length > 0 && !pin && !held && (!routes[0].eta || walkMin <= routes[0].eta.min);
  const walkSel = walkFirst && (selKey === '' || selKey === 'walk');
  // "이 경로로 갈게요" 눌림: 이미 따라가는 경로면 그만두고 다시 계산, 아니면 이 경로를 따라간다
  const toggleFollow = (key: string, r: Ranked) => {
    if (pin === key) { pinRef.current = ''; heldRef.current = false; frozenRef.current = null; routesRef.current = []; setPin(''); setHeld(false); plan(true); }
    else ((frozenRef.current = null), (sinceRef.current = Date.now()), setHeld(false), setPin(key), setSelKey(key), setRoutes([r, ...routes.filter((x) => routeKey(x) !== key)]));
  };
  return { routes, at, msg, rtWhy, held, pin, selKey, setSelKey, sel, walkMin, walkPath, walkFirst, walkSel, busAt, toggleFollow };
}
