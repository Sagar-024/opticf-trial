import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Optific+ · Your organisation, connected',
  description: 'A shared workspace for an optician group - Chat, BI, Map, Brain and Today.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Inter is loaded at runtime so builds never depend on a font fetch. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="font-sans">{children}</body>
    </html>
  );
}
