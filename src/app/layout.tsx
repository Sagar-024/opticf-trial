import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import { Providers } from '@/components/providers';
import './globals.css';

/**
 * Fonts: Inter and Geist only.
 * Inter is self-hosted by Next at build time (no runtime request, no flash of
 * fallback). Geist Sans and Geist Mono come from the local `geist` package,
 * also self-hosted. No other named families are used anywhere.
 */
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

export const metadata: Metadata = {
  title: 'Optific+ · Your organisation, connected',
  description: 'A shared workspace for an optician group: Chat, BI, Map, Brain and Today.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
