import type { Metadata } from 'next';
import { headers } from 'next/headers';
import AnalyticsClient from './analytics-client';
import './globals.css';

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host') ?? 'localhost:3000';
  const protocol = requestHeaders.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  const base = new URL(`${protocol}://${host}`);
  const title = 'Explode Anything — Interactive Component Atlases';
  const description = 'Turn a subject into a sourced, clickable component atlas—or explore the verified BodyParts3D human edition.';
  return {
    metadataBase: base,
    title,
    description,
    icons: { icon: '/favicon.svg', shortcut: '/favicon.svg' },
    openGraph: { title, description, type: 'website', images: [{ url: new URL('/video/trailer-poster.jpg', base).toString(), width: 1280, height: 720, alt: 'Explode Anything interactive component catalog' }] },
    twitter: { card: 'summary_large_image', title, description, images: [new URL('/video/trailer-poster.jpg', base).toString()] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}<AnalyticsClient /></body>
    </html>
  );
}
