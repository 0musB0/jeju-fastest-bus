// 검색엔진: API는 빼고 모두 허용
export default function robots() {
  return { rules: { userAgent: '*', allow: '/', disallow: '/api/' }, sitemap: 'https://jeju-fastest-bus.vercel.app/sitemap.xml' };
}
