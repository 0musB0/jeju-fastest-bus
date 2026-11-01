import type { NextConfig } from 'next';

// 걷는 길 데이터는 크기가 커서 import하지 않고 실행 중에 읽는다. 배포 묶음에 넣으라고 알려준다.
const config: NextConfig = { outputFileTracingIncludes: { '/api/plan': ['./data/walk.json'] } };
export default config;
