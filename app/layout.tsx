import type { Metadata } from 'next';
import { headers } from 'next/headers';
import './globals.css';

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host') ?? 'localhost:3000';
  const protocol = requestHeaders.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  const base = new URL(`${protocol}://${host}`);
  const title = 'Corpus — Interactive 3D Human Atlas';
  const description = 'Explore 2,234 preserved BodyParts3D meshes by system, name, and source identifier.';
  return {
    metadataBase: base,
    title,
    description,
    icons: { icon: '/favicon.svg', shortcut: '/favicon.svg' },
    openGraph: { title, description, type: 'website', images: [{ url: new URL('/og.png', base).toString(), width: 1200, height: 675, alt: 'Corpus interactive human atlas' }] },
    twitter: { card: 'summary_large_image', title, description, images: [new URL('/og.png', base).toString()] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
