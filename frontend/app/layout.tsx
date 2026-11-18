import type { Metadata } from 'next';
import { Noto_Sans_Thai } from 'next/font/google';
import { DevShell } from './(dev)/DevShell';
import './globals.css';

const notoSansThai = Noto_Sans_Thai({
  variable: '--font-sans',
  subsets: ['thai', 'latin'],
});

export const metadata: Metadata = {
  title: 'Project Tracking',
};

// Local-only: the host app has its own root layout, which is never replaced by this one.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th" className={`${notoSansThai.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="min-h-full font-sans">
        <DevShell>{children}</DevShell>
      </body>
    </html>
  );
}
