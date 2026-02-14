import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: "Tiger's Table - Liars Game",
  description: 'WebSocket room based liars game',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
