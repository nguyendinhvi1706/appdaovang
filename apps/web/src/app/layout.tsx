import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AppDaoVang — Trading Workspace',
  description: 'Nền tảng giao dịch mã nguồn mở',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
