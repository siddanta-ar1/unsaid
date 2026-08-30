import type { Metadata, Viewport } from 'next';
import { VaultProvider } from '@/lib/vault';
import { WalletProvider } from '@/lib/wallet';
import './globals.css';

export const metadata: Metadata = {
  title: 'UNSAID',
  description: 'A private place for the things you cannot say out loud.',
  // The vault is personal; keep it out of search indexes entirely.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#faf8f5' },
    { media: '(prefers-color-scheme: dark)', color: '#0d0c0b' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">
        <VaultProvider>
          <WalletProvider>{children}</WalletProvider>
        </VaultProvider>
      </body>
    </html>
  );
}
