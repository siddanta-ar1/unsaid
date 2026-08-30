import type { NextConfig } from 'next';

const isProduction = process.env.NODE_ENV === 'production';

const API_ORIGIN = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3011';

/**
 * Content Security Policy.
 *
 * The vault decrypts in this document, so for the lifetime of a page view the
 * browser tab holds plaintext that exists nowhere else. A single injected
 * script would have access to all of it. That makes the CSP a real control
 * here rather than a hardening checkbox.
 *
 * `connect-src` is the important line: it enumerates every origin the page may
 * talk to, so injected code cannot exfiltrate to an attacker's host even if it
 * runs. Storage and RPC origins are listed because ciphertext is uploaded
 * directly from the browser.
 */
function contentSecurityPolicy(): string {
  const storageOrigin = process.env.NEXT_PUBLIC_STORAGE_ORIGIN ?? 'http://localhost:9010';
  const rpcOrigin = process.env.NEXT_PUBLIC_SOLANA_RPC ?? 'https://api.devnet.solana.com';

  return [
    "default-src 'self'",
    // Next injects inline bootstrap scripts; 'unsafe-eval' is required by the
    // dev-mode React refresh runtime and dropped in production.
    isProduction
      ? "script-src 'self' 'unsafe-inline'"
      : "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    // blob: covers decrypted audio played back from memory.
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "font-src 'self' data:",
    `connect-src 'self' ${API_ORIGIN} ${storageOrigin} ${rpcOrigin}`,
    // Wallet extensions inject into the page rather than framing it.
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    ...(isProduction ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Workspace crypto/types packages ship TypeScript sources.
  transpilePackages: ['@unsaid/crypto', '@unsaid/solana', '@unsaid/types'],
  poweredByHeader: false,

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: contentSecurityPolicy() },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // No referrer at all: a vault URL contains a memory id, and we do not
          // want it reaching any third party a user navigates to.
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'geolocation=(), camera=(), microphone=(self)' },
          // Isolates this origin from other tabs the browser has open.
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
          ...(isProduction
            ? [
                {
                  key: 'Strict-Transport-Security',
                  value: 'max-age=31536000; includeSubDomains',
                },
              ]
            : []),
        ],
      },
    ];
  },
};

export default nextConfig;
