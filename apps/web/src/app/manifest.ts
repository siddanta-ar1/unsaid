import type { MetadataRoute } from 'next';

/**
 * Installable, because the moment this product is needed is not a moment for an
 * app store. Someone opens a link at 2am; they should be able to keep it on the
 * home screen and have it open straight into capture.
 *
 * `start_url` is the capture entry rather than the landing page: a returning
 * user has already been sold to.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'UNSAID',
    short_name: 'UNSAID',
    description: 'A private place for the things you cannot say out loud.',
    start_url: '/app',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#efeae4',
    theme_color: '#efeae4',
    categories: ['lifestyle', 'productivity'],
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
