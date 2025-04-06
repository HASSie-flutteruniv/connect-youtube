import './globals.css';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import Script from 'next/script'

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'CONNECT - ポモドーロタイマー',
  description: '集中と休憩を効率的に管理するポモドーロタイマーアプリ',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body className={inter.className}>
        {children}
        
        <Script id="handle-hydration-error">
          {`
            window.addEventListener('load', () => {
              if (document.body.hasAttribute('data-feedly-mini')) {
                document.body.removeAttribute('data-feedly-mini');
              }
            });
          `}
        </Script>
      </body>
    </html>
  );
}
