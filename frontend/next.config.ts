import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The dev user switcher shows only outside production builds unless NEXT_PUBLIC_ENV says otherwise.
  env: { NEXT_PUBLIC_ENV: process.env.NEXT_PUBLIC_ENV ?? (process.env.NODE_ENV === 'production' ? '' : 'local') },
  // Same-origin proxy to the Go service: no CORS, and the host app can do the same.
  async rewrites() {
    return [
      {
        source: '/api/tracking/:path*',
        destination: `${process.env.TRACKING_API_URL ?? 'http://127.0.0.1:8081'}/api/tracking/:path*`,
      },
    ];
  },
  turbopack: {
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
};

export default nextConfig;
