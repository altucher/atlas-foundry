import type { Metadata } from 'next';

import FoundryHome from '../foundry-home';

// The embedded atlas viewer for the TAO-1 chat (docs/EMBED_CONTRACT.md): /embed?atlas=<key>, or /embed?q=<topic>&t=<token>, ?theme=light|dark.
export const metadata: Metadata = { title: 'Explode Anything', robots: { index: false, follow: false } };

export default function EmbedPage() {
  return <FoundryHome embed />;
}
