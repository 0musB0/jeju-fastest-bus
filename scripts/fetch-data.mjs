// 제주 버스정보(busopen)에서 정류장·노선·노선별 정류장 순서를 받아 data/*.json으로 저장한다.
// GitHub Actions에서 매달 돌린다 (.github/workflows/data.yml). 직접 돌릴 때: node scripts/fetch-data.mjs
import { writeFile, mkdir } from 'node:fs/promises';

const BASE = 'http://busopen.jeju.go.kr/OpenAPI/service/bis';
const field = (xml, name) => xml.match(new RegExp(`<${name}>([^<]*)</${name}>`))?.[1];
const items = (xml) => [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);

async function get(path, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const xml = await (await fetch(`${BASE}/${path}`, { signal: AbortSignal.timeout(15000) })).text();
      if (field(xml, 'resultCode') !== '00') throw new Error(`resultCode ${field(xml, 'resultCode')}`);
      return xml;
    } catch (e) {
      if (i >= tries) throw new Error(`${path}: ${e.message}`);
      await new Promise((r) => setTimeout(r, 2000 * i));
    }
  }
}

const stations = items(await get('Station'))
  .filter((it) => field(it, 'useYn') === 'Y')
  .map((it) => ({ id: field(it, 'stationId'), name: field(it, 'stationNm'), lat: +field(it, 'localY'), lng: +field(it, 'localX'), dir: field(it, 'dirTp') }));

const routes = items(await get('Bus'))
  .filter((it) => field(it, 'useYn') === 'Y')
  .map((it) => ({ id: field(it, 'routeId'), no: field(it, 'routeNm'), to: field(it, 'routeSubNm'), stops: [] }));

// 노선별 정류장 순서: BusLocation이 노선의 모든 정류장을 순서대로 준다. 서버 부담을 줄이려고 4개씩.
let failed = 0;
for (let i = 0; i < routes.length; i += 4) {
  await Promise.all(routes.slice(i, i + 4).map(async (r) => {
    try {
      r.stops = items(await get(`BusLocation?route=${r.id}`)).map((it) => field(it, 'stationId'));
    } catch (e) {
      failed++;
      console.warn(e.message);
    }
  }));
}
if (failed > routes.length * 0.1) throw new Error(`노선 ${failed}/${routes.length}개 실패, 저장하지 않음`);

await mkdir('data', { recursive: true });
await writeFile('data/stations.json', JSON.stringify(stations));
await writeFile('data/routes.json', JSON.stringify(routes.filter((r) => r.stops.length)));
console.log(`정류장 ${stations.length}, 노선 ${routes.length} (실패 ${failed})`);
