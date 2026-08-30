import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Workspace crypto/types packages ship TypeScript sources.
  transpilePackages: ['@unsaid/crypto', '@unsaid/solana', '@unsaid/types'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          // The vault decrypts in the browser; block anything embedding it.
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'geolocation=(), camera=(), microphone=(self)' },
        ],
      },
    ];
  },
};

export default nextConfig;
