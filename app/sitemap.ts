import { GUIDES } from '@/lib/guides';
import routes from '@/data/routes.json';

const BASE = 'https://jeju-fastest-bus.vercel.app';

export default function sitemap() {
  return ['', '/guide', ...GUIDES.map((g) => `/guide/${g.slug}`), '/routes', ...[...new Set(routes.filter((r) => r.stops.length > 1).map((r) => r.no.split('-')[0]))].map((b) => `/routes/${b}`), '/about', '/terms', '/privacy', '/contact'].map((p) => ({ url: BASE + p }));
}
