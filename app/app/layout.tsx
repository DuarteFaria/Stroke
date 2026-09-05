import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Stroke · Estúdio de movimento em caiaque',
  description:
    'Análise de vídeo e edição de movimento em caiaque, tudo neste computador.',
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-PT">
      <body>{children}</body>
    </html>
  );
}
