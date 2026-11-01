import { GUIDES } from '@/lib/guides';

const BASE = 'https://jeju-fastest-bus.vercel.app';

export default function sitemap() {
  return ['', '/guide', ...GUIDES.map((g) => `/guide/${g.slug}`), '/about', '/terms', '/privacy', '/contact'].map((p) => ({ url: BASE + p }));
}
