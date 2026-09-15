import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'TRACE | 産業用エネルギー設計',
  description:
    '太陽光・蓄電池の導入案を比較し、電気の流れから投資判断までをつなぐシミュレーション。サンプルデータによるPoC。',
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
